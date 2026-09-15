/**
 * GameEngine - Main Game Loop, Physics, Obstacles, Parallax Sky, Particles and Constant Acceleration System
 */
class GameEngine {
    constructor(canvasId) {
        this.canvas = document.getElementById(canvasId);
        this.ctx = this.canvas.getContext('2d');

        // Virtual game resolution
        this.width = 480;
        this.height = 720;
        this.canvas.width = this.width;
        this.canvas.height = this.height;

        this.bird = new FluffyBird(110, this.height / 2);
        this.state = 'MENU'; // 'MENU', 'PLAYING', 'GAMEOVER', 'PAUSED'

        this.score = 0;
        this.starsCollected = 0;
        this.highScore = parseInt(localStorage.getItem('fluffy_bird_highscore') || '0', 10);
        this.totalStars = parseInt(localStorage.getItem('fluffy_bird_total_stars') || '0', 10);

        // Constant Acceleration & Speed Physics
        this.baseSpeed = 2.4;
        this.gameSpeed = 2.4;
        this.maxSpeed = 5.2;
        this.accelerationRate = 0.040; // Speed increase per second
        this.playTime = 0;
        this.maxSpeedReached = 2.4;
        this.speedTier = 1;
        this.targetPipeDistance = 315; // Constant spacing in pixels regardless of speed

        // Obstacles & Spawning
        this.obstacles = [];
        this.stars = [];
        this.particles = [];
        this.floatingTexts = [];
        this.windStreaks = [];
        this.pipeTimer = 0;
        this.basePipeGap = 230; // Clean, wide, forgiving vertical gap

        // Visual Parallax Layers
        this.clouds = [];
        this.bgOffsetFar = 0;
        this.bgOffsetMid = 0;
        this.bgOffsetNear = 0;

        // Screen shake & manual fallback
        this.shakeTime = 0;
        this.shakeIntensity = 0;
        this.isManualFloating = false;

        // Ground Height
        this.groundHeight = 64;

        this.lastTime = performance.now();
        window.engine = this;
        this.initClouds();
        this.setupAudioListeners();
        this.updateStatsUI();
    }

    initClouds() {
        this.clouds = [];
        for (let i = 0; i < 6; i++) {
            this.clouds.push({
                x: Math.random() * this.width,
                y: 40 + Math.random() * 260,
                radius: 25 + Math.random() * 35,
                speed: 0.3 + Math.random() * 0.4,
                opacity: 0.5 + Math.random() * 0.3
            });
        }
    }

    setupAudioListeners() {
        if (window.audioController) {
            window.audioController.onFlap = (vol) => {
                if (this.state === 'PLAYING') {
                    this.bird.flap(1.0);
                    if (window.sfx) window.sfx.playFlap();
                } else if (this.state === 'MENU' || this.state === 'GAMEOVER') {
                    this.startGame();
                }
            };
        }
    }

    startGame() {
        if (window.sfx) window.sfx.init();
        if (window.audioController) {
            if (window.audioController.audioCtx && window.audioController.audioCtx.state === 'suspended') {
                window.audioController.audioCtx.resume();
            }
            if (!window.audioController.isListening) {
                window.audioController.initMicrophone();
            }
            this.setupAudioListeners();
        }

        this.bird.reset();
        this.obstacles = [];
        this.stars = [];
        this.particles = [];
        this.floatingTexts = [];
        this.windStreaks = [];
        this.score = 0;
        this.starsCollected = 0;
        this.playTime = 0;
        this.speedTier = 1;
        this.gameSpeed = this.baseSpeed;
        this.maxSpeedReached = this.baseSpeed;
        this.pipeTimer = 180; // Distance before first pipe arrives
        this.state = 'PLAYING';

        this.bird.flap(1.0);
        this.triggerStateUI();
    }

    triggerStateUI() {
        const menuScreen = document.getElementById('menu-screen');
        const gameoverScreen = document.getElementById('gameover-screen');
        const hud = document.getElementById('hud');

        if (menuScreen) menuScreen.classList.toggle('active', this.state === 'MENU');
        if (gameoverScreen) gameoverScreen.classList.toggle('active', this.state === 'GAMEOVER');
        if (hud) hud.classList.toggle('active', this.state === 'PLAYING');
    }

    updateStatsUI() {
        const sideBest = document.getElementById('side-best-score');
        const sideStars = document.getElementById('side-total-stars');
        if (sideBest) sideBest.innerText = this.highScore.toString();
        if (sideStars) sideStars.innerText = this.totalStars.toString();
    }

    handleInputFlap() {
        if (this.state === 'PLAYING') {
            this.bird.flap(1.0);
        }
    }

    spawnObstacle() {
        const gap = Math.max(190, this.basePipeGap - Math.min(25, this.score * 0.3));
        const minTop = 50;
        const maxTop = this.height - this.groundHeight - gap - 50;
        const topHeight = minTop + Math.random() * (maxTop - minTop);
        const bottomY = topHeight + gap;
        const bottomHeight = this.height - this.groundHeight - bottomY;

        const pipe = {
            x: this.width + 30,
            width: 64, // Sleek cloud pillar width
            topHeight: topHeight,
            bottomY: bottomY,
            bottomHeight: bottomHeight,
            passed: false,
            colorScheme: (this.score % 10 >= 5) ? 'cotton' : 'cloud'
        };

        this.obstacles.push(pipe);

        // 45% chance to spawn a bonus glowing star in the center of the gap
        if (Math.random() < 0.5) {
            this.stars.push({
                x: pipe.x + pipe.width / 2,
                y: topHeight + gap / 2 + (Math.random() - 0.5) * 20,
                radius: 12,
                rot: 0,
                collected: false
            });
        }
    }

    triggerGameOver() {
        if (this.state === 'GAMEOVER') return;
        this.state = 'GAMEOVER';
        this.bird.isDead = true;
        this.shakeScreen(12, 18);

        if (window.sfx) window.sfx.playHit();

        const isNewBest = this.score > this.highScore;
        if (isNewBest) {
            this.highScore = this.score;
            localStorage.setItem('fluffy_bird_highscore', this.highScore.toString());
            this.spawnConfetti();
            if (window.sfx) {
                setTimeout(() => window.sfx.playHighscore(), 250);
            }
        }

        // Save total stars collected
        this.totalStars += this.starsCollected;
        localStorage.setItem('fluffy_bird_total_stars', this.totalStars.toString());
        this.updateStatsUI();

        // Update UI summary
        const scoreEl = document.getElementById('final-score');
        const bestEl = document.getElementById('final-best');
        const speedEl = document.getElementById('final-speed');
        const timeEl = document.getElementById('final-time');
        const newBestBadge = document.getElementById('new-best-badge');
        const medalBadge = document.getElementById('medal-icon');

        if (scoreEl) scoreEl.innerText = this.score.toString();
        if (bestEl) bestEl.innerText = this.highScore.toString();
        if (speedEl) speedEl.innerText = `${(this.maxSpeedReached / this.baseSpeed).toFixed(1)}x`;
        if (timeEl) timeEl.innerText = `${Math.round(this.playTime)}s`;
        if (newBestBadge) newBestBadge.style.display = isNewBest ? 'inline-block' : 'none';

        // Medals
        if (medalBadge) {
            if (this.score >= 40) medalBadge.innerText = '💎 Platinum';
            else if (this.score >= 25) medalBadge.innerText = '🥇 Gold Fluff';
            else if (this.score >= 12) medalBadge.innerText = '🥈 Silver Fluff';
            else if (this.score >= 5) medalBadge.innerText = '🥉 Bronze Fluff';
            else medalBadge.innerText = '🥚 Baby Chick';
        }

        this.triggerStateUI();
    }

    shakeScreen(intensity, durationFrames) {
        this.shakeIntensity = intensity;
        this.shakeTime = durationFrames;
    }

    spawnConfetti() {
        const colors = ['#FF6B6B', '#4ECDC4', '#FFE66D', '#FF8C42', '#A06CD5', '#70D6FF'];
        for (let i = 0; i < 60; i++) {
            this.particles.push({
                x: this.width / 2 + (Math.random() - 0.5) * 100,
                y: this.height / 3 + (Math.random() - 0.5) * 50,
                vx: (Math.random() - 0.5) * 9,
                vy: -Math.random() * 8 - 3,
                gravity: 0.25,
                color: colors[Math.floor(Math.random() * colors.length)],
                size: 6 + Math.random() * 6,
                rot: Math.random() * Math.PI * 2,
                vrot: (Math.random() - 0.5) * 0.2,
                life: 1.0,
                decay: 0.012 + Math.random() * 0.01
            });
        }
    }

    addStarSparkles(x, y) {
        for (let i = 0; i < 16; i++) {
            const angle = (i / 16) * Math.PI * 2 + Math.random() * 0.2;
            const spd = 2.5 + Math.random() * 3.5;
            this.particles.push({
                x: x,
                y: y,
                vx: Math.cos(angle) * spd,
                vy: Math.sin(angle) * spd,
                gravity: 0.05,
                color: '#FFD700',
                size: 4 + Math.random() * 3,
                rot: 0,
                vrot: 0,
                life: 1.0,
                decay: 0.035
            });
        }

        this.floatingTexts.push({
            x: x,
            y: y - 10,
            text: '+3 STAR!',
            color: '#FFA500',
            alpha: 1.0,
            vy: -1.2
        });
    }

    update(dt) {
        // Continuous voice mode handling
        if (this.state === 'PLAYING' && window.audioController && window.audioController.mode === 'continuous_float') {
            let intensity = window.audioController.getCurrentIntensity();
            if (this.isManualFloating) {
                intensity = Math.max(intensity, 0.75);
            }
            if (intensity > 0) {
                this.bird.applyContinuousLift(intensity, dt);
            }
        }

        if (this.state === 'MENU') {
            // Cute hover sine wave on start screen
            this.bird.y = (this.height / 2) + Math.sin(performance.now() * 0.004) * 14;
            this.bird.angle = Math.sin(performance.now() * 0.003) * 0.1;
            this.bird.update(dt, 0); // No gravity
        } else if (this.state === 'PLAYING') {
            this.bird.update(dt, 13.5);

            // Constant Acceleration over Time & Score
            this.playTime += dt;
            this.gameSpeed = Math.min(this.maxSpeed, this.baseSpeed + (this.playTime * this.accelerationRate) + (this.score * 0.02));
            if (this.gameSpeed > this.maxSpeedReached) {
                this.maxSpeedReached = this.gameSpeed;
            }

            // Speed tier milestone notifications
            if (this.gameSpeed >= 3.3 && this.speedTier === 1) {
                this.speedTier = 2;
                this.floatingTexts.push({ x: this.width / 2, y: this.height * 0.35, text: '⚡ SPEEDING UP!', color: '#4361ee', alpha: 1.0, vy: -1.0 });
            } else if (this.gameSpeed >= 4.2 && this.speedTier === 2) {
                this.speedTier = 3;
                this.floatingTexts.push({ x: this.width / 2, y: this.height * 0.35, text: '🚀 TURBO FLIGHT!', color: '#ff5c8a', alpha: 1.0, vy: -1.0 });
            } else if (this.gameSpeed >= 5.0 && this.speedTier === 3) {
                this.speedTier = 4;
                this.floatingTexts.push({ x: this.width / 2, y: this.height * 0.35, text: '⚡ MAX SPEED!', color: '#ffbe0b', alpha: 1.0, vy: -1.0 });
            }

            // Distance-based Obstacle Spawning (Consistent gap regardless of speed)
            this.pipeTimer += this.gameSpeed;
            if (this.pipeTimer >= this.targetPipeDistance) {
                this.pipeTimer = 0;
                this.spawnObstacle();
            }

            // High-speed wind streaks
            if (this.gameSpeed > 3.2 && Math.random() < (this.gameSpeed - 3.0) * 0.22) {
                this.windStreaks.push({
                    x: this.width + 20,
                    y: 30 + Math.random() * (this.height - this.groundHeight - 60),
                    len: 25 + Math.random() * 45,
                    speed: this.gameSpeed * 2.2,
                    alpha: 0.35 + Math.random() * 0.35
                });
            }

            // Update obstacles
            for (let i = this.obstacles.length - 1; i >= 0; i--) {
                const pipe = this.obstacles[i];
                pipe.x -= this.gameSpeed;

                // Score detection
                if (!pipe.passed && pipe.x + pipe.width < this.bird.x) {
                    pipe.passed = true;
                    this.score++;
                    if (window.sfx) window.sfx.playScore();

                    // Score pop text
                    this.floatingTexts.push({
                        x: this.bird.x + 10,
                        y: this.bird.y - 20,
                        text: '+1',
                        color: '#4CAF50',
                        alpha: 1.0,
                        vy: -1.4
                    });
                }

                // Check collision
                if (this.checkPipeCollision(this.bird, pipe)) {
                    this.triggerGameOver();
                }

                // Remove off-screen pipes
                if (pipe.x + pipe.width < -40) {
                    this.obstacles.splice(i, 1);
                }
            }

            // Update collectible stars
            for (let i = this.stars.length - 1; i >= 0; i--) {
                const star = this.stars[i];
                star.x -= this.gameSpeed;
                star.rot += 0.04;

                // Star pickup collision
                const dx = this.bird.x - star.x;
                const dy = this.bird.y - star.y;
                const dist = Math.sqrt(dx * dx + dy * dy);

                if (!star.collected && dist < this.bird.radius + star.radius + 4) {
                    star.collected = true;
                    this.starsCollected++;
                    this.score += 3;
                    this.addStarSparkles(star.x, star.y);
                    if (window.sfx) window.sfx.playStar();
                    this.stars.splice(i, 1);
                    continue;
                }

                if (star.x < -30) {
                    this.stars.splice(i, 1);
                }
            }

            // Floor & Ceiling Collision
            if (this.bird.y + this.bird.radius >= this.height - this.groundHeight) {
                this.bird.y = this.height - this.groundHeight - this.bird.radius;
                this.triggerGameOver();
            }
            if (this.bird.y - this.bird.radius <= 0) {
                this.bird.y = this.bird.radius;
                this.bird.vy = 0;
            }
        } else if (this.state === 'GAMEOVER') {
            this.bird.update(dt, 18.0);
            if (this.bird.y + this.bird.radius >= this.height - this.groundHeight) {
                this.bird.y = this.height - this.groundHeight - this.bird.radius;
                this.bird.vy = 0;
            }
        }

        // Parallax background updates proportional to gameSpeed
        this.bgOffsetFar = (this.bgOffsetFar + this.gameSpeed * 0.12) % this.width;
        this.bgOffsetMid = (this.bgOffsetMid + this.gameSpeed * 0.35) % this.width;
        this.bgOffsetNear = (this.bgOffsetNear + this.gameSpeed) % this.width;

        // Clouds update
        for (const cloud of this.clouds) {
            cloud.x -= cloud.speed * (this.gameSpeed / this.baseSpeed);
            if (cloud.x < -cloud.radius * 3) {
                cloud.x = this.width + cloud.radius * 2;
                cloud.y = 30 + Math.random() * 260;
            }
        }

        // Wind streaks update
        for (let i = this.windStreaks.length - 1; i >= 0; i--) {
            const ws = this.windStreaks[i];
            ws.x -= ws.speed;
            if (ws.x + ws.len < -20) {
                this.windStreaks.splice(i, 1);
            }
        }

        // Particles update
        for (let i = this.particles.length - 1; i >= 0; i--) {
            const p = this.particles[i];
            p.x += p.vx;
            p.y += p.vy;
            p.vy += p.gravity || 0;
            p.life -= p.decay;
            p.rot += p.vrot || 0;
            if (p.life <= 0) {
                this.particles.splice(i, 1);
            }
        }

        // Floating texts update
        for (let i = this.floatingTexts.length - 1; i >= 0; i--) {
            const ft = this.floatingTexts[i];
            ft.y += ft.vy;
            ft.alpha -= 0.025;
            if (ft.alpha <= 0) {
                this.floatingTexts.splice(i, 1);
            }
        }

        // Screen shake decay
        if (this.shakeTime > 0) {
            this.shakeTime--;
        }

        // Update In-Game HUD Elements
        const scoreHud = document.getElementById('current-score-text');
        const speedHud = document.getElementById('speed-text');
        const speedBadge = document.getElementById('speed-badge');

        if (scoreHud) {
            scoreHud.innerText = this.score.toString();
        }
        if (speedHud) {
            const mult = (this.gameSpeed / this.baseSpeed).toFixed(1);
            speedHud.innerText = `${mult}x`;
            if (speedBadge) {
                speedBadge.classList.toggle('fast', this.gameSpeed >= 3.6);
            }
        }
    }

    checkPipeCollision(bird, pipe) {
        const bx = bird.x;
        const by = bird.y;
        const br = bird.radius * 0.70; // Forgiving inner body hitbox

        // Top Pipe rect
        const inTopX = bx + br > pipe.x && bx - br < pipe.x + pipe.width;
        const inTopY = by - br < pipe.topHeight;
        if (inTopX && inTopY) return true;

        // Bottom Pipe rect
        const inBottomX = bx + br > pipe.x && bx - br < pipe.x + pipe.width;
        const inBottomY = by + br > pipe.bottomY;
        if (inBottomX && inBottomY) return true;

        return false;
    }

    render() {
        this.ctx.save();

        // Screen Shake Transform
        if (this.shakeTime > 0) {
            const sx = (Math.random() - 0.5) * this.shakeIntensity;
            const sy = (Math.random() - 0.5) * this.shakeIntensity;
            this.ctx.translate(sx, sy);
        }

        // 1. Sky Gradient (Dreamy Pastel Sky)
        const skyGrad = this.ctx.createLinearGradient(0, 0, 0, this.height);
        skyGrad.addColorStop(0, '#A1C4FD');
        skyGrad.addColorStop(0.5, '#C2E9FB');
        skyGrad.addColorStop(0.85, '#FFE29F');
        skyGrad.addColorStop(1, '#FFAEBC');
        this.ctx.fillStyle = skyGrad;
        this.ctx.fillRect(0, 0, this.width, this.height);

        // 2. Soft Sun / Glow in the sky
        const sunGrad = this.ctx.createRadialGradient(this.width * 0.8, 120, 10, this.width * 0.8, 120, 140);
        sunGrad.addColorStop(0, 'rgba(255, 255, 255, 0.95)');
        sunGrad.addColorStop(0.3, 'rgba(255, 240, 180, 0.5)');
        sunGrad.addColorStop(1, 'rgba(255, 240, 180, 0)');
        this.ctx.fillStyle = sunGrad;
        this.ctx.beginPath();
        this.ctx.arc(this.width * 0.8, 120, 140, 0, Math.PI * 2);
        this.ctx.fill();

        // 3. Floating Clouds Layer
        this.renderClouds();

        // 4. Distant Pastel Rolling Hills
        this.renderHills();

        // 5. Wind Streaks (High-speed FX)
        this.renderWindStreaks();

        // 6. Pipes / Obstacles
        this.renderObstacles();

        // 7. Collectible Stars
        this.renderStars();

        // 8. Ground / Meadow with Flowers
        this.renderGround();

        // 9. Fluffy Bird
        this.bird.render(this.ctx);

        // 10. Particles (Feathers, Sparkles, Confetti)
        this.renderParticles();

        // 11. Floating Texts
        this.renderFloatingTexts();

        this.ctx.restore();
    }

    renderClouds() {
        for (const cloud of this.clouds) {
            this.ctx.save();
            this.ctx.fillStyle = `rgba(255, 255, 255, ${cloud.opacity})`;
            const r = cloud.radius;
            this.ctx.beginPath();
            this.ctx.arc(cloud.x, cloud.y, r, 0, Math.PI * 2);
            this.ctx.arc(cloud.x + r * 0.7, cloud.y - r * 0.25, r * 0.75, 0, Math.PI * 2);
            this.ctx.arc(cloud.x + r * 1.3, cloud.y, r * 0.8, 0, Math.PI * 2);
            this.ctx.arc(cloud.x - r * 0.6, cloud.y + r * 0.1, r * 0.65, 0, Math.PI * 2);
            this.ctx.fill();
            this.ctx.restore();
        }
    }

    renderHills() {
        const gh = this.height - this.groundHeight;

        // Far pastel mountains
        this.ctx.fillStyle = 'rgba(180, 205, 240, 0.45)';
        this.ctx.beginPath();
        this.ctx.moveTo(0, gh);
        for (let x = 0; x <= this.width + 50; x += 10) {
            const y = gh - 70 + Math.sin((x + this.bgOffsetFar) * 0.012) * 35;
            this.ctx.lineTo(x, y);
        }
        this.ctx.lineTo(this.width, this.height);
        this.ctx.lineTo(0, this.height);
        this.ctx.fill();

        // Mid rolling hills
        this.ctx.fillStyle = 'rgba(168, 220, 185, 0.6)';
        this.ctx.beginPath();
        this.ctx.moveTo(0, gh);
        for (let x = 0; x <= this.width + 50; x += 10) {
            const y = gh - 40 + Math.sin((x + this.bgOffsetMid * 1.4) * 0.02) * 22;
            this.ctx.lineTo(x, y);
        }
        this.ctx.lineTo(this.width, this.height);
        this.ctx.lineTo(0, this.height);
        this.ctx.fill();
    }

    renderWindStreaks() {
        if (this.windStreaks.length === 0) return;
        this.ctx.save();
        this.ctx.lineWidth = 2;
        this.ctx.lineCap = 'round';
        for (const ws of this.windStreaks) {
            this.ctx.strokeStyle = `rgba(255, 255, 255, ${ws.alpha})`;
            this.ctx.beginPath();
            this.ctx.moveTo(ws.x, ws.y);
            this.ctx.lineTo(ws.x + ws.len, ws.y);
            this.ctx.stroke();
        }
        this.ctx.restore();
    }

    renderObstacles() {
        for (const pipe of this.obstacles) {
            const isCotton = pipe.colorScheme === 'cotton';
            const bodyColor = isCotton ? '#F7CAD0' : '#A8DADC';
            const capColor = isCotton ? '#FF5C8A' : '#1D3557';

            this.ctx.save();

            // --- Top Pipe ---
            this.ctx.fillStyle = bodyColor;
            this.ctx.fillRect(pipe.x + 4, 0, pipe.width - 8, pipe.topHeight - 24);

            this.ctx.fillStyle = 'rgba(255, 255, 255, 0.45)';
            this.ctx.fillRect(pipe.x + 10, 0, 8, pipe.topHeight - 24);

            this.ctx.fillStyle = capColor;
            this.drawRoundedRect(this.ctx, pipe.x, pipe.topHeight - 28, pipe.width, 28, 10);
            this.ctx.fill();

            this.ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
            this.ctx.beginPath();
            this.ctx.arc(pipe.x + pipe.width * 0.3, pipe.topHeight - 14, 5, 0, Math.PI * 2);
            this.ctx.arc(pipe.x + pipe.width * 0.7, pipe.topHeight - 14, 4, 0, Math.PI * 2);
            this.ctx.fill();

            // --- Bottom Pipe ---
            this.ctx.fillStyle = capColor;
            this.drawRoundedRect(this.ctx, pipe.x, pipe.bottomY, pipe.width, 28, 10);
            this.ctx.fill();

            this.ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
            this.ctx.beginPath();
            this.ctx.arc(pipe.x + pipe.width * 0.3, pipe.bottomY + 14, 5, 0, Math.PI * 2);
            this.ctx.arc(pipe.x + pipe.width * 0.7, pipe.bottomY + 14, 4, 0, Math.PI * 2);
            this.ctx.fill();

            this.ctx.fillStyle = bodyColor;
            this.ctx.fillRect(pipe.x + 4, pipe.bottomY + 28, pipe.width - 8, pipe.bottomHeight - 28);

            this.ctx.fillStyle = 'rgba(255, 255, 255, 0.45)';
            this.ctx.fillRect(pipe.x + 10, pipe.bottomY + 28, 8, pipe.bottomHeight - 28);

            this.ctx.restore();
        }
    }

    renderStars() {
        for (const star of this.stars) {
            this.ctx.save();
            this.ctx.translate(star.x, star.y);
            this.ctx.rotate(star.rot);

            const glow = this.ctx.createRadialGradient(0, 0, 3, 0, 0, star.radius * 1.8);
            glow.addColorStop(0, 'rgba(255, 215, 0, 0.7)');
            glow.addColorStop(1, 'rgba(255, 215, 0, 0)');
            this.ctx.fillStyle = glow;
            this.ctx.beginPath();
            this.ctx.arc(0, 0, star.radius * 1.8, 0, Math.PI * 2);
            this.ctx.fill();

            this.ctx.fillStyle = '#FFD700';
            this.ctx.strokeStyle = '#FFA500';
            this.ctx.lineWidth = 1.5;
            this.drawStar(this.ctx, 0, 0, 5, star.radius, star.radius * 0.48);
            this.ctx.fill();
            this.ctx.stroke();

            this.ctx.restore();
        }
    }

    drawStar(ctx, cx, cy, spikes, outerRadius, innerRadius) {
        let rot = (Math.PI / 2) * 3;
        let x = cx;
        let y = cy;
        const step = Math.PI / spikes;

        ctx.beginPath();
        ctx.moveTo(cx, cy - outerRadius);
        for (let i = 0; i < spikes; i++) {
            x = cx + Math.cos(rot) * outerRadius;
            y = cy + Math.sin(rot) * outerRadius;
            ctx.lineTo(x, y);
            rot += step;

            x = cx + Math.cos(rot) * innerRadius;
            y = cy + Math.sin(rot) * innerRadius;
            ctx.lineTo(x, y);
            rot += step;
        }
        ctx.lineTo(cx, cy - outerRadius);
        ctx.closePath();
    }

    renderGround() {
        const gh = this.height - this.groundHeight;

        this.ctx.fillStyle = '#80ED99';
        this.ctx.fillRect(0, gh, this.width, 16);

        this.ctx.fillStyle = '#57CC99';
        for (let i = -20; i < this.width + 20; i += 18) {
            const gx = i - (this.bgOffsetNear % 18);
            this.ctx.beginPath();
            this.ctx.moveTo(gx, gh + 8);
            this.ctx.lineTo(gx + 6, gh);
            this.ctx.lineTo(gx + 12, gh + 8);
            this.ctx.fill();
        }

        const earthGrad = this.ctx.createLinearGradient(0, gh + 16, 0, this.height);
        earthGrad.addColorStop(0, '#E8B991');
        earthGrad.addColorStop(1, '#D08C5D');
        this.ctx.fillStyle = earthGrad;
        this.ctx.fillRect(0, gh + 16, this.width, this.groundHeight - 16);

        const flowerStep = 55;
        for (let i = -50; i < this.width + 50; i += flowerStep) {
            const fx = i - (this.bgOffsetNear % flowerStep);
            const fy = gh + 26;
            this.ctx.fillStyle = '#FF99C8';
            this.ctx.beginPath();
            this.ctx.arc(fx, fy, 4, 0, Math.PI * 2);
            this.ctx.fill();
            this.ctx.fillStyle = '#FCF6BD';
            this.ctx.beginPath();
            this.ctx.arc(fx, fy, 2, 0, Math.PI * 2);
            this.ctx.fill();
        }
    }

    renderParticles() {
        for (const p of this.particles) {
            this.ctx.save();
            this.ctx.globalAlpha = p.life;
            this.ctx.translate(p.x, p.y);
            this.ctx.rotate(p.rot);
            this.ctx.fillStyle = p.color;
            this.ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size);
            this.ctx.restore();
        }
    }

    renderFloatingTexts() {
        this.ctx.save();
        this.ctx.font = 'bold 18px "Fredoka", "Nunito", sans-serif';
        this.ctx.textAlign = 'center';
        for (const ft of this.floatingTexts) {
            this.ctx.globalAlpha = ft.alpha;
            this.ctx.strokeStyle = '#FFFFFF';
            this.ctx.lineWidth = 4;
            this.ctx.strokeText(ft.text, ft.x, ft.y);
            this.ctx.fillStyle = ft.color;
            this.ctx.fillText(ft.text, ft.x, ft.y);
        }
        this.ctx.restore();
    }

    drawRoundedRect(ctx, x, y, width, height, radius) {
        ctx.beginPath();
        ctx.moveTo(x + radius, y);
        ctx.lineTo(x + width - radius, y);
        ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
        ctx.lineTo(x + width, y + height - radius);
        ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
        ctx.lineTo(x + radius, y + height);
        ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
        ctx.lineTo(x, y + radius);
        ctx.quadraticCurveTo(x, y, x + radius, y);
        ctx.closePath();
    }

    loop() {
        const now = performance.now();
        const dt = Math.min(0.05, (now - this.lastTime) / 1000);
        this.lastTime = now;

        this.update(dt);
        this.render();

        requestAnimationFrame(() => this.loop());
    }

    start() {
        this.lastTime = performance.now();
        this.triggerStateUI();
        requestAnimationFrame(() => this.loop());
    }
}

window.GameEngine = GameEngine;
