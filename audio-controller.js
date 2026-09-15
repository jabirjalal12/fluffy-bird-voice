/**
 * AudioController - High-Precision Live Microphone & Voice Intensity Engine
 * Built-in Fan & Ambient Noise Filter with Real-Time Level Tracking
 */
class AudioController {
    constructor() {
        this.audioCtx = null;
        this.analyser = null;
        this.microphone = null;
        this.highpassFilter = null;
        this.stream = null;
        this.timeArray = null;
        this.freqArray = null;
        this.floatArray = null;

        this.isListening = false;
        this.isCalibrating = false;
        this._loopRunning = false;

        // Fan & Ambient Noise Suppression Settings
        this.fanFilterActive = true;
        this.highpassCutoff = 160; // 160Hz highpass cutoff strips rumble & fan buffeting

        // Flight Mode & Sensitivity Settings
        this.mode = 'vocal_flap'; // 'vocal_flap' or 'continuous_float'
        this.sensitivity = 1.0;
        this.threshold = 0.14;    // 14% vocal trigger threshold
        this.ambientNoise = 0.02; // Adaptive background noise floor tracker

        // Runtime Volume Levels (0.0 to 1.0)
        this.currentVolume = 0;
        this.smoothedVolume = 0;
        this.rawRms = 0;
        this.rawPeak = 0;

        // Flap Trigger Timing
        this.lastFlapTime = 0;
        this.flapCooldownMs = 140; // 140ms snappy cooldown for rapid rhythmic hops
        this.hasTriggeredInCurrentBurst = false;

        // Callbacks
        this.onFlap = null;
        this.onLevelUpdate = null;
        this.onError = null;
    }

    async initMicrophone() {
        try {
            const AudioCtx = window.AudioContext || window.webkitAudioContext;
            if (!AudioCtx) {
                throw new Error("Web Audio API is not supported in this browser.");
            }

            if (!this.audioCtx) {
                this.audioCtx = new AudioCtx();
            }
            if (this.audioCtx.state === 'suspended') {
                await this.audioCtx.resume();
            }

            if (this.isListening && this.microphone && this.stream && this.stream.active) {
                return true;
            }

            // Universal clean microphone stream
            let stream = null;
            try {
                stream = await navigator.mediaDevices.getUserMedia({
                    audio: {
                        echoCancellation: true,
                        noiseSuppression: false,
                        autoGainControl: true
                    }
                });
            } catch (err) {
                stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            }

            this.stream = stream;
            this.microphone = this.audioCtx.createMediaStreamSource(stream);

            // 1. High-Pass Filter: Cuts sub-bass room rumble & fan buffeting
            this.highpassFilter = this.audioCtx.createBiquadFilter();
            this.highpassFilter.type = 'highpass';
            this.highpassFilter.frequency.value = this.fanFilterActive ? this.highpassCutoff : 40;
            this.highpassFilter.Q.value = 0.707;

            // 2. Audio Spectrum Analyser
            this.analyser = this.audioCtx.createAnalyser();
            this.analyser.fftSize = 512;
            this.analyser.smoothingTimeConstant = 0.10;

            // Connect Pipeline: Mic -> HighPass -> Analyser
            this.microphone.connect(this.highpassFilter);
            this.highpassFilter.connect(this.analyser);

            this.timeArray = new Uint8Array(this.analyser.fftSize);
            this.freqArray = new Uint8Array(this.analyser.frequencyBinCount);
            this.floatArray = new Float32Array(this.analyser.fftSize);

            this.isListening = true;
            this.startAnalysisLoop();
            return true;
        } catch (err) {
            console.warn("Microphone access error:", err);
            this.isListening = false;
            if (this.onError) {
                this.onError(err);
            }
            return false;
        }
    }

    setFanFilter(enabled) {
        this.fanFilterActive = !!enabled;
        if (this.highpassFilter && this.audioCtx) {
            const targetFreq = this.fanFilterActive ? this.highpassCutoff : 40;
            this.highpassFilter.frequency.setTargetAtTime(targetFreq, this.audioCtx.currentTime, 0.05);
        }
    }

    startAnalysisLoop() {
        if (this._loopRunning) return;
        this._loopRunning = true;

        const update = () => {
            if (this.isListening) {
                if (this.audioCtx && this.audioCtx.state === 'suspended') {
                    this.audioCtx.resume();
                }

                this.analyzeAudio();

                if (this.onLevelUpdate) {
                    const isTriggered = this.mode === 'vocal_flap' 
                        ? (this.smoothedVolume >= this.threshold || this.currentVolume >= this.threshold)
                        : this.smoothedVolume > 0.05;
                    this.onLevelUpdate(this.smoothedVolume, this.threshold, isTriggered, this.currentVolume, this.rawRms);
                }
            }
            requestAnimationFrame(update);
        };
        requestAnimationFrame(update);
    }

    analyzeAudio() {
        if (!this.analyser) return;

        if (!this.timeArray) this.timeArray = new Uint8Array(this.analyser.fftSize);
        if (!this.freqArray) this.freqArray = new Uint8Array(this.analyser.frequencyBinCount);
        if (!this.floatArray) this.floatArray = new Float32Array(this.analyser.fftSize);

        // 1. Time-Domain Peak Sample Deviation & RMS
        this.analyser.getFloatTimeDomainData(this.floatArray);
        this.analyser.getByteFrequencyData(this.freqArray);

        let maxDev = 0;
        let sumSquares = 0;
        const len = this.floatArray.length;

        for (let i = 0; i < len; i++) {
            const val = this.floatArray[i];
            const abs = Math.abs(val);
            if (abs > maxDev) maxDev = abs;
            sumSquares += val * val;
        }

        const timeRms = Math.sqrt(sumSquares / len);
        this.rawRms = timeRms;
        this.rawPeak = maxDev;

        // 2. Frequency-Domain Vocal Energy (180Hz - 3800Hz)
        let freqSum = 0;
        const startBin = this.fanFilterActive ? 3 : 1;
        const endBin = Math.min(48, this.freqArray.length);
        for (let i = startBin; i < endBin; i++) {
            freqSum += this.freqArray[i];
        }
        const freqAvg = (freqSum / ((endBin - startBin) * 255));

        // 3. Clean Composite Live Volume Score (Scaled 0.0 to 1.0)
        const compositeSignal = ((timeRms * 3.6) + (maxDev * 0.75) + (freqAvg * 1.35)) * this.sensitivity;
        const rawVol = Math.min(1.0, Math.max(0, compositeSignal));
        this.currentVolume = rawVol;

        // Smooth volume for UI bar & float physics
        const smoothing = this.mode === 'continuous_float' ? 0.35 : 0.45;
        this.smoothedVolume = (this.smoothedVolume * smoothing) + (rawVol * (1 - smoothing));

        // 4. Background noise floor tracking
        if (rawVol < this.threshold * 0.85) {
            this.ambientNoise = this.ambientNoise * 0.98 + rawVol * 0.02;
        }

        // 5. Speech Spike Trigger (Vocal Flap Mode)
        const now = performance.now();
        if (this.mode === 'vocal_flap') {
            const effectiveVol = Math.max(this.smoothedVolume, rawVol);
            const timeSinceLastFlap = now - this.lastFlapTime;

            // Reset burst lock when volume drops below threshold * 0.75 or cooldown expires
            if (timeSinceLastFlap > this.flapCooldownMs * 1.5 || effectiveVol < this.threshold * 0.75) {
                this.hasTriggeredInCurrentBurst = false;
            }

            if (effectiveVol >= this.threshold) {
                if (!this.hasTriggeredInCurrentBurst && timeSinceLastFlap > this.flapCooldownMs) {
                    this.lastFlapTime = now;
                    this.hasTriggeredInCurrentBurst = true;
                    if (this.onFlap) {
                        this.onFlap(effectiveVol);
                    }
                }
            }
        }
    }

    getCurrentIntensity() {
        if (!this.isListening) return 0;
        if (this.smoothedVolume < 0.03) return 0;
        
        const norm = Math.min(1.0, this.smoothedVolume / Math.max(0.10, this.threshold * 1.1));
        return Math.pow(norm, 0.70);
    }

    async autoCalibrate(durationMs = 2000, progressCallback = null) {
        if (!this.isListening) {
            const ok = await this.initMicrophone();
            if (!ok) return null;
        }

        this.isCalibrating = true;
        const samples = [];
        const startTime = performance.now();

        return new Promise((resolve) => {
            const sampleInterval = setInterval(() => {
                if (!this.analyser || !this.floatArray) return;
                this.analyser.getFloatTimeDomainData(this.floatArray);

                let sumSquares = 0;
                for (let i = 0; i < this.floatArray.length; i++) {
                    sumSquares += this.floatArray[i] * this.floatArray[i];
                }
                const rms = Math.sqrt(sumSquares / this.floatArray.length);
                samples.push(rms * 3.5);

                const elapsed = performance.now() - startTime;
                const progress = Math.min(1.0, elapsed / durationMs);
                if (progressCallback) progressCallback(progress);

                if (elapsed >= durationMs) {
                    clearInterval(sampleInterval);
                    this.isCalibrating = false;

                    const avg = samples.reduce((a, b) => a + b, 0) / (samples.length || 1);
                    const max = Math.max(...samples, 0.01);

                    this.ambientNoise = Math.min(0.08, Math.max(0.01, avg));
                    this.threshold = Math.min(0.35, Math.max(0.08, max * 1.8 + 0.04));

                    resolve({
                        avgAmbient: avg,
                        maxAmbient: max,
                        ambientNoise: this.ambientNoise,
                        threshold: this.threshold
                    });
                }
            }, 30);
        });
    }

    setSensitivityPreset(preset) {
        if (preset === 'quiet') {
            this.sensitivity = 1.20;
            this.threshold = 0.10; // 10%
            this.highpassCutoff = 140;
            this.setFanFilter(true);
        } else if (preset === 'fan_mode') {
            this.sensitivity = 0.90;
            this.threshold = 0.16; // 16%
            this.highpassCutoff = 240;
            this.setFanFilter(true);
        } else if (preset === 'noisy') {
            this.sensitivity = 0.75;
            this.threshold = 0.22; // 22%
            this.highpassCutoff = 220;
            this.setFanFilter(true);
        } else {
            // 'normal'
            this.sensitivity = 1.0;
            this.threshold = 0.14; // 14%
            this.highpassCutoff = 160;
            this.setFanFilter(true);
        }
    }

    setMode(mode) {
        if (mode === 'vocal_flap' || mode === 'continuous_float') {
            this.mode = mode;
        }
    }
}

window.audioController = new AudioController();
