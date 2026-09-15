/**
 * AudioController - Autonomous Relative Sound Trigger & Adaptive Noise Engine
 * 
 * Core Concept:
 * - Sound Trigger: Player makes a sound/speaks -> Sound level detected -> Fluffy bird reacts.
 * - Relative Threshold: triggerThreshold = adaptiveNoiseFloor + dynamicSoundMargin
 * - Continuous Background Noise (Fans, AC, Laptop Cooler) -> Tracked into noise floor -> IGNORED.
 * - Short Intentional Sound Burst ("Hop!", "Jump!", "Ah!", voice) -> Rises above noise floor -> TRIGGER.
 * - Zero Player Configuration: No manual sensitivity sliders, volume knobs, or calibration buttons.
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

        // Relative Sound Trigger & Adaptive Floor Properties
        this.currentSoundLevel = 0;   // Current measured sound level (0.0 to 1.0)
        this.smoothedLevel = 0;       // Smooth envelope for float physics
        this.noiseFloor = 0.012;      // Dynamic background noise floor (auto-adapting)
        this.triggerThreshold = 0.045;// Calculated relative trigger threshold
        this.soundDelta = 0;          // Energy above noise floor (currentSoundLevel - noiseFloor)
        this.isSoundTriggered = false;// Live trigger boolean

        // Burst Envelope & Cooldown
        this.lastFlapTime = 0;
        this.flapCooldownMs = 150;    // 150ms clean cooldown between intentional flaps
        this.hasTriggeredInBurst = false;
        this.consecutiveAboveFrames = 0;

        // Diagnostics metrics (for Dev/Admin HUD)
        this.rawRms = 0;
        this.rawPeak = 0;
        this.snrDb = 0;
        this.totalTriggerEvents = 0;

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

            // Universal clean microphone stream across all mobile & desktop browsers
            let stream = null;
            try {
                stream = await navigator.mediaDevices.getUserMedia({
                    audio: {
                        echoCancellation: true,
                        noiseSuppression: true,
                        autoGainControl: false // Disable AGC so ambient noise is not artificially boosted
                    }
                });
            } catch (err) {
                stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            }

            this.stream = stream;
            this.microphone = this.audioCtx.createMediaStreamSource(stream);

            // 1. High-Pass Filter (140Hz cutoff) - Strips desk rumble, sub-bass air rush, motor vibrations
            this.highpassFilter = this.audioCtx.createBiquadFilter();
            this.highpassFilter.type = 'highpass';
            this.highpassFilter.frequency.value = 140;
            this.highpassFilter.Q.value = 0.707;

            // 2. Low-Pass Filter (4500Hz cutoff) - Removes high-frequency electronic hiss
            this.lowpassFilter = this.audioCtx.createBiquadFilter();
            this.lowpassFilter.type = 'lowpass';
            this.lowpassFilter.frequency.value = 4500;
            this.lowpassFilter.Q.value = 0.707;

            // 3. Audio Spectrum Analyser (512 FFT bins, fast response)
            this.analyser = this.audioCtx.createAnalyser();
            this.analyser.fftSize = 512;
            this.analyser.smoothingTimeConstant = 0.08;

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
     * Observes the room ambient sound level for ~600ms upon microphone startup.
     * The player does NOT need to do anything or say anything.
     */
    silentBackgroundCalibration() {
        const samples = [];
        const start = performance.now();
        const duration = 600; // 600ms ambient observation

        const collectInterval = setInterval(() => {
            if (!this.analyser || !this.floatArray) return;
            this.analyser.getFloatTimeDomainData(this.floatArray);

            let sumSquares = 0;
            for (let i = 0; i < this.floatArray.length; i++) {
                sumSquares += this.floatArray[i] * this.floatArray[i];
            }
            const rms = Math.sqrt(sumSquares / this.floatArray.length);
            samples.push(rms);

            if (performance.now() - start >= duration) {
                clearInterval(collectInterval);
                if (samples.length > 0) {
                    const avg = samples.reduce((a, b) => a + b, 0) / samples.length;
                    const min = Math.min(...samples);
                    this.noiseFloor = Math.max(0.004, Math.min(0.05, (avg * 0.7) + (min * 0.3)));
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

        // 1. Capture Time-Domain Waveform & Frequency Data
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

        // Current composite sound level (weighted blend of RMS energy and peak deviation)
        this.currentSoundLevel = (rms * 0.70) + (maxPeak * 0.30);
        this.smoothedLevel = (this.smoothedLevel * 0.50) + (this.currentSoundLevel * 0.50);

        // 2. Automatic Noise Floor Adaptation (Slow tracking of continuous background noise)
        // - If sound is quiescent (below trigger threshold), adapt noise floor to match fan / AC / room hum.
        // - FREEZE adaptation when sound rises above threshold, so player voice NEVER raises the noise floor!
        const isSoundActive = this.currentSoundLevel > this.triggerThreshold;

        if (!isSoundActive) {
            if (this.currentSoundLevel < this.noiseFloor) {
                // Room got quieter: adapt downwards quickly (~200ms)
                this.noiseFloor = this.noiseFloor * 0.90 + this.currentSoundLevel * 0.10;
            } else {
                // Background noise slowly rose (e.g. fan switched on): adapt upwards slowly (~3.5s)
                this.noiseFloor = this.noiseFloor * 0.996 + this.currentSoundLevel * 0.004;
            }
            this.noiseFloor = Math.max(0.003, Math.min(0.08, this.noiseFloor));
        }

        // 3. Dynamic Relative Trigger Threshold
        // triggerThreshold = adaptiveNoiseFloor + dynamicSoundMargin
        // Quiet Room (noiseFloor ~ 0.005) -> Margin is ~0.028 -> Soft speech triggers easily!
        // Noisy Room (noiseFloor ~ 0.040) -> Margin expands -> Fan hum is ignored!
        const dynamicMargin = Math.max(0.025, this.noiseFloor * 0.65 + 0.020);
        this.triggerThreshold = this.noiseFloor + dynamicMargin;
        this.soundDelta = Math.max(0, this.currentSoundLevel - this.noiseFloor);

        // Signal-to-Noise Ratio (dB)
        this.snrDb = 20 * Math.log10(Math.max(1e-4, this.currentSoundLevel) / Math.max(1e-4, this.noiseFloor));

        // 4. Short Sound Burst & Energy Spike Detection
        const now = performance.now();
        const passesThreshold = this.currentSoundLevel >= this.triggerThreshold && this.soundDelta >= dynamicMargin;

        if (passesThreshold) {
            this.consecutiveAboveFrames++;
        } else {
            this.consecutiveAboveFrames = 0;
        }

        // Require at least 2 consecutive frames (~25ms) above threshold to eliminate single-sample electrical spikes
        const isTriggerConditionMet = passesThreshold && this.consecutiveAboveFrames >= 2;
        const previousTriggerState = this.isSoundTriggered;
        this.isSoundTriggered = isTriggerConditionMet;

        // 5. Sound Trigger Execution (Vocal Flap vs Continuous Float)
        if (this.mode === 'vocal_flap') {
            const timeSinceLastFlap = now - this.lastFlapTime;

            // Auto-reset burst lock when sound level drops back near baseline OR cooldown expires
            if (timeSinceLastFlap > this.flapCooldownMs * 1.5 || this.currentSoundLevel < this.noiseFloor + (dynamicMargin * 0.6)) {
                this.hasTriggeredInBurst = false;
            }

            if (isTriggerConditionMet && !this.hasTriggeredInBurst && timeSinceLastFlap > this.flapCooldownMs) {
                this.lastFlapTime = now;
                this.hasTriggeredInBurst = true;
                this.totalTriggerEvents++;

                if (this.onFlap) {
                    this.onFlap(this.getCurrentIntensity());
                }
            }
        }

        // Notify State Change for Player UI
        if (this.isSoundTriggered !== previousTriggerState && this.onStateChange) {
            this.onStateChange(this.isSoundTriggered ? 'ACTIVE' : 'IDLE', this.currentSoundLevel, this.getCurrentIntensity());
        }
    }

    getCurrentIntensity() {
        if (!this.isListening) return 0;
        if (this.currentSoundLevel <= this.noiseFloor) return 0;
        
        // Intensity curve for continuous float (normalized above noise floor)
        const dynamicMargin = Math.max(0.025, this.noiseFloor * 0.65 + 0.020);
        const norm = Math.min(1.0, this.soundDelta / (dynamicMargin * 2.2));
        return Math.max(0.20, Math.pow(norm, 0.70));
    }

    setMode(mode) {
        if (mode === 'vocal_flap' || mode === 'continuous_float') {
            this.mode = mode;
        }
    }
}

window.audioController = new AudioController();
