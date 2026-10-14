export class FloraLayer {
    constructor() {
        this.anchors = [];
        this.drips = [];
    }

    initLevel(level) {
        const raw = level?.highRes?.flora || [];
        this.anchors = raw.map(a => ({
            ...a,
            bendAngle: 0,
            bendVel: 0
        }));
        this.drips = [];
    }

    updateAndDraw(ctx, players, timeSec, spawnParticlesFn) {
        if (!this.anchors.length) return;

        const shipList = Object.values(players).filter(p => !p.isDead);

        ctx.save();
        for (const a of this.anchors) {
            if (a.kind === 'DRIP_EMITTER') {
                if (Math.random() < 0.008 && this.drips.length < 40) {
                    this.drips.push({ x: a.x, y: a.y + 4, vy: 1.5, life: 110 });
                }
                continue;
            }

            // Interactive Ship-Wash & Thruster Blast Physics
            for (const s of shipList) {
                const dx = a.x - s.x;
                const dy = a.y - s.y;
                const dist = Math.hypot(dx, dy);
                if (dist < 110 && dist > 1) {
                    const shipForce = (110 - dist) / 110;
                    const thrustMult = (s.inputs && s.inputs.up) ? 2.4 : 1.0;
                    const pushDir = dx >= 0 ? 1 : -1;
                    a.bendVel += pushDir * shipForce * thrustMult * 0.035;
                }
            }

            // Damped harmonic spring back to rest
            a.bendVel += -a.bendAngle * 0.08;
            a.bendVel *= 0.88;
            a.bendAngle = Math.max(-1.1, Math.min(1.1, a.bendAngle + a.bendVel));

            if (a.kind === 'VINE') {
                this.drawVine(ctx, a, timeSec);
            } else if (a.kind === 'FERN') {
                this.drawFern(ctx, a, timeSec);
            } else if (a.kind === 'GLOW_SHROOM') {
                this.drawGlowShroom(ctx, a, timeSec);
            }
        }

        // Update & draw falling subterranean water droplets
        ctx.fillStyle = 'rgba(130, 210, 255, 0.75)';
        for (let i = this.drips.length - 1; i >= 0; i--) {
            const d = this.drips[i];
            d.vy += 0.08;
            d.y += d.vy;
            d.life--;
            if (d.life <= 0) {
                if (spawnParticlesFn) spawnParticlesFn(d.x, d.y, 0, -0.5, 'rgba(130, 210, 255, 0.6)', 2, 12);
                this.drips.splice(i, 1);
                continue;
            }
            ctx.fillRect(d.x - 1, d.y - 3, 2, 5);
        }
        ctx.restore();
    }

    drawVine(ctx, a, timeSec) {
        const segments = 5;
        ctx.strokeStyle = '#2ea355';
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);

        let tipX = a.x;
        let tipY = a.y;
        for (let s = 1; s <= segments; s++) {
            const t = s / segments;
            // Quadratic bend curve (t^2) so root stays locked to rock contour
            const wind = Math.sin(timeSec * 2.2 + a.seed + t * 2.0) * 6.0;
            const washOffset = a.bendAngle * a.length * 0.65;
            tipX = a.x + (wind + washOffset) * (t * t);
            tipY = a.y + a.length * t;
            ctx.lineTo(tipX, tipY);
        }
        ctx.stroke();

        // Bioluminescent spore tip
        ctx.fillStyle = '#7dffaa';
        ctx.beginPath();
        ctx.arc(tipX, tipY, 2.5, 0, Math.PI * 2);
        ctx.fill();
    }

    drawFern(ctx, a, timeSec) {
        const sway = Math.sin(timeSec * 2.8 + a.seed) * 4 + a.bendAngle * 14;
        ctx.strokeStyle = '#38b862';
        ctx.lineWidth = 2;
        for (const spread of [-0.5, 0, 0.5]) {
            ctx.beginPath();
            ctx.moveTo(a.x, a.y);
            ctx.quadraticCurveTo(
                a.x + spread * 10 + sway * 0.5,
                a.y - a.length * 0.6,
                a.x + spread * 18 + sway,
                a.y - a.length
            );
            ctx.stroke();
        }
    }

    drawGlowShroom(ctx, a, timeSec) {
        const sway = Math.sin(timeSec * 2.0 + a.seed) * 3 + a.bendAngle * 12;
        const tipX = a.x + sway;
        const tipY = a.y - a.length;

        ctx.strokeStyle = '#70a1ff';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(tipX, tipY);
        ctx.stroke();

        ctx.fillStyle = '#00f2fe';
        ctx.beginPath();
        ctx.arc(tipX, tipY, 4.5, Math.PI, 0);
        ctx.fill();
    }
}