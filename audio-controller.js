/**
 * AudioController - High Precision Voice Intensity & Speech Trigger Handler
 * Multi-harmonic analyzer combining Time-Domain Peak Deviation, Float RMS, and Vocal Spectrum Energy.
 */
class AudioController {
    constructor() {
        this.audioCtx = null;
        this.analyser = null;
        this.microphone = null;
        this.stream = null;
        this.timeArray = null;
        this.freqArray = null;
        this.floatArray = null;
        this.isListening = false;
        this.isCalibrating = false;
        this._loopRunning = false;

        // Settings (Optimized for instant, effortless speech reactivity)
        this.mode = 'vocal_flap'; // 'vocal_flap' or 'continuous_float'
        this.sensitivity = 1.25;
        this.threshold = 0.08;    // Balanced speech trigger threshold (8%)
        this.ambientNoise = 0.015; // Adaptive background noise floor tracker

        // Runtime state
        this.currentVolume = 0;
        this.smoothedVolume = 0;
        this.rawRms = 0;
        this.rawPeak = 0;
        this.lastFlapTime = 0;
        this.flapCooldownMs = 140; // Snappy 140ms cooldown for rapid flaps
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
                        echoCancellation: false,
                        noiseSuppression: false,
                        autoGainControl: true
                    }
                });
            } catch (err) {
                stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            }

            this.stream = stream;
            this.microphone = this.audioCtx.createMediaStreamSource(stream);
            this.analyser = this.audioCtx.createAnalyser();
            this.analyser.fftSize = 512;
            this.analyser.smoothingTimeConstant = 0.12;

            this.microphone.connect(this.analyser);
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
                        : this.smoothedVolume > 0.03;
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
        this.analyser.getByteTimeDomainData(this.timeArray);
        this.analyser.getFloatTimeDomainData(this.floatArray);
        this.analyser.getByteFrequencyData(this.freqArray);

        let maxDev = 0;
        let sumSquares = 0;
        for (let i = 0; i < this.timeArray.length; i++) {
            const dev = Math.abs(this.timeArray[i] - 128) / 128;
            if (dev > maxDev) maxDev = dev;
            sumSquares += dev * dev;
        }
        const timeRms = Math.sqrt(sumSquares / this.timeArray.length);
        this.rawRms = timeRms;
        this.rawPeak = maxDev;

        // 2. Frequency-Domain Vocal Energy (100Hz - 4000Hz)
        let freqSum = 0;
        const startBin = 1;
        const endBin = Math.min(64, this.freqArray.length);
        for (let i = startBin; i < endBin; i++) {
            freqSum += this.freqArray[i];
        }
        const voiceFreqAvg = (freqSum / ((endBin - startBin) * 255));

        // 3. Combined Vocal Energy Score (Instantaneous & Multi-harmonic)
        const peakScore = Math.max(0, maxDev - this.ambientNoise * 0.6);
        const rmsScore = Math.max(0, timeRms - this.ambientNoise * 0.4);
        const freqScore = Math.max(0, voiceFreqAvg - this.ambientNoise * 0.25);

        const vocalSignal = (peakScore * 0.70) + (rmsScore * 1.60) + (freqScore * 1.30);
        let rawVol = Math.min(1.0, Math.max(0, vocalSignal * this.sensitivity));

        // Dynamic Baseline Tracking (Very slow filter so speech doesn't pull up noise floor)
        if (rawVol < this.ambientNoise * 1.3 || this.ambientNoise === 0) {
            this.ambientNoise = this.ambientNoise * 0.98 + rawVol * 0.02;
        }

        // Smoothing for UI & Flight Physics
        const currentSmoothing = this.mode === 'continuous_float' ? 0.25 : 0.35;
        this.smoothedVolume = (this.smoothedVolume * currentSmoothing) + (rawVol * (1 - currentSmoothing));
        this.currentVolume = rawVol;

        const now = performance.now();

        // 4. Speech Spike Trigger (Vocal Flap Mode)
        if (this.mode === 'vocal_flap') {
            const effectiveVol = Math.max(this.smoothedVolume, rawVol);
            const timeSinceLastFlap = now - this.lastFlapTime;

            // Auto-unlock burst lock after cooldown expires or volume drops below threshold * 0.85
            if (timeSinceLastFlap > this.flapCooldownMs * 1.4 || effectiveVol < this.threshold * 0.85) {
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
        if (this.smoothedVolume < 0.015) return 0;
        
        // Responsive lift curve for continuous humming/singing
        const targetRef = Math.max(0.04, this.threshold);
        const norm = Math.min(1.0, this.smoothedVolume / (targetRef * 1.2));
        return Math.pow(norm, 0.60);
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
                if (!this.analyser || !this.timeArray) return;
                this.analyser.getByteTimeDomainData(this.timeArray);

                let sumSquares = 0;
                for (let i = 0; i < this.timeArray.length; i++) {
                    const dev = Math.abs(this.timeArray[i] - 128) / 128;
                    sumSquares += dev * dev;
                }
                const rms = Math.sqrt(sumSquares / this.timeArray.length);
                samples.push(rms);

                const elapsed = performance.now() - startTime;
                const progress = Math.min(1.0, elapsed / durationMs);
                if (progressCallback) progressCallback(progress);

                if (elapsed >= durationMs) {
                    clearInterval(sampleInterval);
                    this.isCalibrating = false;

                    const avg = samples.reduce((a, b) => a + b, 0) / (samples.length || 1);
                    const max = Math.max(...samples, 0.003);

                    this.ambientNoise = Math.min(0.035, Math.max(0.002, avg));
                    this.threshold = Math.min(0.20, Math.max(0.05, max * 1.6 + 0.02));

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
            this.sensitivity = 1.45;
            this.threshold = 0.05;
        } else if (preset === 'noisy') {
            this.sensitivity = 0.95;
            this.threshold = 0.15;
        } else {
            // 'normal' (balanced)
            this.sensitivity = 1.25;
            this.threshold = 0.08;
        }
    }

    setMode(mode) {
        if (mode === 'vocal_flap' || mode === 'continuous_float') {
            this.mode = mode;
        }
    }
}

window.audioController = new AudioController();
