/**
 * AudioController - Autonomous Voice Trigger & Adaptive Noise Engine for Fluffy Bird
 * 
 * Responsiveness & Behavior:
 * - Direct Sound Input -> Fluffy bird flaps immediately upon speaking ("Hop!", "Jump!", "Ah!", voice, whistle, clap).
 * - Automatic Ambient Noise Rejection: Continuously tracks steady room/fan background noise.
 * - Dynamic Sensitivity: Calculates threshold = ambientNoiseFloor + margin so soft speech triggers easily in quiet rooms, while fan noise is ignored in noisy rooms.
 * - Zero Configuration: No manual sensitivity or calibration settings required from the player.
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

        // Lifecycle & State
        this.isListening = false;
        this.isCalibrated = false;
        this._loopRunning = false;
        this.mode = 'vocal_flap'; // 'vocal_flap' or 'continuous_float'

        // Audio Measurement Properties (0.0 to 1.0)
        this.currentSoundLevel = 0;   // Live measured composite volume
        this.smoothedLevel = 0;       // Smooth envelope
        this.noiseFloor = 0.020;      // Ambient background baseline
        this.triggerThreshold = 0.080;// Relative trigger threshold
        this.soundDelta = 0;          // Energy above noise floor
        this.isSoundTriggered = false;// Live boolean (true when above threshold)
        this.isAboveThreshold = false;// Debounce state for discrete flaps

        // Flap Timing & Cooldown
        this.lastFlapTime = 0;
        this.flapCooldownMs = 140;    // 140ms clean cooldown for rhythmic rapid hopping
        this.totalTriggerEvents = 0;

        // Diagnostics
        this.rawRms = 0;
        this.rawPeak = 0;
        this.rawFreq = 0;
        this.snrDb = 0;

        // Callbacks
        this.onFlap = null;
        this.onStateChange = null;
        this.onDiagnosticsUpdate = null;
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

            // Universal high-compatibility microphone stream
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
                // Fallback to basic audio stream
                stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            }

            this.stream = stream;
            this.microphone = this.audioCtx.createMediaStreamSource(stream);

            // 1. High-Pass Filter (120Hz cutoff): Cuts desk thuds & motor vibrations without muffling voice
            this.highpassFilter = this.audioCtx.createBiquadFilter();
            this.highpassFilter.type = 'highpass';
            this.highpassFilter.frequency.value = 120;
            this.highpassFilter.Q.value = 0.707;

            // 2. Low-Pass Filter (4500Hz cutoff): Cuts ultra-high electrical static
            this.lowpassFilter = this.audioCtx.createBiquadFilter();
            this.lowpassFilter.type = 'lowpass';
            this.lowpassFilter.frequency.value = 4500;
            this.lowpassFilter.Q.value = 0.707;

            // 3. Audio Spectrum Analyser (fast response, low smoothing)
            this.analyser = this.audioCtx.createAnalyser();
            this.analyser.fftSize = 512;
            this.analyser.smoothingTimeConstant = 0.05;

            // Connect DSP pipeline: Mic -> High-Pass -> Low-Pass -> Analyser
            this.microphone.connect(this.highpassFilter);
            this.highpassFilter.connect(this.lowpassFilter);
            this.lowpassFilter.connect(this.analyser);

            this.timeArray = new Uint8Array(this.analyser.fftSize);
            this.freqArray = new Uint8Array(this.analyser.frequencyBinCount);
            this.floatArray = new Float32Array(this.analyser.fftSize);

            this.isListening = true;
            this.silentBackgroundCalibration();
            this.startAnalysisLoop();
            return true;
        } catch (err) {
            console.warn("Microphone initialization error:", err);
            this.isListening = false;
            if (this.onError) {
                this.onError(err);
            }
            return false;
        }
    }

    /**
     * Silent Background Calibration:
     * Samples room background noise for 500ms on startup.
     */
    silentBackgroundCalibration() {
        const samples = [];
        const start = performance.now();
        const duration = 500;

        const collectInterval = setInterval(() => {
            if (!this.analyser || !this.floatArray) return;
            this.analyser.getFloatTimeDomainData(this.floatArray);

            let sumSquares = 0;
            for (let i = 0; i < this.floatArray.length; i++) {
                sumSquares += this.floatArray[i] * this.floatArray[i];
            }
            const rms = Math.sqrt(sumSquares / this.floatArray.length);
            samples.push(rms * 2.5);

            if (performance.now() - start >= duration) {
                clearInterval(collectInterval);
                if (samples.length > 0) {
                    const avg = samples.reduce((a, b) => a + b, 0) / samples.length;
                    this.noiseFloor = Math.max(0.010, Math.min(0.080, avg));
                }
                this.isCalibrated = true;
            }
        }, 25);
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

                if (this.onDiagnosticsUpdate) {
                    this.onDiagnosticsUpdate({
                        currentLevel: this.currentSoundLevel,
                        noiseFloor: this.noiseFloor,
                        triggerThreshold: this.triggerThreshold,
                        soundDelta: this.soundDelta,
                        isTriggered: this.isSoundTriggered,
                        state: this.isSoundTriggered ? 'ACTIVE' : 'IDLE',
                        snrDb: this.snrDb,
                        rawRms: this.rawRms,
                        totalEvents: this.totalTriggerEvents
                    });
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

        // 1. Time-Domain RMS & Peak Sample Extraction
        this.analyser.getFloatTimeDomainData(this.floatArray);
        this.analyser.getByteFrequencyData(this.freqArray);

        const N = this.floatArray.length;
        let sumSquares = 0;
        let maxPeak = 0;

        for (let i = 0; i < N; i++) {
            const val = this.floatArray[i];
            const abs = Math.abs(val);
            if (abs > maxPeak) maxPeak = abs;
            sumSquares += val * val;
        }

        const rms = Math.sqrt(sumSquares / N);
        this.rawRms = rms;
        this.rawPeak = maxPeak;

        // 2. Frequency-Domain Speech Energy (180Hz - 3800Hz)
        let freqSum = 0;
        const startBin = 2; // > 170Hz
        const endBin = Math.min(48, this.freqArray.length); // < 4100Hz
        for (let i = startBin; i < endBin; i++) {
            freqSum += this.freqArray[i];
        }
        const freqAvg = (freqSum / ((endBin - startBin) * 255));
        this.rawFreq = freqAvg;

        // 3. Composite Sound Level (Sensitively scaled so normal speech reaches 0.25 - 0.85)
        const compositeSignal = (rms * 2.8) + (maxPeak * 0.70) + (freqAvg * 1.30);
        this.currentSoundLevel = Math.min(1.0, Math.max(0, compositeSignal));
        this.smoothedLevel = (this.smoothedLevel * 0.60) + (this.currentSoundLevel * 0.40);

        // 4. Adaptive Ambient Noise Floor Tracking
        // - In quiescent moments (below threshold), adapt baseline to track room fans or ambient changes
        // - Freeze adaptation when speech/sound is active so voice never raises the noise baseline
        const isSoundAbove = this.currentSoundLevel > this.triggerThreshold;

        if (!isSoundAbove) {
            if (this.currentSoundLevel < this.noiseFloor) {
                this.noiseFloor = this.noiseFloor * 0.94 + this.currentSoundLevel * 0.06;
            } else {
                this.noiseFloor = this.noiseFloor * 0.992 + this.currentSoundLevel * 0.008;
            }
            this.noiseFloor = Math.max(0.008, Math.min(0.120, this.noiseFloor));
        }

        // 5. Dynamic Trigger Threshold
        // Trigger Margin dynamically scales: ~0.04 in quiet rooms, ~0.08 in noisy rooms
        const dynamicMargin = Math.max(0.040, this.noiseFloor * 0.75 + 0.030);
        this.triggerThreshold = this.noiseFloor + dynamicMargin;
        this.soundDelta = Math.max(0, this.currentSoundLevel - this.noiseFloor);

        // Signal-to-Noise Ratio (dB)
        this.snrDb = 20 * Math.log10(Math.max(1e-4, this.currentSoundLevel) / Math.max(1e-4, this.noiseFloor));

        // 6. Flap Triggering Logic
        const now = performance.now();
        const passesThreshold = this.currentSoundLevel >= this.triggerThreshold;
        const previousTriggerState = this.isSoundTriggered;
        this.isSoundTriggered = passesThreshold;

        if (this.mode === 'vocal_flap') {
            const timeSinceLastFlap = now - this.lastFlapTime;

            // Trigger flap when volume crosses threshold upwards AND cooldown has passed
            if (passesThreshold && !this.isAboveThreshold && timeSinceLastFlap > this.flapCooldownMs) {
                this.lastFlapTime = now;
                this.isAboveThreshold = true;
                this.totalTriggerEvents++;

                if (this.onFlap) {
                    this.onFlap(this.getCurrentIntensity());
                }
            } else if (!passesThreshold) {
                this.isAboveThreshold = false;
            }
        }

        // Notify State Change for UI
        if (this.isSoundTriggered !== previousTriggerState && this.onStateChange) {
            this.onStateChange(this.isSoundTriggered ? 'ACTIVE' : 'IDLE', this.currentSoundLevel, this.getCurrentIntensity());
        }
    }

    getCurrentIntensity() {
        if (!this.isListening) return 0;
        if (this.currentSoundLevel <= this.noiseFloor) return 0;

        const dynamicMargin = Math.max(0.040, this.noiseFloor * 0.75 + 0.030);
        const norm = Math.min(1.0, this.soundDelta / (dynamicMargin * 2.5));
        return Math.max(0.20, Math.pow(norm, 0.75));
    }

    setMode(mode) {
        if (mode === 'vocal_flap' || mode === 'continuous_float') {
            this.mode = mode;
        }
    }
}

window.audioController = new AudioController();
