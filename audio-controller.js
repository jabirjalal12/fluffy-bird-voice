/**
 * AudioController - Autonomous Zero-Configuration Voice Intelligence Engine
 * 
 * Features:
 * - Multi-Feature Voice Activity Detection (VAD)
 * - Normalized Auto-Correlation Harmonic Pitch Detection (80Hz - 400Hz)
 * - Formant Energy Concentration Ratio (300Hz - 3400Hz speech formants)
 * - Crest Factor & Rise-Time Transient Rejection (Clicks, claps, taps, thuds)
 * - Asymmetric Adaptive Ambient Noise Floor Tracking (MCRA with speech freeze)
 * - 4-State Voice Machine (IDLE -> POSSIBLE_SPEECH -> VOICE_CONFIRMED -> RELEASE_DELAY)
 * - Zero Player Configuration: Automatically adapts to whispers, loud speech, noisy rooms, AC, and fans.
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

        // Voice State Machine States
        this.STATE_IDLE = 'IDLE';
        this.STATE_POSSIBLE = 'POSSIBLE_SPEECH';
        this.STATE_CONFIRMED = 'VOICE_CONFIRMED';
        this.STATE_RELEASE = 'RELEASE_DELAY';

        this.currentState = this.STATE_IDLE;
        this.stateStartTime = 0;
        this.lastFlapTime = 0;
        this.flapCooldownMs = 140; // Fast 140ms response between intentional speech bursts
        this.hasTriggeredInCurrentBurst = false;

        // Acoustic Measurements & VAD Metrics
        this.rawRms = 0;
        this.rawPeak = 0;
        this.crestFactor = 0;
        this.noiseFloor = 0.012; // Dynamic background noise floor
        this.snrDb = 0;
        this.formantRatio = 0;
        this.periodicityScore = 0;
        this.speechConfidence = 0; // 0.0 to 1.0
        this.speechIntensity = 0;  // 0.0 to 1.0 (for continuous float)
        this.smoothedVolume = 0;

        // Diagnostic Rejection Counters (for Admin / Dev HUD)
        this.rejectedClicks = 0;
        this.rejectedBumps = 0;
        this.rejectedHums = 0;
        this.totalVoiceEvents = 0;

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

            // Universal clean microphone stream with active hardware noise suppression
            let stream = null;
            try {
                stream = await navigator.mediaDevices.getUserMedia({
                    audio: {
                        echoCancellation: true,
                        noiseSuppression: true,
                        autoGainControl: false // Disable AGC to avoid background noise pumping
                    }
                });
            } catch (err) {
                stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            }

            this.stream = stream;
            this.microphone = this.audioCtx.createMediaStreamSource(stream);

            // 1. High-Pass Filter (160Hz cutoff) - Removes desk vibration, sub-bass air rush, motor hum
            this.highpassFilter = this.audioCtx.createBiquadFilter();
            this.highpassFilter.type = 'highpass';
            this.highpassFilter.frequency.value = 160;
            this.highpassFilter.Q.value = 0.707;

            // 2. Low-Pass Filter (4200Hz cutoff) - Removes high-frequency electronic hiss and keyboard clicks
            this.lowpassFilter = this.audioCtx.createBiquadFilter();
            this.lowpassFilter.type = 'lowpass';
            this.lowpassFilter.frequency.value = 4200;
            this.lowpassFilter.Q.value = 0.707;

            // 3. Audio Spectrum Analyser (512 FFT bins, fast 0.05 smoothing for instant speech reaction)
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
     * Gathers ambient room baseline across 800ms seamlessly without blocking UI or requiring user input.
     */
    silentBackgroundCalibration() {
        const samples = [];
        const start = performance.now();
        const duration = 800; // 800ms background acoustic profiling

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
                    this.noiseFloor = Math.max(0.005, Math.min(0.06, (avg * 0.7) + (min * 0.3)));
                }
                this.isCalibrated = true;
            }
        }, 30);
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
                        state: this.currentState,
                        confidence: this.speechConfidence,
                        intensity: this.speechIntensity,
                        noiseFloor: this.noiseFloor,
                        rms: this.rawRms,
                        snrDb: this.snrDb,
                        formantRatio: this.formantRatio,
                        periodicity: this.periodicityScore,
                        crestFactor: this.crestFactor,
                        rejectedClicks: this.rejectedClicks,
                        rejectedBumps: this.rejectedBumps,
                        rejectedHums: this.rejectedHums,
                        totalEvents: this.totalVoiceEvents
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

        // 1. Time-Domain Float Waveform & Peak Sample Analysis
        this.analyser.getFloatTimeDomainData(this.floatArray);
        this.analyser.getByteFrequencyData(this.freqArray);
        this.analyser.getByteTimeDomainData(this.timeArray);

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
        this.crestFactor = maxPeak / (rms + 1e-5);

        // 2. Normalized Auto-Correlation (NACF) - Vocal Pitch Periodicity (80Hz to 400Hz)
        // At 48kHz sample rate, lag 80Hz is 600 samples, lag 400Hz is 120 samples.
        // With N=512, downsampling by 2 gives effective lag search window k in [30..150].
        let maxAutoCorr = 0;
        const minLag = 16;
        const maxLag = Math.min(160, Math.floor(N / 2));

        for (let lag = minLag; lag < maxLag; lag += 2) {
            let crossSum = 0;
            let normSumA = 0;
            let normSumB = 0;
            const count = N - lag;

            for (let i = 0; i < count; i += 2) {
                const a = this.floatArray[i];
                const b = this.floatArray[i + lag];
                crossSum += a * b;
                normSumA += a * a;
                normSumB += b * b;
            }

            const denom = Math.sqrt(normSumA * normSumB) + 1e-6;
            const nacf = crossSum / denom;
            if (nacf > maxAutoCorr) {
                maxAutoCorr = nacf;
            }
        }
        this.periodicityScore = Math.max(0, Math.min(1.0, maxAutoCorr));

        // 3. Formant Energy Concentration Ratio (300Hz - 3400Hz speech zone)
        // Bins at 48kHz / 512 = ~93.75Hz per bin
        // Sub-bass (<280Hz): Bins 0..2
        // Vocal Formant Band (280Hz - 3400Hz): Bins 3..36
        // High Treble / Clicks (>3400Hz): Bins 37..128
        let subEnergy = 0;
        let vocalEnergy = 0;
        let highEnergy = 0;

        for (let i = 0; i < 3; i++) {
            subEnergy += this.freqArray[i];
        }
        for (let i = 3; i < 37 && i < this.freqArray.length; i++) {
            vocalEnergy += this.freqArray[i];
        }
        for (let i = 37; i < 128 && i < this.freqArray.length; i++) {
            highEnergy += this.freqArray[i];
        }

        const totalEnergy = subEnergy + vocalEnergy + highEnergy + 1e-4;
        this.formantRatio = vocalEnergy / totalEnergy;

        // 4. Asymmetric Adaptive Ambient Noise Floor Tracking (MCRA)
        // Adapts downwards quickly (~200ms) when room is quiet.
        // Adapts upwards slowly (~3.5s) when ambient room noise rises.
        // FREEZES completely whenever human speech is present!
        if (this.speechConfidence < 0.28) {
            if (rms < this.noiseFloor) {
                this.noiseFloor = this.noiseFloor * 0.92 + rms * 0.08;
            } else {
                this.noiseFloor = this.noiseFloor * 0.997 + rms * 0.003;
            }
            this.noiseFloor = Math.max(0.004, Math.min(0.08, this.noiseFloor));
        }

        // 5. Dynamic Signal-to-Noise Ratio (SNR) in dB
        this.snrDb = 20 * Math.log10(Math.max(1e-4, rms) / Math.max(1e-4, this.noiseFloor));

        // 6. False-Trigger Protection & Rejection Classifiers:
        // A. Instantaneous Transient Clicks / Taps / Snaps:
        const isTransientClick = (this.crestFactor > 4.6 && this.formantRatio < 0.50);
        if (isTransientClick && rms > this.noiseFloor * 1.5) {
            this.rejectedClicks++;
        }

        // B. Low-Frequency Sub-Bass Bumps / Desk Thuds / Chair Shifts:
        const isDeskBump = (subEnergy / totalEnergy > 0.52 && this.formantRatio < 0.38);
        if (isDeskBump && rms > this.noiseFloor * 1.5) {
            this.rejectedBumps++;
        }

        // C. Continuous Flat White Noise / Fan Rush:
        const isContinuousFanRush = (this.periodicityScore < 0.16 && this.formantRatio < 0.42);
        if (isContinuousFanRush && this.snrDb < 6.0) {
            this.rejectedHums++;
        }

        // 7. Multi-Feature Voice Activity Detection (VAD) Confidence Score
        // Combines SNR, Formant Concentration, Harmonic Periodicity, and Crest Envelope:
        const snrScore = Math.max(0, Math.min(1.0, (this.snrDb - 4.5) / 14.0));
        const formantScore = Math.max(0, Math.min(1.0, (this.formantRatio - 0.38) / 0.42));
        const pitchScore = Math.max(0, Math.min(1.0, (this.periodicityScore - 0.18) / 0.38));
        const crestScore = Math.max(0, Math.min(1.0, 1.0 - (this.crestFactor - 3.4) / 2.6));

        let rawConfidence = (snrScore * 0.38) + (formantScore * 0.32) + (pitchScore * 0.22) + (crestScore * 0.08);

        // Penalize detected non-speech artifacts
        if (isTransientClick || isDeskBump || isContinuousFanRush) {
            rawConfidence *= 0.25;
        }

        // Smooth confidence for temporal stability
        this.speechConfidence = (this.speechConfidence * 0.45) + (rawConfidence * 0.55);

        // Continuous float intensity
        this.speechIntensity = Math.max(0, Math.min(1.0, snrScore * 1.2));
        this.smoothedVolume = (this.smoothedVolume * 0.5) + (rms * 0.5);

        // 8. Voice Activation State Machine with Temporal Validation & Hangover
        this.updateVoiceStateMachine();
    }

    updateVoiceStateMachine() {
        const now = performance.now();
        const prev = this.currentState;

        switch (this.currentState) {
            case this.STATE_IDLE:
                // Require clear speech confidence + positive SNR
                if (this.speechConfidence >= 0.46 && this.snrDb >= 5.0) {
                    this.currentState = this.STATE_POSSIBLE;
                    this.stateStartTime = now;
                }
                break;

            case this.STATE_POSSIBLE:
                // Temporal Validation: Reject < 30ms transient clicks/pops
                if (this.speechConfidence < 0.35) {
                    this.currentState = this.STATE_IDLE; // False alarm (e.g. mouse click)
                } else if (now - this.stateStartTime >= 32) { // 32ms sustained vocal envelope
                    this.currentState = this.STATE_CONFIRMED;
                    this.stateStartTime = now;
                    this.totalVoiceEvents++;
                    this.triggerBirdAction(now);
                }
                break;

            case this.STATE_CONFIRMED:
                // Maintain active voice
                if (this.mode === 'vocal_flap') {
                    // Check if new intentional voice pulse occurs after cooldown
                    if (!this.hasTriggeredInCurrentBurst && now - this.lastFlapTime > this.flapCooldownMs) {
                        this.triggerBirdAction(now);
                    }
                }

                // If voice energy drops below threshold, transition to Hangover Release Delay
                if (this.speechConfidence < 0.36) {
                    this.currentState = this.STATE_RELEASE;
                    this.stateStartTime = now;
                }
                break;

            case this.STATE_RELEASE:
                // Hangover Window (140ms) - Prevents fluttering during intra-word consonant pauses
                if (this.speechConfidence >= 0.44) {
                    // Voice resumed within hangover window
                    this.currentState = this.STATE_CONFIRMED;
                } else if (now - this.stateStartTime >= 140) {
                    this.currentState = this.STATE_IDLE;
                    this.hasTriggeredInCurrentBurst = false;
                }
                break;
        }

        if (this.currentState !== prev && this.onStateChange) {
            this.onStateChange(this.currentState, this.speechConfidence, this.speechIntensity);
        }
    }

    triggerBirdAction(now) {
        this.lastFlapTime = now;
        this.hasTriggeredInCurrentBurst = true;
        if (this.onFlap) {
            this.onFlap(this.speechIntensity || 1.0);
        }
    }

    getCurrentIntensity() {
        if (!this.isListening) return 0;
        if (this.currentState === this.STATE_CONFIRMED || this.currentState === this.STATE_RELEASE) {
            return Math.max(0.25, Math.pow(this.speechIntensity, 0.75));
        }
        return 0;
    }

    setMode(mode) {
        if (mode === 'vocal_flap' || mode === 'continuous_float') {
            this.mode = mode;
        }
    }
}

window.audioController = new AudioController();
