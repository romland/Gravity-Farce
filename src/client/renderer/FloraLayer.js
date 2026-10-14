export class FloraLayer {
    constructor() {
        this.anchors = [];
        this.drips = [];
        this.builtForLevel = null;
    }

    initLevel(level) {
        this.builtForLevel = level;
        const raw = level?.highRes?.flora || [];
        this.anchors = raw.map(a => ({
            ...a,
            bendAngle: 0,
            bendVel: 0
        }));
        this.drips = [];
    }

    updateAndDraw(ctx, players, timeSec, spawnParticlesFn, level) {
        if (level && this.builtForLevel !== level) {
            this.initLevel(level);
        }
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
            // Evaluate distance against the full vertical span of the plant so it stays parted while a ship is inside it!
            const dirY = a.kind === 'VINE' ? 1 : -1;
            const midY = a.y + dirY * (a.length * 0.55);
            let targetBend = 0;

            for (const s of shipList) {
                const dx = a.x - s.x;
                const clampedY = dirY > 0
                    ? Math.max(a.y, Math.min(a.y + a.length, s.y))
                    : Math.max(a.y - a.length, Math.min(a.y, s.y));
                const dy = clampedY - s.y;
                const dist = Math.hypot(dx, dy * 0.75);

                const radius = (s.inputs && s.inputs.up) ? 210 : 165;
                if (dist < radius) {
                    const proximity = 1.0 - (dist / radius);
                    // Keep a stable parting direction even when the ship center is dead-on the stem
                    const pushDir = Math.abs(dx) < 8 ? (a.bendAngle >= 0 ? 1 : -1) : (dx > 0 ? 1 : -1);
                    const thrustBoost = (s.inputs && s.inputs.up) ? 1.45 : 1.0;
                    const desired = pushDir * Math.min(1.45, proximity * 1.35 * thrustBoost);
                    if (Math.abs(desired) > Math.abs(targetBend)) {
                        targetBend = desired;
                    }
                }
            }

            // Smoothly spring toward targetBend (holds open while ship is present, relaxes when ship leaves)
            const springK = targetBend !== 0 ? 0.14 : 0.045;
            a.bendVel += (targetBend - a.bendAngle) * springK;
            a.bendVel *= 0.84;
            a.bendAngle = Math.max(-1.55, Math.min(1.55, a.bendAngle + a.bendVel));

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
        const segments = 7;
        ctx.strokeStyle = '#2ea355';
        ctx.lineWidth = 4.0;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);

        let tipX = a.x;
        let tipY = a.y;
        for (let s = 1; s <= segments; s++) {
            const t = s / segments;
            // Quadratic bend curve (t^2) so root stays locked to rock contour
            const wind = Math.sin(timeSec * 2.2 + a.seed + t * 2.0) * 14.0;
            const washOffset = a.bendAngle * a.length * 0.92;
            tipX = a.x + (wind + washOffset) * (t * t);
            tipY = a.y + a.length * t;
            ctx.lineTo(tipX, tipY);
        }
        ctx.stroke();

        // Secondary side-leaf nodes along the vine
        ctx.fillStyle = '#38b862';
        for (let s = 2; s < segments; s += 2) {
            const t = s / segments;
            const wind = Math.sin(timeSec * 2.2 + a.seed + t * 2.0) * 14.0;
            const washOffset = a.bendAngle * a.length * 0.92;
            const lx = a.x + (wind + washOffset) * (t * t);
            const ly = a.y + a.length * t;
            const side = (s % 4 === 0 ? 1 : -1) * 7;
            ctx.beginPath();
            ctx.ellipse(lx + side, ly, 6, 2.5, side > 0 ? 0.4 : -0.4, 0, Math.PI * 2);
            ctx.fill();
        }

        // Bioluminescent spore tip
        ctx.fillStyle = '#7dffaa';
        ctx.beginPath();
        ctx.arc(tipX, tipY, 4.5, 0, Math.PI * 2);
        ctx.fill();
    }

    drawFern(ctx, a, timeSec) {
        const sway = Math.sin(timeSec * 2.8 + a.seed) * 9 + a.bendAngle * 42;
        ctx.strokeStyle = '#38b862';
        ctx.lineWidth = 3.2;
        ctx.lineCap = 'round';
        for (const spread of [-0.75, -0.35, 0, 0.35, 0.75]) {
            const frondLen = a.length * (1.0 - Math.abs(spread) * 0.35);
            ctx.beginPath();
            ctx.moveTo(a.x, a.y);
            ctx.quadraticCurveTo(
                a.x + spread * 22 + sway * 0.5,
                a.y - frondLen * 0.6,
                a.x + spread * 38 + sway,
                a.y - frondLen
            );
            ctx.stroke();
        }
    }

    drawGlowShroom(ctx, a, timeSec) {
        const sway = Math.sin(timeSec * 2.0 + a.seed) * 7 + a.bendAngle * 36;
        const tipX = a.x + sway;
        const tipY = a.y - a.length;

        ctx.strokeStyle = '#70a1ff';
        ctx.lineWidth = 3.5;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.quadraticCurveTo(a.x + sway * 0.4, a.y - a.length * 0.5, tipX, tipY);
        ctx.stroke();

        ctx.fillStyle = '#00f2fe';
        ctx.beginPath();
        ctx.arc(tipX, tipY, 9.0, Math.PI, 0);
        ctx.fill();
    }
}
