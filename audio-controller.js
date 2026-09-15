/**
 * AudioController - Voice Intensity and Microphone Handler
 * Uses Web Audio API to detect vocal spikes (shouts/words) and continuous volume (humming/screaming).
 */
class AudioController {
    constructor() {
        this.audioCtx = null;
        this.analyser = null;
        this.microphone = null;
        this.dataArray = null;
        this.isListening = false;
        this.isCalibrating = false;

        // Settings (Constant balanced defaults for publishable release)
        this.mode = 'vocal_flap'; // 'vocal_flap' or 'continuous_float'
        this.sensitivity = 1.0;   // Balanced constant sensitivity
        this.threshold = 0.20;    // Balanced voice trigger threshold
        this.noiseFloor = 0.04;   // Background ambient noise floor
        this.smoothing = 0.78;    // Smoothing factor for volume meter

        // Runtime state
        this.currentVolume = 0;
        this.smoothedVolume = 0;
        this.lastFlapTime = 0;
        this.flapCooldownMs = 180; // Minimum time between consecutive voice flap triggers
        this.hasTriggeredInCurrentBurst = false;

        // Callbacks
        this.onFlap = null;
        this.onLevelUpdate = null;
        this.onError = null;
    }

    async initMicrophone() {
        if (this.isListening) return true;

        try {
            const AudioCtx = window.AudioContext || window.webkitAudioContext;
            if (!AudioCtx) {
                throw new Error("Web Audio API is not supported in this browser.");
            }

            this.audioCtx = new AudioCtx();
            if (this.audioCtx.state === 'suspended') {
                await this.audioCtx.resume();
            }

            const stream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    echoCancellation: false,
                    noiseSuppression: false,
                    autoGainControl: false
                }
            });

            this.microphone = this.audioCtx.createMediaStreamSource(stream);
            this.analyser = this.audioCtx.createAnalyser();
            this.analyser.fftSize = 512;
            this.analyser.smoothingTimeConstant = 0.3;

            this.microphone.connect(this.analyser);
            this.dataArray = new Uint8Array(this.analyser.frequencyBinCount);

            this.isListening = true;
            this.startAnalysisLoop();
            return true;
        } catch (err) {
            console.error("Microphone access error:", err);
            if (this.onError) {
                this.onError(err);
            }
            return false;
        }
    }

    startAnalysisLoop() {
        const update = () => {
            if (!this.isListening) return;

            this.analyzeAudio();

            if (this.onLevelUpdate) {
                const isTriggered = this.mode === 'vocal_flap' 
                    ? this.smoothedVolume >= this.threshold 
                    : this.smoothedVolume > this.noiseFloor;
                this.onLevelUpdate(this.smoothedVolume, this.threshold, isTriggered);
            }

            requestAnimationFrame(update);
        };
        requestAnimationFrame(update);
    }

    analyzeAudio() {
        if (!this.analyser || !this.dataArray) return;

        this.analyser.getByteTimeDomainData(this.dataArray);

        // Calculate Root Mean Square (RMS) volume
        let sumSquares = 0;
        for (let i = 0; i < this.dataArray.length; i++) {
            const normalized = (this.dataArray[i] - 128) / 128; // -1.0 to 1.0
            sumSquares += normalized * normalized;
        }
        const rms = Math.sqrt(sumSquares / this.dataArray.length);

        // Apply noise floor deduction and sensitivity multiplier
        let rawVolume = Math.max(0, rms - this.noiseFloor) * (this.sensitivity * 4.2);
        rawVolume = Math.min(1.0, rawVolume);

        // Faster responsiveness in continuous float mode, smoother in vocal flap mode
        const currentSmoothing = this.mode === 'continuous_float' ? 0.58 : 0.78;
        this.smoothedVolume = (this.smoothedVolume * currentSmoothing) + (rawVolume * (1 - currentSmoothing));
        this.currentVolume = rawVolume;

        const now = performance.now();

        if (this.mode === 'vocal_flap') {
            // Check if volume crossed threshold
            if (this.smoothedVolume >= this.threshold) {
                if (!this.hasTriggeredInCurrentBurst && (now - this.lastFlapTime > this.flapCooldownMs)) {
                    this.lastFlapTime = now;
                    this.hasTriggeredInCurrentBurst = true;
                    if (this.onFlap) {
                        this.onFlap(this.smoothedVolume);
                    }
                }
            } else {
                // Reset burst lock once volume drops slightly below threshold
                if (this.smoothedVolume < this.threshold * 0.75) {
                    this.hasTriggeredInCurrentBurst = false;
                }
            }
        }
    }

    /**
     * For continuous float mode: returns normalized lift force (0.0 to 1.0)
     */
    getCurrentIntensity() {
        if (!this.isListening) return 0;
        if (this.smoothedVolume < 0.02) return 0;
        
        // Scale relative to threshold so humming easily gives hover & climb
        const targetRef = Math.max(0.08, this.threshold);
        const norm = Math.min(1.0, this.smoothedVolume / (targetRef * 1.25));
        return Math.pow(norm, 0.75); // Responsive curve for easy voice control
    }

    /**
     * Auto calibrate noise floor by listening to background ambient sound for 2 seconds.
     */
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
                if (!this.analyser || !this.dataArray) return;
                this.analyser.getByteTimeDomainData(this.dataArray);

                let sumSquares = 0;
                for (let i = 0; i < this.dataArray.length; i++) {
                    const norm = (this.dataArray[i] - 128) / 128;
                    sumSquares += norm * norm;
                }
                const rms = Math.sqrt(sumSquares / this.dataArray.length);
                samples.push(rms);

                const elapsed = performance.now() - startTime;
                const progress = Math.min(1.0, elapsed / durationMs);
                if (progressCallback) progressCallback(progress);

                if (elapsed >= durationMs) {
                    clearInterval(sampleInterval);
                    this.isCalibrating = false;

                    // Calculate average ambient noise and peak
                    const avg = samples.reduce((a, b) => a + b, 0) / (samples.length || 1);
                    const max = Math.max(...samples, 0.01);

                    // Set noise floor just above max ambient
                    this.noiseFloor = Math.min(0.15, Math.max(0.015, avg * 1.3));
                    // Set threshold comfortably above ambient noise
                    this.threshold = Math.min(0.7, Math.max(0.12, max * 2.2 + 0.08));

                    resolve({
                        avgAmbient: avg,
                        maxAmbient: max,
                        noiseFloor: this.noiseFloor,
                        threshold: this.threshold
                    });
                }
            }, 30);
        });
    }

    setThreshold(val) {
        this.threshold = Math.max(0.05, Math.min(0.85, parseFloat(val)));
    }

    setSensitivity(val) {
        this.sensitivity = Math.max(0.2, Math.min(3.0, parseFloat(val)));
    }

    setMode(mode) {
        if (mode === 'vocal_flap' || mode === 'continuous_float') {
            this.mode = mode;
        }
    }
}

window.audioController = new AudioController();
