/**
 * AudioController - High Precision Voice Intensity & Speech Trigger Handler
 * Built-in Fan & AC Noise Suppressor (220Hz High-Pass Filter + Spectral Gating)
 * Multi-harmonic analyzer tuned for clean, intentional speech commands.
 */
class AudioController {
    constructor() {
        this.audioCtx = null;
        this.analyser = null;
        this.microphone = null;
        this.highpassFilter = null;
        this.lowpassFilter = null;
        this.stream = null;
        this.timeArray = null;
        this.freqArray = null;
        this.floatArray = null;
        this.isListening = false;
        this.isCalibrating = false;
        this._loopRunning = false;

        // Fan & Ambient Noise Suppression Settings
        this.fanFilterActive = true;
        this.highpassCutoff = 220; // 220Hz highpass cutoff strips 20Hz-200Hz fan rumble & wind buffeting

        // Flight Mode & Sensitivity Settings
        this.mode = 'vocal_flap'; // 'vocal_flap' or 'continuous_float'
        this.sensitivity = 0.90;
        this.threshold = 0.15;    // Clean vocal trigger threshold (15%)
        this.ambientNoise = 0.02; // Adaptive background noise floor tracker

        // Runtime state
        this.currentVolume = 0;
        this.smoothedVolume = 0;
        this.rawRms = 0;
        this.rawPeak = 0;
        this.lastFlapTime = 0;
        this.flapCooldownMs = 150; // Snappy 150ms cooldown for rapid flaps
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

            // Universal clean microphone stream with active hardware noise suppression
            let stream = null;
            try {
                stream = await navigator.mediaDevices.getUserMedia({
                    audio: {
                        echoCancellation: true,
                        noiseSuppression: true,
                        autoGainControl: true
                    }
                });
            } catch (err) {
                stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            }

            this.stream = stream;
            this.microphone = this.audioCtx.createMediaStreamSource(stream);

            // 1. High-Pass Filter: Eliminates fan motor hum, AC vibration, and air buffeting (< 220Hz)
            this.highpassFilter = this.audioCtx.createBiquadFilter();
            this.highpassFilter.type = 'highpass';
            this.highpassFilter.frequency.value = this.fanFilterActive ? this.highpassCutoff : 40;
            this.highpassFilter.Q.value = 0.707; // Standard Butterworth response

            // 2. Low-Pass Filter: Cuts out ultra-high electronic hiss and static (> 3800Hz)
            this.lowpassFilter = this.audioCtx.createBiquadFilter();
            this.lowpassFilter.type = 'lowpass';
            this.lowpassFilter.frequency.value = 3800;
            this.lowpassFilter.Q.value = 0.707;

            // 3. Audio Spectrum Analyser
            this.analyser = this.audioCtx.createAnalyser();
            this.analyser.fftSize = 512;
            this.analyser.smoothingTimeConstant = 0.15;

            // Connect Digital Signal Processing (DSP) Pipeline:
            // Microphone -> High-Pass (Fan Killer) -> Low-Pass -> Analyser
            this.microphone.connect(this.highpassFilter);
            this.highpassFilter.connect(this.lowpassFilter);
            this.lowpassFilter.connect(this.analyser);

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
                        : this.smoothedVolume > 0.04;
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

        // 1. Time-Domain Peak Sample Deviation & RMS (Filtered of fan rumble)
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

        // 2. Frequency-Domain Vocal Energy:
        // Skip Bins 0, 1, 2 (0 - 280Hz) to discard fan turbulence & motor resonances
        let freqSum = 0;
        const startBin = this.fanFilterActive ? 3 : 1;
        const endBin = Math.min(45, this.freqArray.length); // 280Hz - 4200Hz (Human speech range)
        for (let i = startBin; i < endBin; i++) {
            freqSum += this.freqArray[i];
        }
        const voiceFreqAvg = (freqSum / ((endBin - startBin) * 255));

        // 3. Combined Clean Vocal Score with Adaptive Ambient Floor Subtraction
        const peakScore = Math.max(0, maxDev - this.ambientNoise * 1.0);
        const rmsScore = Math.max(0, timeRms - this.ambientNoise * 0.8);
        const freqScore = Math.max(0, voiceFreqAvg - this.ambientNoise * 0.5);

        const vocalSignal = (peakScore * 0.60) + (rmsScore * 1.40) + (freqScore * 1.20);
        let rawVol = Math.min(1.0, Math.max(0, vocalSignal * this.sensitivity));

        // Noise gate: Sub-threshold stationary background flutter is zeroed out
        if (this.fanFilterActive && rawVol < 0.035) {
            rawVol = 0;
        }

        // Dynamic Baseline Floor Tracking (Adapts to continuous background changes)
        if (rawVol < this.ambientNoise * 1.4 || this.ambientNoise === 0) {
            this.ambientNoise = this.ambientNoise * 0.985 + (rawVol > 0 ? rawVol * 0.015 : 0);
        }

        // Smoothing for UI & Flight Physics
        const currentSmoothing = this.mode === 'continuous_float' ? 0.30 : 0.40;
        this.smoothedVolume = (this.smoothedVolume * currentSmoothing) + (rawVol * (1 - currentSmoothing));
        this.currentVolume = rawVol;

        const now = performance.now();

        // 4. Speech Spike Trigger (Vocal Flap Mode)
        if (this.mode === 'vocal_flap') {
            const effectiveVol = Math.max(this.smoothedVolume, rawVol);
            const timeSinceLastFlap = now - this.lastFlapTime;

            // Auto-unlock burst lock after cooldown expires or volume drops below threshold * 0.80
            if (timeSinceLastFlap > this.flapCooldownMs * 1.4 || effectiveVol < this.threshold * 0.80) {
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
        
        // Responsive lift curve for continuous humming/singing
        const targetRef = Math.max(0.08, this.threshold);
        const norm = Math.min(1.0, this.smoothedVolume / (targetRef * 1.1));
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
                    const max = Math.max(...samples, 0.005);

                    // Float threshold safely above measured fan/room noise
                    this.ambientNoise = Math.min(0.06, Math.max(0.005, avg));
                    this.threshold = Math.min(0.30, Math.max(0.12, max * 2.2 + 0.04));

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
            this.sensitivity = 1.10;
            this.threshold = 0.10; // 10%
            this.highpassCutoff = 200;
            this.setFanFilter(true);
        } else if (preset === 'fan_mode') {
            // Dedicated High Fan / AC Suppression mode
            this.sensitivity = 0.85;
            this.threshold = 0.18; // 18%
            this.highpassCutoff = 280; // 280Hz cutoff strips heavier fan blast
            this.setFanFilter(true);
        } else if (preset === 'noisy') {
            this.sensitivity = 0.70;
            this.threshold = 0.22; // 22%
            this.highpassCutoff = 260;
            this.setFanFilter(true);
        } else {
            // 'normal' (balanced, fan filter enabled)
            this.sensitivity = 0.90;
            this.threshold = 0.15; // 15%
            this.highpassCutoff = 220;
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
