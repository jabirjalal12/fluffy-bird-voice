/**
 * AudioController - High-Precision Live Microphone & Voice Intensity Engine
 * Built-in Fan & Ambient Noise Filter with Real-Time Level Tracking
 * v2.1 - Fixed: loop restart on re-init, burst-lock, smoothing, sensitivity scaling
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
        this._loopId = null; // Track the RAF loop so we can properly restart it

        // Fan & Ambient Noise Suppression Settings
        this.fanFilterActive = true;
        this.highpassCutoff = 160; // 160Hz highpass cuts rumble & fan buffeting

        // Flight Mode & Sensitivity Settings
        this.mode = 'vocal_flap'; // 'vocal_flap' or 'continuous_float'
        this.sensitivity = 1.0;
        this.threshold = 0.14;     // 14% vocal trigger threshold
        this.ambientNoise = 0.02;  // Adaptive background noise floor

        // Runtime Volume Levels (0.0 to 1.0)
        this.currentVolume = 0;
        this.smoothedVolume = 0;
        this.rawRms = 0;
        this.rawPeak = 0;

        // Flap Trigger Timing
        // One flap fires on the RISING EDGE: volume goes from below → above threshold.
        // It will not fire again until volume first drops below threshold*0.6 (reset)
        // and then rises above threshold again (new edge).
        this.lastFlapTime = 0;
        this.flapCooldownMs = 150;   // min ms between flaps
        this.isAboveThreshold = false; // tracks whether we are currently above threshold
        this.belowResetRatio = 0.60;   // must drop to 60% of threshold before a new flap can arm

        // Callbacks
        this.onFlap = null;
        this.onLevelUpdate = null;
        this.onError = null;
    }

    async initMicrophone() {
        try {
            const AudioCtx = window.AudioContext || window.webkitAudioContext;
            if (!AudioCtx) {
                throw new Error('Web Audio API is not supported in this browser.');
            }

            // Create or resume AudioContext
            if (!this.audioCtx) {
                this.audioCtx = new AudioCtx({ latencyHint: 'interactive', sampleRate: 44100 });
            }
            if (this.audioCtx.state === 'suspended') {
                await this.audioCtx.resume();
            }

            // If already listening with an active stream — do nothing
            if (this.isListening && this.stream && this.stream.active) {
                return true;
            }

            // Tear down old nodes before re-connecting
            this._teardownNodes();

            // Request mic with best settings for voice detection
            let stream = null;
            try {
                stream = await navigator.mediaDevices.getUserMedia({
                    audio: {
                        echoCancellation: true,
                        noiseSuppression: false,   // We do our own high-pass filtering
                        autoGainControl: true,      // Keep AGC on to normalise mic levels across devices
                        channelCount: 1,
                        sampleRate: { ideal: 44100 }
                    }
                });
            } catch (err) {
                // Fallback: bare minimum constraints
                stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            }

            this.stream = stream;
            this.microphone = this.audioCtx.createMediaStreamSource(stream);

            // 1. High-Pass Filter — strips sub-bass rumble & fan buffeting
            this.highpassFilter = this.audioCtx.createBiquadFilter();
            this.highpassFilter.type = 'highpass';
            this.highpassFilter.frequency.value = this.fanFilterActive ? this.highpassCutoff : 40;
            this.highpassFilter.Q.value = 0.707;

            // 2. Audio Spectrum Analyser
            this.analyser = this.audioCtx.createAnalyser();
            this.analyser.fftSize = 1024;              // Larger FFT = better freq resolution
            this.analyser.smoothingTimeConstant = 0.30; // Mild smoothing — responsive but not jumpy

            // Pipeline: Mic → HighPass → Analyser
            this.microphone.connect(this.highpassFilter);
            this.highpassFilter.connect(this.analyser);

            // Allocate data arrays
            this.timeArray = new Uint8Array(this.analyser.fftSize);
            this.freqArray = new Uint8Array(this.analyser.frequencyBinCount);
            this.floatArray = new Float32Array(this.analyser.fftSize);

            this.isListening = true;
            this.smoothedVolume = 0;
            this.currentVolume = 0;
            this.isAboveThreshold = false;

            // Always (re)start the analysis loop fresh
            this._startAnalysisLoop();

            console.log('[AudioController] Mic initialized. Stream active:', stream.active);
            return true;

        } catch (err) {
            console.warn('[AudioController] Mic access error:', err.name, err.message);
            this.isListening = false;
            if (this.onError) this.onError(err);
            return false;
        }
    }

    _teardownNodes() {
        try {
            if (this.microphone) { this.microphone.disconnect(); this.microphone = null; }
            if (this.highpassFilter) { this.highpassFilter.disconnect(); this.highpassFilter = null; }
            if (this.analyser) { this.analyser.disconnect(); this.analyser = null; }
        } catch (e) { /* ignore disconnect errors */ }
        if (this.stream) {
            this.stream.getTracks().forEach(t => t.stop());
            this.stream = null;
        }
        this.isListening = false;
        // Signal old loop to stop
        this._loopId = null;
    }

    setFanFilter(enabled) {
        this.fanFilterActive = !!enabled;
        if (this.highpassFilter && this.audioCtx) {
            const targetFreq = this.fanFilterActive ? this.highpassCutoff : 40;
            this.highpassFilter.frequency.setTargetAtTime(targetFreq, this.audioCtx.currentTime, 0.05);
        }
    }

    _startAnalysisLoop() {
        // Stamp a unique session token — old loops check this and quit
        const sessionId = Date.now();
        this._loopId = sessionId;

        const update = () => {
            // If session changed (re-init happened), this old loop dies
            if (this._loopId !== sessionId) return;

            if (this.isListening && this.analyser) {
                // Auto-resume suspended context (can happen on mobile after tab switch)
                if (this.audioCtx && this.audioCtx.state === 'suspended') {
                    this.audioCtx.resume();
                }

                this.analyzeAudio();

                if (this.onLevelUpdate) {
                    const isTriggered = this.mode === 'vocal_flap'
                        ? this.isAboveThreshold
                        : this.smoothedVolume > 0.04;
                    this.onLevelUpdate(
                        this.smoothedVolume,
                        this.threshold,
                        isTriggered,
                        this.currentVolume,
                        this.rawRms
                    );
                }
            }

            requestAnimationFrame(update);
        };

        requestAnimationFrame(update);
    }

    analyzeAudio() {
        if (!this.analyser || !this.floatArray) return;

        // ── 1. Time-Domain RMS & Peak from Float data ──
        this.analyser.getFloatTimeDomainData(this.floatArray);
        this.analyser.getByteFrequencyData(this.freqArray);

        let maxDev = 0;
        let sumSquares = 0;
        const len = this.floatArray.length;

        for (let i = 0; i < len; i++) {
            const v = this.floatArray[i];
            const abs = v < 0 ? -v : v;
            if (abs > maxDev) maxDev = abs;
            sumSquares += v * v;
        }

        const timeRms = Math.sqrt(sumSquares / len);
        this.rawRms = timeRms;
        this.rawPeak = maxDev;

        // ── 2. Frequency-Domain Vocal Band Energy (300 Hz – 4 kHz) ──
        // With fftSize=1024 and sampleRate=44100, each bin is ~43Hz wide.
        // bin 7  ≈ 301 Hz  (voice fundamental start)
        // bin 93 ≈ 4000 Hz (voice harmonics end)
        const sampleRate = this.audioCtx ? this.audioCtx.sampleRate : 44100;
        const binHz = sampleRate / this.analyser.fftSize;
        const startBin = Math.max(this.fanFilterActive ? 4 : 2, Math.round(300 / binHz));
        const endBin   = Math.min(Math.round(4000 / binHz), this.freqArray.length - 1);

        let freqSum = 0;
        for (let i = startBin; i <= endBin; i++) {
            freqSum += this.freqArray[i];
        }
        const freqAvg = freqSum / ((endBin - startBin + 1) * 255);

        // ── 3. Composite Voice Score ──
        // timeRms:  0.00 – 0.70 typical for speech
        // maxDev:   0.00 – 1.00
        // freqAvg:  0.00 – 1.00
        // Weights tuned so a clear voice at ~60cm from mic → composite ≈ 0.25–0.60
        const compositeSignal = (
            (timeRms * 2.8) +
            (maxDev  * 1.2) +
            (freqAvg * 1.5)
        ) * this.sensitivity;

        const rawVol = Math.min(1.0, Math.max(0, compositeSignal));
        this.currentVolume = rawVol;

        // ── 4. Smooth volume (different rate for each mode) ──
        const alpha = this.mode === 'continuous_float' ? 0.55 : 0.65; // higher = faster response
        this.smoothedVolume = this.smoothedVolume * (1 - alpha) + rawVol * alpha;

        // ── 5. Adaptive ambient noise floor tracker ──
        if (rawVol < this.threshold * 0.80) {
            this.ambientNoise = this.ambientNoise * 0.985 + rawVol * 0.015;
        }

        // ── 6. Rising-Edge Flap Trigger (Vocal Flap Mode) ──
        if (this.mode === 'vocal_flap') {
            const effectiveVol = Math.max(this.smoothedVolume, rawVol);
            const now = performance.now();

            if (this.isAboveThreshold) {
                // We're in a burst — wait until volume drops below reset level
                if (effectiveVol < this.threshold * this.belowResetRatio) {
                    this.isAboveThreshold = false; // armed for next burst
                }
            } else {
                // Watch for rising edge above threshold
                if (effectiveVol >= this.threshold) {
                    const timeSinceLastFlap = now - this.lastFlapTime;
                    if (timeSinceLastFlap >= this.flapCooldownMs) {
                        this.isAboveThreshold = true;
                        this.lastFlapTime = now;
                        if (this.onFlap) {
                            this.onFlap(effectiveVol);
                        }
                    }
                }
            }
        }
    }

    getCurrentIntensity() {
        if (!this.isListening) return 0;
        if (this.smoothedVolume < 0.025) return 0;

        const norm = Math.min(1.0, this.smoothedVolume / Math.max(0.08, this.threshold));
        return Math.pow(norm, 0.65); // slight gamma so soft sounds still register
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
                let sumSq = 0;
                for (let i = 0; i < this.floatArray.length; i++) {
                    sumSq += this.floatArray[i] * this.floatArray[i];
                }
                const rms = Math.sqrt(sumSq / this.floatArray.length);
                samples.push(rms * 2.8); // match composite weight for RMS

                const elapsed = performance.now() - startTime;
                if (progressCallback) progressCallback(Math.min(1.0, elapsed / durationMs));

                if (elapsed >= durationMs) {
                    clearInterval(sampleInterval);
                    this.isCalibrating = false;

                    const avg = samples.reduce((a, b) => a + b, 0) / (samples.length || 1);
                    const peakNoise = Math.max(...samples, 0.005);

                    // Threshold = noise peak × 2.2 + fixed margin, clamped to [8%, 40%]
                    this.ambientNoise = Math.min(0.10, Math.max(0.005, avg));
                    this.threshold    = Math.min(0.40, Math.max(0.08, peakNoise * 2.2 + 0.04));

                    resolve({
                        avgAmbient: avg,
                        maxAmbient: peakNoise,
                        ambientNoise: this.ambientNoise,
                        threshold: this.threshold
                    });
                }
            }, 40);
        });
    }

    setSensitivityPreset(preset) {
        switch (preset) {
            case 'quiet':
                // Quiet room, close mic — very sensitive
                this.sensitivity = 1.30;
                this.threshold = 0.09;
                this.highpassCutoff = 140;
                this.setFanFilter(true);
                break;
            case 'fan_mode':
                // Fan / AC noise — raise threshold, tighter filter
                this.sensitivity = 0.95;
                this.threshold = 0.18;
                this.highpassCutoff = 260;
                this.setFanFilter(true);
                break;
            case 'noisy':
                // Loud environment — high threshold
                this.sensitivity = 0.80;
                this.threshold = 0.24;
                this.highpassCutoff = 220;
                this.setFanFilter(true);
                break;
            default: // 'normal'
                this.sensitivity = 1.0;
                this.threshold = 0.14;
                this.highpassCutoff = 160;
                this.setFanFilter(true);
                break;
        }
        // Re-arm the edge detector whenever preset changes
        this.isAboveThreshold = false;
    }

    setMode(mode) {
        if (mode === 'vocal_flap' || mode === 'continuous_float') {
            this.mode = mode;
            this.isAboveThreshold = false;
            this.smoothedVolume = 0;
        }
    }
}

window.audioController = new AudioController();
