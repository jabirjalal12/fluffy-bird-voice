/**
 * AudioController - High Precision Voice Intensity & Speech Trigger Handler
 * Uses Web Audio API with peak amplitude, float time-domain RMS, and voice band energy.
 */
class AudioController {
    constructor() {
        this.audioCtx = null;
        this.analyser = null;
        this.microphone = null;
        this.stream = null;
        this.floatArray = null;
        this.freqArray = null;
        this.isListening = false;
        this.isCalibrating = false;
        this._loopRunning = false;

        // Settings (Optimized for instant, effortless speech reactivity)
        this.mode = 'vocal_flap'; // 'vocal_flap' or 'continuous_float'
        this.sensitivity = 1.15;
        this.threshold = 0.08;    // High-sensitivity speech trigger threshold
        this.ambientNoise = 0.003; // Adaptive background noise floor tracker

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

            if (this.isListening && this.microphone) {
                return true;
            }

            // High-fidelity, zero-suppression audio stream for instant game triggers
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
                // Fallback to standard basic audio constraint
                stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            }

            this.stream = stream;
            this.microphone = this.audioCtx.createMediaStreamSource(stream);
            this.analyser = this.audioCtx.createAnalyser();
            this.analyser.fftSize = 512;
            this.analyser.smoothingTimeConstant = 0.10; // Rapid reaction

            this.microphone.connect(this.analyser);
            this.floatArray = new Float32Array(this.analyser.fftSize);
            this.freqArray = new Uint8Array(this.analyser.frequencyBinCount);

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
                // Ensure audio context is active
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
        if (!this.analyser || !this.floatArray) return;

        // 1. Time-Domain Peak Sample & Float RMS
        this.analyser.getFloatTimeDomainData(this.floatArray);
        let sumSquares = 0;
        let peakVal = 0;
        for (let i = 0; i < this.floatArray.length; i++) {
            const sample = this.floatArray[i];
            const abs = Math.abs(sample);
            if (abs > peakVal) peakVal = abs;
            sumSquares += sample * sample;
        }
        const rms = Math.sqrt(sumSquares / this.floatArray.length);
        this.rawRms = rms;
        this.rawPeak = peakVal;

        // 2. Frequency-Domain Vocal Energy (150Hz - 3400Hz)
        let voiceFreqEnergy = 0;
        if (this.freqArray) {
            this.analyser.getByteFrequencyData(this.freqArray);
            let freqSum = 0;
            const startBin = 2;
            const endBin = Math.min(48, this.freqArray.length);
            for (let i = startBin; i < endBin; i++) {
                freqSum += this.freqArray[i];
            }
            voiceFreqEnergy = (freqSum / ((endBin - startBin) * 255));
        }

        // 3. Dynamic Baseline Tracking (Fast adapts to room silence)
        if (rms < this.ambientNoise * 1.5 || this.ambientNoise === 0) {
            this.ambientNoise = this.ambientNoise * 0.95 + rms * 0.05;
        }

        // 4. Combined Vocal Score (Peak + RMS + Voice Frequency)
        const rmsSignal = Math.max(0, rms - this.ambientNoise * 0.75);
        const peakSignal = Math.max(0, peakVal - this.ambientNoise * 1.5);
        
        const combinedScore = (peakSignal * 1.8) + (rmsSignal * 12.0) + (voiceFreqEnergy * 0.50);
        let rawVolume = Math.min(1.0, combinedScore * this.sensitivity);

        // Responsive Smoothing for UI & Physics
        const currentSmoothing = this.mode === 'continuous_float' ? 0.35 : 0.45;
        this.smoothedVolume = (this.smoothedVolume * currentSmoothing) + (rawVolume * (1 - currentSmoothing));
        this.currentVolume = rawVolume;

        const now = performance.now();

        // 5. Speech Spike Trigger (Vocal Flap)
        if (this.mode === 'vocal_flap') {
            const effectiveVol = Math.max(this.smoothedVolume, rawVolume);
            if (effectiveVol >= this.threshold) {
                if (!this.hasTriggeredInCurrentBurst && (now - this.lastFlapTime > this.flapCooldownMs)) {
                    this.lastFlapTime = now;
                    this.hasTriggeredInCurrentBurst = true;
                    if (this.onFlap) {
                        this.onFlap(effectiveVol);
                    }
                }
            } else {
                // Reset trigger lock once sound drops below 65% of threshold
                if (effectiveVol < this.threshold * 0.65) {
                    this.hasTriggeredInCurrentBurst = false;
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
        return Math.pow(norm, 0.65);
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
                    const sample = this.floatArray[i];
                    sumSquares += sample * sample;
                }
                const rms = Math.sqrt(sumSquares / this.floatArray.length);
                samples.push(rms);

                const elapsed = performance.now() - startTime;
                const progress = Math.min(1.0, elapsed / durationMs);
                if (progressCallback) progressCallback(progress);

                if (elapsed >= durationMs) {
                    clearInterval(sampleInterval);
                    this.isCalibrating = false;

                    const avg = samples.reduce((a, b) => a + b, 0) / (samples.length || 1);
                    const max = Math.max(...samples, 0.003);

                    this.ambientNoise = Math.min(0.04, Math.max(0.002, avg));
                    this.threshold = Math.min(0.24, Math.max(0.05, max * 4.0 + 0.02));

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
            this.sensitivity = 0.85;
            this.threshold = 0.16;
        } else {
            // 'normal'
            this.sensitivity = 1.15;
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
