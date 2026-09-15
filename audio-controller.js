/**
 * AudioController - High Precision Voice Intensity & Speech Trigger Handler
 * Uses Web Audio API with float time-domain and frequency band analysis for instantaneous voice detection.
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

        // Settings (Optimized for instant speech reactivity)
        this.mode = 'vocal_flap'; // 'vocal_flap' or 'continuous_float'
        this.sensitivity = 1.0;
        this.threshold = 0.12;    // High-sensitivity speech threshold
        this.ambientNoise = 0.005; // Adaptive background noise floor tracker

        // Runtime state
        this.currentVolume = 0;
        this.smoothedVolume = 0;
        this.rawRms = 0;
        this.lastFlapTime = 0;
        this.flapCooldownMs = 160; // Snappy 160ms cooldown for rapid flaps
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

            // Cross-platform media stream constraints with fallback
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
                // Fallback to standard basic audio constraint
                stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            }

            this.stream = stream;
            this.microphone = this.audioCtx.createMediaStreamSource(stream);
            this.analyser = this.audioCtx.createAnalyser();
            this.analyser.fftSize = 512;
            this.analyser.smoothingTimeConstant = 0.15;

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
        if (!this.analyser || !this.floatArray) return;

        // 1. Time-Domain Float Precision RMS
        this.analyser.getFloatTimeDomainData(this.floatArray);
        let sumSquares = 0;
        for (let i = 0; i < this.floatArray.length; i++) {
            const sample = this.floatArray[i];
            sumSquares += sample * sample;
        }
        const rms = Math.sqrt(sumSquares / this.floatArray.length);
        this.rawRms = rms;

        // 2. Frequency-Domain Voice Band Energy (150Hz - 3200Hz)
        let voiceFreqEnergy = 0;
        if (this.freqArray) {
            this.analyser.getByteFrequencyData(this.freqArray);
            let freqSum = 0;
            const startBin = 2;
            const endBin = Math.min(36, this.freqArray.length);
            for (let i = startBin; i < endBin; i++) {
                freqSum += this.freqArray[i];
            }
            voiceFreqEnergy = (freqSum / ((endBin - startBin) * 255));
        }

        // 3. Dynamic Ambient Tracking (Fast adapts to room silence)
        if (rms < this.ambientNoise * 1.6 || this.ambientNoise === 0) {
            this.ambientNoise = this.ambientNoise * 0.96 + rms * 0.04;
        }

        // 4. Combined Vocal Score
        const rmsSignal = Math.max(0, rms - this.ambientNoise * 0.85);
        const combinedScore = (rmsSignal * 9.0) + (voiceFreqEnergy * 0.40);
        let rawVolume = Math.min(1.0, combinedScore * this.sensitivity);

        // Smoothing for UI & Flight Physics
        const currentSmoothing = this.mode === 'continuous_float' ? 0.45 : 0.60;
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
                // Unlock burst once volume drops below threshold * 0.70
                if (effectiveVol < this.threshold * 0.70) {
                    this.hasTriggeredInCurrentBurst = false;
                }
            }
        }
    }

    getCurrentIntensity() {
        if (!this.isListening) return 0;
        if (this.smoothedVolume < 0.02) return 0;
        
        // Scale relative to threshold so gentle hum creates smooth climb
        const targetRef = Math.max(0.05, this.threshold);
        const norm = Math.min(1.0, this.smoothedVolume / (targetRef * 1.15));
        return Math.pow(norm, 0.68); // Responsive lift curve
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
                    const max = Math.max(...samples, 0.005);

                    this.ambientNoise = Math.min(0.05, Math.max(0.003, avg));
                    this.threshold = Math.min(0.30, Math.max(0.08, max * 4.5 + 0.03));

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
            this.sensitivity = 1.35;
            this.threshold = 0.09;
        } else if (preset === 'noisy') {
            this.sensitivity = 0.75;
            this.threshold = 0.20;
        } else {
            // 'normal'
            this.sensitivity = 1.0;
            this.threshold = 0.12;
        }
    }

    setMode(mode) {
        if (mode === 'vocal_flap' || mode === 'continuous_float') {
            this.mode = mode;
        }
    }
}

window.audioController = new AudioController();
