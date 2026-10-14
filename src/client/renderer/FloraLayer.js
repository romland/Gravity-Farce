import { RENDER_CONFIG } from './RenderConfig.js';

export class FloraLayer {
    constructor() {
        this.anchors = [];
        this.drips = [];
        this.fireflies = [];
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
        this.fireflies = [];

        // Seed interactive bioluminescent spore-fireflies around glowing flora
        if (RENDER_CONFIG.flora.firefliesEnabled !== false) {
            for (const a of this.anchors) {
                if (a.kind === 'GLOW_SHROOM' || a.kind === 'CAVE_FLOWER' || (a.kind === 'VINE' && a.seed > 72)) {
                    const ox = a.x + (Math.sin(a.seed) * 24);
                    const oy = a.kind === 'VINE' ? a.y + a.length : a.y - a.length * 0.8;
                    this.fireflies.push({
                        x: ox,
                        y: oy,
                        homeX: ox,
                        homeY: oy,
                        vx: 0,
                        vy: 0,
                        phase: a.seed,
                        color: a.kind === 'CAVE_FLOWER' ? '#ff7eb3' : (a.kind === 'GLOW_SHROOM' ? '#00f2fe' : '#7dffaa')
                    });
                }
            }
        }
    }

    updateAndDraw(ctx, players, timeSec, spawnParticlesFn, level) {
        const cfg = RENDER_CONFIG.flora;
        if (!cfg.enabled) return;
        if (level && this.builtForLevel !== level) {
            this.initLevel(level);
        }
        if (!this.anchors.length) return;

        const shipList = Object.values(players).filter(p => !p.isDead);

        ctx.save();
        for (const a of this.anchors) {
            if (a.kind === 'DRIP_EMITTER') {
                if (Math.random() < cfg.dripSpawnChance && this.drips.length < cfg.maxDrips) {
                    this.drips.push({ x: a.x, y: a.y + 4, vy: 1.5, life: 110 });
                }
                continue;
            }

            // Interactive Ship-Wash & Thruster Blast Physics
            // Evaluate distance against the full vertical span of the plant so it stays parted while a ship is inside it!
            const dirY = a.kind === 'VINE' ? 1 : -1;
            let targetBend = 0;

            for (const s of shipList) {
                const dx = a.x - s.x;
                const clampedY = dirY > 0
                    ? Math.max(a.y, Math.min(a.y + a.length, s.y))
                    : Math.max(a.y - a.length, Math.min(a.y, s.y));
                const dy = clampedY - s.y;
                const dist = Math.hypot(dx, dy * 0.75);

                const isThrusting = Boolean(s.inputs && s.inputs.up);
                const radius = isThrusting ? cfg.thrustRadius : cfg.proxRadius;
                if (dist < radius) {
                    const proximity = Math.pow(1.0 - (dist / radius), cfg.proxExponent);
                    // Keep a stable parting direction even when the ship center is dead-on the stem
                    const pushDir = Math.abs(dx) < 8 ? (a.bendAngle >= 0 ? 1 : -1) : (dx > 0 ? 1 : -1);
                    const thrustBoost = isThrusting ? cfg.thrustMultiplier : 1.0;
                    const desired = pushDir * Math.min(cfg.maxBendAngle, proximity * cfg.bendStrength * thrustBoost);
                    if (Math.abs(desired) > Math.abs(targetBend)) {
                        targetBend = desired;
                    }
                }
            }

            // Smoothly spring toward targetBend (holds open while ship is present, relaxes when ship leaves)
            const springK = targetBend !== 0 ? cfg.activeSpringK : cfg.restSpringK;
            a.bendVel += (targetBend - a.bendAngle) * springK;
            a.bendVel *= cfg.damping;
            a.bendAngle = Math.max(-cfg.maxBendAngle, Math.min(cfg.maxBendAngle, a.bendAngle + a.bendVel));

            if (a.kind === 'VINE') {
                this.drawVine(ctx, a, timeSec, cfg);
            } else if (a.kind === 'FERN') {
                this.drawFern(ctx, a, timeSec, cfg);
            } else if (a.kind === 'GLOW_SHROOM') {
                this.drawGlowShroom(ctx, a, timeSec, cfg);
            } else if (a.kind === 'BROADLEAF' && cfg.broadleafEnabled !== false) {
                this.drawBroadleaf(ctx, a, timeSec, cfg);
            } else if (a.kind === 'CAVE_FLOWER' && cfg.caveFlowerEnabled !== false) {
                this.drawCaveFlower(ctx, a, timeSec, cfg);
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

        // Update & draw interactive bioluminescent firefly/spore swarms
        if (cfg.firefliesEnabled !== false && this.fireflies.length > 0) {
            const ffRadius = cfg.fireflyRadius ?? 1.8;
            const ffAlpha = cfg.fireflyAlpha ?? 0.45;
            ctx.globalCompositeOperation = 'lighter';
            for (const f of this.fireflies) {
                const targetX = f.homeX + Math.sin(timeSec * 1.6 + f.phase) * 18;
                const targetY = f.homeY + Math.cos(timeSec * 1.3 + f.phase * 1.7) * 14;
                f.vx += (targetX - f.x) * 0.025;
                f.vy += (targetY - f.y) * 0.025;

                for (const s of shipList) {
                    const dx = f.x - s.x;
                    const dy = f.y - s.y;
                    const d = Math.hypot(dx, dy);
                    if (d < 110 && d > 1) {
                        const push = ((110 - d) / 110) * (s.inputs?.up ? 1.8 : 0.9);
                        f.vx += (dx / d) * push;
                        f.vy += (dy / d) * push;
                    }
                }

                f.vx *= 0.88;
                f.vy *= 0.88;
                f.x += f.vx;
                f.y += f.vy;

                const pulse = 0.45 + 0.55 * Math.sin(timeSec * 4.2 + f.phase);
                ctx.fillStyle = f.color;
                ctx.globalAlpha = pulse * ffAlpha;
                ctx.beginPath();
                ctx.arc(f.x, f.y, ffRadius * (0.75 + pulse * 0.5), 0, Math.PI * 2);
                ctx.fill();
            }
            ctx.globalAlpha = 1.0;
            ctx.globalCompositeOperation = 'source-over';
        }

        ctx.restore();
    }

    drawVine(ctx, a, timeSec, cfg) {
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
            const wind = Math.sin(timeSec * cfg.windSpeed + a.seed + t * 2.0) * cfg.vineWindAmp;
            const washOffset = a.bendAngle * a.length * cfg.vineWashScale;
            tipX = a.x + (wind + washOffset) * (t * t);
            tipY = a.y + a.length * t;
            ctx.lineTo(tipX, tipY);
        }
        ctx.stroke();

        // Secondary side-leaf nodes along the vine
        ctx.fillStyle = '#38b862';
        for (let s = 2; s < segments; s += 2) {
            const t = s / segments;
            const wind = Math.sin(timeSec * cfg.windSpeed + a.seed + t * 2.0) * cfg.vineWindAmp;
            const washOffset = a.bendAngle * a.length * cfg.vineWashScale;
            const lx = a.x + (wind + washOffset) * (t * t);
            const ly = a.y + a.length * t;
            const side = (s % 4 === 0 ? 1 : -1) * 7;
            ctx.beginPath();
            ctx.ellipse(lx + side, ly, 6, 2.5, side > 0 ? 0.4 : -0.4, 0, Math.PI * 2);
            ctx.fill();
        }

        // Hanging blossoms along mature vines
        if (cfg.vineBlossomsEnabled !== false && a.seed > 52) {
            const bt = 0.55;
            const bWind = Math.sin(timeSec * cfg.windSpeed + a.seed + bt * 2.0) * cfg.vineWindAmp;
            const bWash = a.bendAngle * a.length * cfg.vineWashScale;
            const bx = a.x + (bWind + bWash) * (bt * bt);
            const by = a.y + a.length * bt;
            ctx.fillStyle = '#ff7eb3';
            ctx.beginPath();
            ctx.arc(bx, by, 4.2, 0, Math.PI * 2);
            ctx.fill();
        }

        // Bioluminescent spore tip with soft local halo
        if (cfg.localHaloEnabled !== false) {
            const pulse = 0.7 + 0.3 * Math.sin(timeSec * 3.5 + a.seed);
            const haloR = (cfg.vineTipHaloRadius ?? 7.0) * pulse;
            const haloA = (cfg.vineTipHaloAlpha ?? 0.16) * pulse;
            ctx.fillStyle = `rgba(125, 255, 170, ${haloA})`;
            ctx.beginPath();
            ctx.arc(tipX, tipY, haloR, 0, Math.PI * 2);
            ctx.fill();
        }

        ctx.fillStyle = '#7dffaa';
        ctx.beginPath();
        ctx.arc(tipX, tipY, 4.5, 0, Math.PI * 2);
        ctx.fill();
    }

    drawFern(ctx, a, timeSec, cfg) {
        const sway = Math.sin(timeSec * (cfg.windSpeed * 1.25) + a.seed) * cfg.fernWindAmp + a.bendAngle * cfg.fernWashScale;
        ctx.strokeStyle = '#38b862';
        ctx.lineWidth = 3.2;
        ctx.lineCap = 'round';
        for (const spread of [-0.75, -0.35, 0, 0.35, 0.75]) {
            const frondLen = a.length * (1.0 - Math.abs(spread) * 0.35);
            const ctrlX = a.x + spread * 22 + sway * 0.5;
            const ctrlY = a.y - frondLen * 0.6;
            const endX = a.x + spread * 38 + sway;
            const endY = a.y - frondLen;

            ctx.beginPath();
            ctx.moveTo(a.x, a.y);
            ctx.quadraticCurveTo(ctrlX, ctrlY, endX, endY);
            ctx.stroke();

            // Serrated pinnae leaflets along each frond
            ctx.fillStyle = '#4cd97b';
            for (let p = 1; p <= 4; p++) {
                const pt = p / 5;
                const omt = 1 - pt;
                const lx = omt * omt * a.x + 2 * omt * pt * ctrlX + pt * pt * endX;
                const ly = omt * omt * a.y + 2 * omt * pt * ctrlY + pt * pt * endY;
                const r = (1 - pt * 0.5) * 4.5;
                ctx.beginPath();
                ctx.ellipse(lx - 4, ly, r, 1.8, -0.35, 0, Math.PI * 2);
                ctx.ellipse(lx + 4, ly, r, 1.8, 0.35, 0, Math.PI * 2);
                ctx.fill();
            }
        }
    }

    drawGlowShroom(ctx, a, timeSec, cfg) {
        const sway = Math.sin(timeSec * cfg.windSpeed + a.seed) * cfg.shroomWindAmp + a.bendAngle * cfg.shroomWashScale;
        const tipX = a.x + sway;
        const tipY = a.y - a.length;
        const pulse = 0.78 + 0.22 * Math.sin(timeSec * 3.2 + a.seed);

        // Outer bioluminescent aura
        if (cfg.localHaloEnabled !== false) {
            const haloR = (cfg.shroomHaloRadius ?? 16.0) * pulse;
            const haloA = cfg.shroomHaloAlpha ?? 0.22;
            const grad = ctx.createRadialGradient(tipX, tipY, 2, tipX, tipY, haloR);
            grad.addColorStop(0, `rgba(0, 242, 254, ${haloA})`);
            grad.addColorStop(0.5, `rgba(79, 172, 254, ${haloA * 0.35})`);
            grad.addColorStop(1, 'rgba(0, 242, 254, 0)');
            ctx.fillStyle = grad;
            ctx.beginPath();
            ctx.arc(tipX, tipY, haloR, 0, Math.PI * 2);
            ctx.fill();
        }

        // Primary & companion stems
        ctx.strokeStyle = '#70a1ff';
        ctx.lineWidth = 3.5;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.quadraticCurveTo(a.x + sway * 0.4, a.y - a.length * 0.5, tipX, tipY);
        ctx.stroke();

        // Gill underside shadow
        ctx.fillStyle = '#1b3b6f';
        ctx.beginPath();
        ctx.ellipse(tipX, tipY + 1, 11.5, 4.0, 0, 0, Math.PI * 2);
        ctx.fill();

        // Glowing umbrella cap
        ctx.fillStyle = '#00f2fe';
        ctx.beginPath();
        ctx.arc(tipX, tipY, 11.5, Math.PI, 0);
        ctx.fill();

        // Inner bright core spots
        ctx.fillStyle = '#d6ffff';
        ctx.beginPath();
        ctx.arc(tipX - 4, tipY - 4, 2.0, 0, Math.PI * 2);
        ctx.arc(tipX + 3, tipY - 6, 1.6, 0, Math.PI * 2);
        ctx.fill();
    }

    drawBroadleaf(ctx, a, timeSec, cfg) {
        const sway = Math.sin(timeSec * cfg.windSpeed + a.seed) * cfg.fernWindAmp + a.bendAngle * cfg.fernWashScale;
        const leaves = [
            { angle: -0.55, scale: 0.85, color: '#1e824c', vein: '#58d68d' },
            { angle: 0.50, scale: 0.90, color: '#239b56', vein: '#7dcea0' },
            { angle: -0.05, scale: 1.05, color: '#2ecc71', vein: '#abebc6' }
        ];

        for (const lf of leaves) {
            const len = a.length * lf.scale;
            const tx = a.x + Math.sin(lf.angle) * len * 0.85 + sway;
            const ty = a.y - Math.cos(lf.angle) * len;
            const lAngle = Math.atan2(ty - a.y, tx - a.x);
            const midX = (a.x + tx) * 0.5;
            const midY = (a.y + ty) * 0.5;

            ctx.save();
            ctx.translate(midX, midY);
            ctx.rotate(lAngle);

            ctx.fillStyle = lf.color;
            ctx.beginPath();
            ctx.ellipse(0, 0, len * 0.52, len * 0.24, 0, 0, Math.PI * 2);
            ctx.fill();

            ctx.strokeStyle = lf.vein;
            ctx.lineWidth = 1.6;
            ctx.beginPath();
            ctx.moveTo(-len * 0.45, 0);
            ctx.lineTo(len * 0.42, 0);
            ctx.stroke();
            ctx.restore();
        }
    }

    drawCaveFlower(ctx, a, timeSec, cfg) {
        const sway = Math.sin(timeSec * cfg.windSpeed + a.seed) * cfg.shroomWindAmp + a.bendAngle * cfg.shroomWashScale;
        const tipX = a.x + sway;
        const tipY = a.y - a.length;
        const pulse = 0.8 + 0.2 * Math.sin(timeSec * 3.8 + a.seed);

        // Stem & basal leaves
        ctx.strokeStyle = '#2ecc71';
        ctx.lineWidth = 3.0;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.quadraticCurveTo(a.x + sway * 0.35, a.y - a.length * 0.5, tipX, tipY);
        ctx.stroke();

        // Local blossom glow halo
        const isGold = (Math.floor(a.seed) % 2) === 0;
        const petalColor = isGold ? '#ffbe40' : '#ff6b9d';
        const coreColor = isGold ? '#fff6b0' : '#ffe0f0';
        if (cfg.localHaloEnabled !== false) {
            const haloR = (cfg.flowerHaloRadius ?? 14.0) * pulse;
            const haloA = cfg.flowerHaloAlpha ?? 0.20;
            const glowRgba = isGold
                ? `rgba(255, 190, 64, ${haloA})`
                : `rgba(255, 107, 157, ${haloA})`;
            const grad = ctx.createRadialGradient(tipX, tipY, 2, tipX, tipY, haloR);
            grad.addColorStop(0, glowRgba);
            grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
            ctx.fillStyle = grad;
            ctx.beginPath();
            ctx.arc(tipX, tipY, haloR, 0, Math.PI * 2);
            ctx.fill();
        }

        // Cupped bioluminescent petals
        ctx.fillStyle = petalColor;
        for (let p = 0; p < 5; p++) {
            const ang = (p / 5) * Math.PI * 2 + timeSec * 0.25;
            ctx.beginPath();
            ctx.ellipse(tipX + Math.cos(ang) * 5.5, tipY + Math.sin(ang) * 5.5, 6.2, 3.6, ang, 0, Math.PI * 2);
            ctx.fill();
        }

        // Luminous stamen core
        ctx.fillStyle = coreColor;
        ctx.beginPath();
        ctx.arc(tipX, tipY, 3.8, 0, Math.PI * 2);
        ctx.fill();
    }
}
