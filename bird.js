/**
 * Bird Class - Fluffy Animated Bird with procedural rendering, physics, and skins
 */
class FluffyBird {
    constructor(x, y) {
        this.startX = x;
        this.startY = y;
        this.reset();

        // Customization Skins
        this.skins = {
            sunny: {
                name: 'Sunny Chick',
                body: '#FFD700',
                bodyGradient: '#FFA500',
                belly: '#FFF8DC',
                wing: '#FFBF00',
                wingEdge: '#FF8C00',
                beak: '#FF6347',
                blush: 'rgba(255, 105, 180, 0.45)',
                featherColor: '#FFE066'
            },
            cotton: {
                name: 'Cotton Candy',
                body: '#FFB6C1',
                bodyGradient: '#FF69B4',
                belly: '#FFF0F5',
                wing: '#DA70D6',
                wingEdge: '#BA55D3',
                beak: '#FF7F50',
                blush: 'rgba(255, 20, 147, 0.45)',
                featherColor: '#FFD1DC'
            },
            sky: {
                name: 'Cloud Jay',
                body: '#70D6FF',
                bodyGradient: '#00A6FB',
                belly: '#E0F7FA',
                wing: '#48CAE4',
                wingEdge: '#0096C7',
                beak: '#FFAA00',
                blush: 'rgba(255, 140, 180, 0.4)',
                featherColor: '#A0E8FF'
            },
            phoenix: {
                name: 'Golden Ember',
                body: '#FF8C42',
                bodyGradient: '#D8315B',
                belly: '#FFF3B0',
                wing: '#E85D04',
                wingEdge: '#9D0208',
                beak: '#FFBA08',
                blush: 'rgba(255, 80, 80, 0.5)',
                featherColor: '#FFAA5A'
            },
            matcha: {
                name: 'Matcha Puff',
                body: '#A8DADC',
                bodyGradient: '#457B9D',
                belly: '#F1FAEE',
                wing: '#588157',
                wingEdge: '#3A5A40',
                beak: '#E76F51',
                blush: 'rgba(230, 100, 100, 0.4)',
                featherColor: '#C8E6C9'
            }
        };

        this.currentSkin = 'sunny';
        this.feathers = [];
    }

    reset() {
        this.x = this.startX;
        this.y = this.startY;
        this.vy = 0;
        this.radius = 22;
        this.angle = 0;
        this.wingAngle = 0;
        this.flapPower = 5.0; // Lower gentle jump level
        this.scaleX = 1;
        this.scaleY = 1;

        this.blinkTimer = 120;
        this.isBlinking = false;
        this.blinkDuration = 8;
        this.blinkCounter = 0;

        this.feathers = [];
        this.isDead = false;
    }

    setFlapPower(power) {
        this.flapPower = Math.max(2.5, Math.min(8.0, parseFloat(power)));
    }

    setSkin(skinKey) {
        if (this.skins[skinKey]) {
            this.currentSkin = skinKey;
        }
    }

    flap(powerMultiplier = 1.0) {
        if (this.isDead) return;

        const impulse = this.flapPower * powerMultiplier;
        this.vy = -impulse;
        this.angle = -20 * (Math.PI / 180);

        // Squish and stretch animation
        this.scaleX = 0.86;
        this.scaleY = 1.18;

        // Wing flap snap
        this.wingAngle = -45 * (Math.PI / 180);

        // Spawn puff feathers
        this.spawnFeathers(2);

        if (window.sfx) {
            window.sfx.playFlap();
        }
    }

    applyContinuousLift(intensity, dt) {
        if (this.isDead || intensity <= 0.05) return;

        // Smoothly brake falling momentum when vocalizing
        if (this.vy > 0 && intensity > 0.25) {
            this.vy *= 0.88;
        }

        // Upward force proportional to voice loudness (28.0 vs 13.5 gravity provides smooth hover & climb)
        const liftForce = 28.0 * intensity;
        this.vy -= liftForce * dt;

        // Limit maximum upward climb speed to a comfortable smooth level
        if (this.vy < -5.5) {
            this.vy = -5.5;
        }

        // Slight upward tilt proportional to upward velocity
        const targetAngle = Math.max(-0.4, (this.vy * 0.05));
        this.angle += (targetAngle - this.angle) * 0.2;

        // Wing flutter speed proportional to lift
        this.wingAngle = Math.sin(performance.now() * 0.025 * (1 + intensity * 2.5)) * 0.65;

        // Spawn gentle feather trail
        if (Math.random() < intensity * 0.4) {
            this.spawnFeathers(1);
        }
    }

    update(dt, gravity = 13.5) {
        if (!this.isDead) {
            // Apply gravity
            this.vy += gravity * dt;
            this.y += this.vy;

            // Rotation physics
            if (this.vy > 0) {
                // Falling: tilt downwards smoothly
                const targetAngle = Math.min(Math.PI / 2.5, this.vy * 0.06);
                this.angle += (targetAngle - this.angle) * 0.1;
                this.wingAngle += (0.2 - this.wingAngle) * 0.1;
            }

            // Restore squish/stretch
            this.scaleX += (1 - this.scaleX) * 0.15;
            this.scaleY += (1 - this.scaleY) * 0.15;

            // Blinking timer
            this.blinkTimer--;
            if (this.blinkTimer <= 0) {
                this.isBlinking = true;
                this.blinkCounter++;
                if (this.blinkCounter >= this.blinkDuration) {
                    this.isBlinking = false;
                    this.blinkCounter = 0;
                    this.blinkTimer = 90 + Math.random() * 150;
                }
            }
        } else {
            // Dead falling spin
            this.vy += gravity * 1.2 * dt;
            this.y += this.vy;
            this.angle += 0.08;
        }

        // Update feather particles
        for (let i = this.feathers.length - 1; i >= 0; i--) {
            const f = this.feathers[i];
            f.x += f.vx;
            f.y += f.vy;
            f.alpha -= f.decay;
            f.size *= 0.96;
            f.rot += f.vrot;
            if (f.alpha <= 0 || f.size <= 0.5) {
                this.feathers.splice(i, 1);
            }
        }
    }

    spawnFeathers(count = 2) {
        const skin = this.skins[this.currentSkin];
        for (let i = 0; i < count; i++) {
            this.feathers.push({
                x: this.x - this.radius * 0.6 + (Math.random() - 0.5) * 8,
                y: this.y + (Math.random() - 0.5) * 12,
                vx: -1.2 - Math.random() * 1.5,
                vy: (Math.random() - 0.5) * 1.5 + 0.5,
                size: 5 + Math.random() * 6,
                alpha: 0.85,
                decay: 0.02 + Math.random() * 0.02,
                rot: Math.random() * Math.PI * 2,
                vrot: (Math.random() - 0.5) * 0.1,
                color: skin.featherColor
            });
        }
    }

    renderFeathers(ctx) {
        for (const f of this.feathers) {
            ctx.save();
            ctx.globalAlpha = f.alpha;
            ctx.translate(f.x, f.y);
            ctx.rotate(f.rot);
            ctx.fillStyle = f.color;
            ctx.beginPath();
            ctx.ellipse(0, 0, f.size * 1.2, f.size * 0.7, 0, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
        }
    }

    render(ctx) {
        this.renderFeathers(ctx);

        const skin = this.skins[this.currentSkin];
        ctx.save();
        ctx.translate(this.x, this.y);
        ctx.rotate(this.angle);
        ctx.scale(this.scaleX, this.scaleY);

        const r = this.radius;

        // 1. Fluffy tail tufts (behind body)
        ctx.fillStyle = skin.wingEdge;
        [-6, 0, 6].forEach((offset, idx) => {
            ctx.beginPath();
            ctx.ellipse(-r * 0.9, offset, r * 0.35, r * 0.2, (idx - 1) * 0.25, 0, Math.PI * 2);
            ctx.fill();
        });

        // 2. Main Fluffy Body with soft gradient
        const bodyGrad = ctx.createRadialGradient(-3, -3, r * 0.2, 0, 0, r);
        bodyGrad.addColorStop(0, skin.body);
        bodyGrad.addColorStop(1, skin.bodyGradient);

        ctx.fillStyle = bodyGrad;
        ctx.beginPath();
        // Base round body
        ctx.arc(0, 0, r, 0, Math.PI * 2);
        ctx.fill();

        // 3. Cute Fluffy edge puffs around perimeter for extra fluffiness
        ctx.fillStyle = skin.body;
        const puffCount = 8;
        for (let i = 0; i < puffCount; i++) {
            const th = (i / puffCount) * Math.PI * 2;
            const px = Math.cos(th) * (r * 0.85);
            const py = Math.sin(th) * (r * 0.85);
            ctx.beginPath();
            ctx.arc(px, py, r * 0.3, 0, Math.PI * 2);
            ctx.fill();
        }

        // 4. Soft Belly
        ctx.fillStyle = skin.belly;
        ctx.beginPath();
        ctx.ellipse(r * 0.2, r * 0.28, r * 0.55, r * 0.42, 0.15, 0, Math.PI * 2);
        ctx.fill();

        // 5. Blushing Cheeks
        ctx.fillStyle = skin.blush;
        ctx.beginPath();
        ctx.ellipse(r * 0.42, r * 0.18, r * 0.32, r * 0.22, 0, 0, Math.PI * 2);
        ctx.fill();

        // 6. Eye (Big anime/cute eye with glossy reflections)
        const eyeX = r * 0.45;
        const eyeY = -r * 0.22;
        const eyeR = r * 0.32;

        if (this.isDead) {
            // X_X dizzy eyes
            ctx.strokeStyle = '#333';
            ctx.lineWidth = 3;
            ctx.lineCap = 'round';
            // Left cross
            ctx.beginPath();
            ctx.moveTo(eyeX - 5, eyeY - 5);
            ctx.lineTo(eyeX + 5, eyeY + 5);
            ctx.moveTo(eyeX + 5, eyeY - 5);
            ctx.lineTo(eyeX - 5, eyeY + 5);
            ctx.stroke();
        } else if (this.isBlinking) {
            // Closed happy arc
            ctx.strokeStyle = '#222';
            ctx.lineWidth = 3;
            ctx.lineCap = 'round';
            ctx.beginPath();
            ctx.arc(eyeX, eyeY + 2, eyeR * 0.8, Math.PI * 1.1, Math.PI * 1.9);
            ctx.stroke();
        } else {
            // White sclera
            ctx.fillStyle = '#FFFFFF';
            ctx.beginPath();
            ctx.ellipse(eyeX, eyeY, eyeR, eyeR * 1.1, 0, 0, Math.PI * 2);
            ctx.fill();
            ctx.strokeStyle = 'rgba(0,0,0,0.1)';
            ctx.lineWidth = 1;
            ctx.stroke();

            // Pupil / Iris
            ctx.fillStyle = '#1D1E2C';
            ctx.beginPath();
            ctx.arc(eyeX + 2, eyeY, eyeR * 0.65, 0, Math.PI * 2);
            ctx.fill();

            // Sparkle Highlights
            ctx.fillStyle = '#FFFFFF';
            ctx.beginPath();
            ctx.arc(eyeX + 3.5, eyeY - 2.5, eyeR * 0.3, 0, Math.PI * 2);
            ctx.fill();

            ctx.beginPath();
            ctx.arc(eyeX, eyeY + 3.5, eyeR * 0.15, 0, Math.PI * 2);
            ctx.fill();
        }

        // 7. Cute Beak
        ctx.fillStyle = skin.beak;
        ctx.beginPath();
        ctx.moveTo(r * 0.82, -r * 0.12);
        ctx.quadraticCurveTo(r * 1.35, -r * 0.02, r * 1.42, 0.05);
        ctx.quadraticCurveTo(r * 1.1, r * 0.25, r * 0.78, r * 0.2);
        ctx.closePath();
        ctx.fill();

        // 8. Flapping Wing
        ctx.save();
        ctx.translate(-r * 0.15, 0);
        ctx.rotate(this.wingAngle);

        const wingGrad = ctx.createLinearGradient(0, 0, r * 0.8, r * 0.5);
        wingGrad.addColorStop(0, skin.wing);
        wingGrad.addColorStop(1, skin.wingEdge);

        ctx.fillStyle = wingGrad;
        ctx.beginPath();
        ctx.ellipse(0, 0, r * 0.65, r * 0.4, 0.3, 0, Math.PI * 2);
        ctx.fill();

        // Wing inner feather details
        ctx.fillStyle = 'rgba(255,255,255,0.3)';
        ctx.beginPath();
        ctx.ellipse(-2, -1, r * 0.4, r * 0.22, 0.3, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();

        // 9. Tiny Crown / Fluff Tuft on top of head
        ctx.fillStyle = skin.wingEdge;
        ctx.beginPath();
        ctx.ellipse(-r * 0.1, -r * 0.95, r * 0.22, r * 0.35, -0.2, 0, Math.PI * 2);
        ctx.fill();

        ctx.restore();
    }
}

window.FluffyBird = FluffyBird;
