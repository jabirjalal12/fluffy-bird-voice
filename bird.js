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
        this.flapPower = 5.6; // Responsive, crisp jump impulse
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
        this.flapPower = Math.max(3.0, Math.min(8.0, parseFloat(power)));
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

    render(ctx) {
        const skin = this.skins[this.currentSkin];

        // 1. Render flying feathers in world space
        for (const f of this.feathers) {
            ctx.save();
            ctx.globalAlpha = f.alpha;
            ctx.translate(f.x, f.y);
            ctx.rotate(f.rot);
            ctx.fillStyle = f.color;
            ctx.beginPath();
            ctx.ellipse(0, 0, f.size, f.size * 0.5, 0, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
        }

        // 2. Render Bird with scale, position, rotation
        ctx.save();
        ctx.translate(this.x, this.y);
        ctx.rotate(this.angle);
        ctx.scale(this.scaleX, this.scaleY);

        // Soft Outer Glow / Fluff Aura
        const auraGrad = ctx.createRadialGradient(0, 0, this.radius * 0.6, 0, 0, this.radius * 1.35);
        auraGrad.addColorStop(0, 'rgba(255, 255, 255, 0)');
        auraGrad.addColorStop(1, 'rgba(255, 255, 255, 0.25)');
        ctx.fillStyle = auraGrad;
        ctx.beginPath();
        ctx.arc(0, 0, this.radius * 1.35, 0, Math.PI * 2);
        ctx.fill();

        // Fluffy Body (Multi-radial gradient with 3D spherical lighting)
        const bodyGrad = ctx.createRadialGradient(
            -this.radius * 0.35,
            -this.radius * 0.35,
            this.radius * 0.15,
            0,
            0,
            this.radius
        );
        bodyGrad.addColorStop(0, skin.body);
        bodyGrad.addColorStop(0.7, skin.body);
        bodyGrad.addColorStop(1, skin.bodyGradient);

        ctx.fillStyle = bodyGrad;
        ctx.shadowColor = 'rgba(0, 0, 0, 0.15)';
        ctx.shadowBlur = 8;
        ctx.shadowOffsetY = 4;
        ctx.beginPath();
        ctx.arc(0, 0, this.radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowColor = 'transparent';

        // Fluffy Belly Highlight
        const bellyGrad = ctx.createRadialGradient(
            this.radius * 0.25,
            this.radius * 0.35,
            2,
            this.radius * 0.2,
            this.radius * 0.3,
            this.radius * 0.65
        );
        bellyGrad.addColorStop(0, skin.belly);
        bellyGrad.addColorStop(1, 'rgba(255, 255, 255, 0)');
        ctx.fillStyle = bellyGrad;
        ctx.beginPath();
        ctx.arc(this.radius * 0.2, this.radius * 0.25, this.radius * 0.55, 0, Math.PI * 2);
        ctx.fill();

        // Rosy Cheeks (Blush)
        ctx.fillStyle = skin.blush;
        ctx.beginPath();
        ctx.ellipse(this.radius * 0.45, this.radius * 0.25, 5, 3.5, 0, 0, Math.PI * 2);
        ctx.fill();

        // Beak (Vibrant orange with 3D highlight)
        ctx.fillStyle = skin.beak;
        ctx.beginPath();
        ctx.moveTo(this.radius * 0.7, -2);
        ctx.lineTo(this.radius * 1.35, 3);
        ctx.lineTo(this.radius * 0.7, 8);
        ctx.closePath();
        ctx.fill();

        // Beak shine
        ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
        ctx.beginPath();
        ctx.moveTo(this.radius * 0.75, 0);
        ctx.lineTo(this.radius * 1.1, 3);
        ctx.lineTo(this.radius * 0.75, 3);
        ctx.closePath();
        ctx.fill();

        // Big Anime Eye
        const eyeX = this.radius * 0.4;
        const eyeY = -this.radius * 0.2;
        const eyeR = 6.5;

        if (this.isBlinking) {
            // Closed eye arc
            ctx.strokeStyle = '#222';
            ctx.lineWidth = 2.5;
            ctx.lineCap = 'round';
            ctx.beginPath();
            ctx.arc(eyeX, eyeY + 1, eyeR * 0.8, 0.2 * Math.PI, 0.8 * Math.PI);
            ctx.stroke();
        } else {
            // White sclera
            ctx.fillStyle = '#FFFFFF';
            ctx.beginPath();
            ctx.arc(eyeX, eyeY, eyeR, 0, Math.PI * 2);
            ctx.fill();

            // Pupil
            ctx.fillStyle = '#1D1E2C';
            ctx.beginPath();
            ctx.arc(eyeX + 1.2, eyeY, eyeR * 0.65, 0, Math.PI * 2);
            ctx.fill();

            // Large sparkle reflection
            ctx.fillStyle = '#FFFFFF';
            ctx.beginPath();
            ctx.arc(eyeX + 2.2, eyeY - 2, 2.2, 0, Math.PI * 2);
            ctx.fill();

            // Small secondary sparkle
            ctx.beginPath();
            ctx.arc(eyeX - 0.5, eyeY + 1.8, 1.1, 0, Math.PI * 2);
            ctx.fill();
        }

        // Flapping Wing with animated rotation
        ctx.save();
        ctx.translate(-this.radius * 0.35, this.radius * 0.05);
        ctx.rotate(this.wingAngle);

        const wingGrad = ctx.createLinearGradient(-14, 0, 14, 10);
        wingGrad.addColorStop(0, skin.wing);
        wingGrad.addColorStop(1, skin.wingEdge);
        ctx.fillStyle = wingGrad;

        ctx.beginPath();
        ctx.ellipse(0, 0, 14, 9, -0.3, 0, Math.PI * 2);
        ctx.fill();

        // Wing feather lines
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.arc(2, 0, 8, -0.6, 0.6);
        ctx.stroke();

        ctx.restore();

        // Little Head Tuft / Feather Crest
        ctx.fillStyle = skin.wing;
        ctx.beginPath();
        ctx.moveTo(-4, -this.radius * 0.85);
        ctx.quadraticCurveTo(-8, -this.radius * 1.35, -2, -this.radius * 1.3);
        ctx.quadraticCurveTo(2, -this.radius * 1.1, 2, -this.radius * 0.85);
        ctx.fill();

        ctx.restore();
    }
}

window.FluffyBird = FluffyBird;
