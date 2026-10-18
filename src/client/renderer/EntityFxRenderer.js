// src/client/renderer/EntityFxRenderer.js
import { ENTITY_FX_PROFILES, FX_PRNG_PALETTES } from './EntityFxConfig.js';
import { RENDER_CONFIG } from './RenderConfig.js';

export class EntityFxRenderer {
    constructor() {
        this.haloCache = new Map();
    }

    /**
     * Returns a pre-baked 64x64 radial gradient canvas for the given RGB string.
     * Eliminates per-frame ctx.createRadialGradient allocations!
     */
    getHaloSprite(rgbStr) {
        let spr = this.haloCache.get(rgbStr);
        if (spr) return spr;
        if (typeof document === 'undefined') return null;

        const sz = 64;
        const c = document.createElement('canvas');
        c.width = sz;
        c.height = sz;
        const gCtx = c.getContext('2d');
        const g = gCtx.createRadialGradient(32, 32, 2, 32, 32, 32);
        g.addColorStop(0.0, `rgba(${rgbStr}, 1.0)`);
        g.addColorStop(0.4, `rgba(${rgbStr}, 0.45)`);
        g.addColorStop(1.0, `rgba(${rgbStr}, 0.0)`);
        gCtx.fillStyle = g;
        gCtx.beginPath();
        gCtx.arc(32, 32, 32, 0, Math.PI * 2);
        gCtx.fill();

        this.haloCache.set(rgbStr, c);
        return c;
    }

    /**
     * Fast stateless deterministic hash in [0, 1) from integer seed + salt.
     */
    hash01(seed, salt) {
        let h = Math.imul((seed || 1) ^ Math.imul(salt + 1, 374761393), 668265263);
        h = Math.imul(h ^ (h >>> 13), 1274126177);
        return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
    }

    resolvePaletteEntry(layer, seed, salt = 0) {
        const palList = FX_PRNG_PALETTES[layer.palette || 'plasma'] || FX_PRNG_PALETTES.plasma;
        if (layer.color && layer.color !== 'prng') {
            return {
                glow: layer.color,
                core: layer.coreColor || '#ffffff',
                rgb: layer.rgb || '0, 242, 254'
            };
        }
        const idx = Math.floor(this.hash01(seed, salt) * palList.length) % palList.length;
        return palList[idx];
    }

    getProfile(profileKey) {
        const prof = ENTITY_FX_PROFILES[profileKey];
        if (!prof) return null;
        if (prof.inherit && ENTITY_FX_PROFILES[prof.inherit]) {
            return ENTITY_FX_PROFILES[prof.inherit];
        }
        return prof;
    }

    /**
     * Renders all configured procedural FX layers for an entity in its local space.
     * Expects `ctx` to already be translated to `(entity.x, entity.y)` and rotated by `entity.angle`.
     */
    drawEntityFx(ctx, profileKey, width, height, seed = 1, timeSec = 0, entityState = null) {
        if (RENDER_CONFIG.details?.entityFxEnabled === false) return;
        const profile = this.getProfile(profileKey);
        if (!profile || !profile.layers) return;

        const effSeed = seed || 1;
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';

        const layers = profile.layers;
        for (let i = 0; i < layers.length; i++) {
            const layer = layers[i];
            const pal = this.resolvePaletteEntry(layer, effSeed, i * 17);

            switch (layer.kind) {
                case 'TESLA_CRACKLE':
                    this.drawTeslaCrackle(ctx, layer, pal, width, height, effSeed + i * 31, timeSec);
                    break;
                case 'RADIATION_AURA':
                    this.drawRadiationAura(ctx, layer, pal, width, height, effSeed + i * 31, timeSec);
                    break;
                case 'CONTAINMENT_SHIELD':
                    this.drawContainmentShield(ctx, layer, pal, width, height, effSeed + i * 31, timeSec);
                    break;
                case 'JACOBS_LADDER':
                    this.drawJacobsLadder(ctx, layer, pal, width, height, effSeed + i * 31, timeSec);
                    break;
                case 'THRUSTER_PLUME':
                    this.drawThrusterPlume(ctx, layer, pal, width, height, effSeed + i * 31, timeSec, entityState);
                    break;
                case 'FURNACE_PULSE':
                    this.drawFurnacePulse(ctx, layer, pal, width, height, effSeed + i * 31, timeSec);
                    break;
                case 'SCANNER_SWEEP':
                    this.drawScannerSweep(ctx, layer, pal, width, height, effSeed + i * 31, timeSec);
                    break;
                case 'PLASMA_VENT':
                    this.drawPlasmaVent(ctx, layer, pal, width, height, effSeed + i * 31, timeSec);
                    break;
            }
        }

        ctx.restore();
    }

    traceJaggedBolt(ctx, x1, y1, x2, y2, segments, ampPx, timeStep, seedSalt) {
        const dx = x2 - x1;
        const dy = y2 - y1;
        const len = Math.hypot(dx, dy) || 1;
        const nx = -dy / len;
        const ny = dx / len;

        ctx.moveTo(x1, y1);
        for (let s = 1; s < segments; s++) {
            const t = s / segments;
            const env = Math.sin(t * Math.PI);
            const nVal = Math.sin(timeStep * 1.7 + s * 4.9 + seedSalt) * Math.cos(timeStep * 1.1 - s * 3.3 + seedSalt * 0.7);
            const offset = nVal * ampPx * env;
            ctx.lineTo(x1 + dx * t + nx * offset, y1 + dy * t + ny * offset);
        }
        ctx.lineTo(x2, y2);
    }

    drawTeslaCrackle(ctx, layer, pal, w, h, seed, timeSec) {
        const segs = layer.segments || 6;
        const jagPx = (layer.jaggedness || 0.08) * Math.min(w, h);
        const thick = layer.thickness || 1.8;
        const arcCount = layer.arcCount || 2;

        // Pass 0: Outer colored plasma glow; Pass 1: White-hot inner core
        for (let pass = 0; pass < 2; pass++) {
            ctx.strokeStyle = pass === 0 ? pal.glow : pal.core;
            ctx.lineWidth = pass === 0 ? thick * 1.85 : thick * 0.65;
            ctx.globalAlpha = pass === 0 ? 0.78 : 0.92;
            ctx.beginPath();

            if (layer.mode === 'center_out_h' && layer.origins) {
                for (let o = 0; o < layer.origins.length; o++) {
                    const orig = layer.origins[o];
                    const sx = orig.ox * w;
                    const sy = orig.oy * h;
                    for (let side of [-1, 1]) {
                        for (let a = 0; a < arcCount; a++) {
                            const salt = seed + o * 19 + (side > 0 ? 7 : 3) + a * 41;
                            const isFast = layer.speed === 'mixed' ? (a % 2 === 0) : true;
                            const spd = layer.speed === 'mixed' ? (isFast ? 18.0 : 3.2) : (layer.speed || 10.0);
                            const tStep = Math.floor(timeSec * spd * 3.0) * 0.35 + timeSec * spd;
                            const crawl = 0.55 + 0.45 * Math.sin(timeSec * (isFast ? 5.5 : 1.6) + salt);
                            const ex = side * (orig.spanX * w * (0.45 + 0.55 * crawl));
                            const ey = (orig.targetY + Math.cos(timeSec * 2.3 + salt) * 0.10) * h;
                            this.traceJaggedBolt(ctx, sx, sy, ex, ey, segs, jagPx, tStep, salt);
                        }
                    }
                }
            } else if (layer.mode === 'lick_hull') {
                const rx = (layer.rx || 0.45) * w;
                const ry = (layer.ry || 0.42) * h;
                for (let a = 0; a < arcCount; a++) {
                    const salt = seed + a * 53;
                    const isFast = layer.speed === 'mixed' ? (a % 2 === 1) : false;
                    const spd = layer.speed === 'mixed' ? (isFast ? 16.0 : 2.8) : (layer.speed || 6.0);
                    const baseAng = timeSec * (isFast ? 2.4 : 0.65) * (a % 2 === 0 ? 1 : -1) + salt;
                    const spanAng = 0.9 + 0.5 * Math.sin(timeSec * 1.9 + salt);
                    const x1 = Math.cos(baseAng) * rx;
                    const y1 = Math.sin(baseAng) * ry;
                    const x2 = Math.cos(baseAng + spanAng) * rx;
                    const y2 = Math.sin(baseAng + spanAng) * ry;
                    this.traceJaggedBolt(ctx, x1, y1, x2, y2, segs, jagPx, timeSec * spd, salt);
                }
            } else if (layer.mode === 'lick_lobes' && layer.lobes) {
                for (let l = 0; l < layer.lobes.length; l++) {
                    const lb = layer.lobes[l];
                    const cx = lb.ox * w;
                    const cy = lb.oy * h;
                    const rx = lb.rx * w;
                    const ry = lb.ry * h;
                    for (let a = 0; a < arcCount; a++) {
                        const salt = seed + l * 29 + a * 37;
                        const spd = layer.speed || 5.0;
                        const ang1 = timeSec * 1.2 * (a % 2 === 0 ? 1 : -1) + salt;
                        const ang2 = ang1 + 1.35;
                        this.traceJaggedBolt(
                            ctx,
                            cx + Math.cos(ang1) * rx,
                            cy + Math.sin(ang1) * ry,
                            cx + Math.cos(ang2) * rx,
                            cy + Math.sin(ang2) * ry,
                            segs,
                            jagPx * 0.85,
                            timeSec * spd,
                            salt
                        );
                    }
                }
            } else if (layer.mode === 'point_to_point' && layer.pairs) {
                for (let p = 0; p < layer.pairs.length; p++) {
                    const pr = layer.pairs[p];
                    const salt = seed + p * 43;
                    const isFast = layer.speed === 'mixed' ? (p % 2 === 0) : true;
                    const spd = layer.speed === 'mixed' ? (isFast ? 15.0 : 3.6) : (layer.speed || 9.0);
                    this.traceJaggedBolt(
                        ctx,
                        pr.x1 * w,
                        pr.y1 * h,
                        pr.x2 * w,
                        pr.y2 * h,
                        segs,
                        jagPx,
                        timeSec * spd,
                        salt
                    );
                }
            }

            ctx.stroke();
        }

        // Optional antenna tip halo blits
        if (layer.tipGlow && layer.origins) {
            const spr = this.getHaloSprite(pal.rgb);
            if (spr) {
                const pulse = 0.75 + 0.25 * Math.sin(timeSec * 14.0 + seed);
                const r = Math.min(w, h) * 0.14 * pulse;
                ctx.globalAlpha = 0.75;
                for (let o = 0; o < layer.origins.length; o++) {
                    const sx = layer.origins[o].ox * w;
                    const sy = layer.origins[o].oy * h;
                    ctx.drawImage(spr, sx - r, sy - r, r * 2, r * 2);
                }
            }
        }
    }

    drawRadiationAura(ctx, layer, pal, w, h, seed, timeSec) {
        const spr = this.getHaloSprite(pal.rgb);
        const pulse = 0.72 + 0.28 * Math.sin(timeSec * (layer.pulseSpeed || 3.0) + seed);
        const baseAlpha = (layer.alpha || 0.30) * pulse;

        const emitCenters = [];
        if (layer.mode === 'corners') {
            emitCenters.push(
                { x: -0.36 * w, y: -0.34 * h },
                { x: 0.36 * w, y: -0.34 * h },
                { x: -0.36 * w, y: 0.34 * h },
                { x: 0.36 * w, y: 0.34 * h }
            );
        } else if (layer.mode === 'prng_corner_and_core') {
            const cornerIdx = Math.floor(this.hash01(seed, 99) * 4) % 4;
            const cx = (cornerIdx % 2 === 0 ? -0.36 : 0.36) * w;
            const cy = (cornerIdx < 2 ? -0.34 : 0.34) * h;
            emitCenters.push({ x: cx, y: cy }, { x: 0, y: 0 });
        } else {
            // 'full_box'
            emitCenters.push({ x: -0.22 * w, y: 0 }, { x: 0.22 * w, y: 0 });
        }

        if (spr) {
            ctx.globalAlpha = baseAlpha;
            const radPx = (layer.radius || 0.30) * Math.max(w, h) * (layer.overflow || 1.0) * (0.9 + 0.15 * pulse);
            for (let i = 0; i < emitCenters.length; i++) {
                const c = emitCenters[i];
                ctx.drawImage(spr, c.x - radPx, c.y - radPx, radPx * 2, radPx * 2);
            }
        }

        // Orbiting / drifting radioactive isotope motes inside the hitbox corners
        const moteCount = layer.moteCount || 6;
        ctx.fillStyle = pal.core;
        ctx.globalAlpha = Math.min(0.9, baseAlpha * 2.1);
        ctx.beginPath();
        for (let m = 0; m < moteCount; m++) {
            const c = emitCenters[m % emitCenters.length];
            const phase = timeSec * (1.4 + (m % 3) * 0.4) + seed + m * 2.1;
            const orbitR = (0.08 + (m % 4) * 0.045) * Math.min(w, h);
            const mx = c.x + Math.cos(phase) * orbitR * 1.25;
            const my = c.y + Math.sin(phase * 1.3) * orbitR;
            const mr = 1.4 + (m % 2) * 0.8;
            ctx.moveTo(mx + mr, my);
            ctx.arc(mx, my, mr, 0, Math.PI * 2);
        }
        ctx.fill();
    }

    drawContainmentShield(ctx, layer, pal, w, h, seed, timeSec) {
        const baseRx = w * 0.52;
        const baseRy = h * 0.52;
        const pulse = 0.65 + 0.35 * Math.sin(timeSec * (layer.pulseSpeed || 3.2) + seed);
        const alpha = (layer.alpha || 0.35) * pulse;

        // 1. Organic, morphing, glowing plasma energy shell with multi-pass bloom
        if (layer.hexField) {
            const steps = 36;
            
            // Outer Bloom Pass
            ctx.strokeStyle = pal.glow;
            ctx.lineWidth = 5.0;
            ctx.globalAlpha = alpha * 0.30;
            ctx.beginPath();
            for (let i = 0; i <= steps; i++) {
                const theta = (i / steps) * Math.PI * 2;
                const wave = Math.sin(theta * 4.0 + timeSec * 3.0 + seed) * 4.5 +
                             Math.cos(theta * 6.0 - timeSec * 2.0 + seed) * 3.0;
                const rx = baseRx + wave;
                const ry = baseRy + wave * 0.7;
                const px = Math.cos(theta) * rx;
                const py = Math.sin(theta) * ry;
                if (i === 0) ctx.moveTo(px, py);
                else ctx.lineTo(px, py);
            }
            ctx.closePath();
            ctx.stroke();

            // Main Sharp Core Pass
            ctx.strokeStyle = pal.core;
            ctx.lineWidth = 2.2;
            ctx.globalAlpha = alpha * 0.95;
            ctx.beginPath();
            for (let i = 0; i <= steps; i++) {
                const theta = (i / steps) * Math.PI * 2;
                const wave = Math.sin(theta * 4.0 + timeSec * 3.0 + seed) * 4.5 +
                             Math.cos(theta * 6.0 - timeSec * 2.0 + seed) * 3.0;
                const rx = baseRx + wave;
                const ry = baseRy + wave * 0.7;
                const px = Math.cos(theta) * rx;
                const py = Math.sin(theta) * ry;
                if (i === 0) ctx.moveTo(px, py);
                else ctx.lineTo(px, py);
            }
            ctx.closePath();
            ctx.stroke();

            // Inner swirling reverse-rotating bloom pass
            ctx.strokeStyle = pal.glow;
            ctx.lineWidth = 3.5;
            ctx.globalAlpha = alpha * 0.25;
            ctx.beginPath();
            for (let i = 0; i <= steps; i++) {
                const theta = (i / steps) * Math.PI * 2;
                const wave = Math.cos(theta * 5.0 - timeSec * 4.0 + seed) * 3.5;
                const rx = baseRx * 0.9 + wave;
                const ry = baseRy * 0.9 + wave * 0.7;
                const px = Math.cos(theta) * rx;
                const py = Math.sin(theta) * ry;
                if (i === 0) ctx.moveTo(px, py);
                else ctx.lineTo(px, py);
            }
            ctx.closePath();
            ctx.stroke();

            // Inner core reverse-rotating ring
            ctx.strokeStyle = pal.core;
            ctx.lineWidth = 1.4;
            ctx.globalAlpha = alpha * 0.70;
            ctx.beginPath();
            for (let i = 0; i <= steps; i++) {
                const theta = (i / steps) * Math.PI * 2;
                const wave = Math.cos(theta * 5.0 - timeSec * 4.0 + seed) * 3.5;
                const rx = baseRx * 0.9 + wave;
                const ry = baseRy * 0.9 + wave * 0.7;
                const px = Math.cos(theta) * rx;
                const py = Math.sin(theta) * ry;
                if (i === 0) ctx.moveTo(px, py);
                else ctx.lineTo(px, py);
            }
            ctx.closePath();
            ctx.stroke();
        }

    }

    drawJacobsLadder(ctx, layer, pal, w, h, seed, timeSec) {
        if (!layer.chambers) return;
        const segs = layer.segments || 5;
        const speed = layer.riseSpeed || 1.4;

        for (let pass = 0; pass < 2; pass++) {
            ctx.strokeStyle = pass === 0 ? pal.glow : (layer.coreColor || pal.core);
            ctx.lineWidth = pass === 0 ? (layer.thickness || 1.7) * 1.8 : (layer.thickness || 1.7) * 0.65;
            ctx.globalAlpha = pass === 0 ? 0.80 : 0.95;
            ctx.beginPath();

            for (let c = 0; c < layer.chambers.length; c++) {
                const ch = layer.chambers[c];
                const progress = (timeSec * speed + c * 0.5 + this.hash01(seed, c)) % 1.0;
                const curY = (ch.yBottom + (ch.yTop - ch.yBottom) * progress) * h;
                const archBow = Math.sin(progress * Math.PI) * 5.5;
                this.traceJaggedBolt(
                    ctx,
                    ch.x1 * w,
                    curY,
                    ch.x2 * w,
                    curY - archBow,
                    segs,
                    4.5,
                    timeSec * 16.0,
                    seed + c * 19
                );
            }
            ctx.stroke();
        }
    }

    drawThrusterPlume(ctx, layer, pal, w, h, seed, timeSec) {
        if (!layer.nozzles) return;
        const spr = this.getHaloSprite(pal.rgb);

        for (let n = 0; n < layer.nozzles.length; n++) {
            const nz = layer.nozzles[n];
            const nx = nz.ox * w;
            const ny = nz.oy * h;
            const halfW = nz.width * w * 0.5;
            const flicker = 0.75 + 0.25 * Math.sin(timeSec * (layer.pulseSpeed || 18.0) + seed + n * 3.1);
            const plumeLen = nz.len * h * (0.85 + 0.35 * flicker);

            if (spr) {
                ctx.globalAlpha = 0.55 * flicker;
                const hr = halfW * 2.2;
                ctx.drawImage(spr, nx - hr, ny - hr * 0.4, hr * 2, hr * 2);
            }

            // Outer plasma cone
            ctx.globalAlpha = 0.82;
            ctx.fillStyle = pal.glow;
            ctx.beginPath();
            ctx.moveTo(nx - halfW, ny);
            ctx.lineTo(nx + Math.sin(timeSec * 28 + n) * 2.5, ny + plumeLen);
            ctx.lineTo(nx + halfW, ny);
            ctx.closePath();
            ctx.fill();

            // Inner white-hot shock diamond core
            ctx.globalAlpha = 0.95;
            ctx.fillStyle = pal.core;
            ctx.beginPath();
            ctx.moveTo(nx - halfW * 0.45, ny);
            ctx.lineTo(nx, ny + plumeLen * 0.58);
            ctx.lineTo(nx + halfW * 0.45, ny);
            ctx.closePath();
            ctx.fill();
        }
    }

    drawFurnacePulse(ctx, layer, pal, w, h, seed, timeSec) {
        if (!layer.zones) return;
        const spr = this.getHaloSprite(pal.rgb);
        if (!spr) return;

        const pulse = 0.65 + 0.35 * Math.sin(timeSec * (layer.pulseSpeed || 4.5) + seed);
        ctx.globalAlpha = (layer.alpha || 0.5) * pulse;
        for (let z = 0; z < layer.zones.length; z++) {
            const zn = layer.zones[z];
            const zx = zn.ox * w;
            const zy = zn.oy * h;
            const rw = zn.rx * w * (0.9 + 0.15 * pulse);
            const rh = zn.ry * h * (0.9 + 0.15 * pulse);
            ctx.drawImage(spr, zx - rw, zy - rh, rw * 2, rh * 2);
        }
    }

    drawScannerSweep(ctx, layer, pal, w, h, seed, timeSec) {
        if (!layer.bays) return;
        const speed = layer.speed || 2.5;
        ctx.strokeStyle = pal.glow;
        ctx.lineWidth = 2.0;
        ctx.globalAlpha = 0.72;
        ctx.beginPath();
        for (let b = 0; b < layer.bays.length; b++) {
            const bay = layer.bays[b];
            const sweep = Math.sin(timeSec * speed + seed + b * 1.8) * 0.5;
            const bx = bay.ox * w;
            const by = (bay.oy + sweep * bay.h) * h;
            const halfSpan = bay.w * w * 0.42;
            ctx.moveTo(bx - halfSpan, by);
            ctx.lineTo(bx + halfSpan, by);
        }
        ctx.stroke();
    }

    drawPlasmaVent(ctx, layer, pal, w, h, seed, timeSec) {
        if (!layer.vents) return;
        const pulse = 0.5 + 0.5 * Math.sin(timeSec * (layer.pulseSpeed || 8.0) + seed);
        if (pulse < 0.25) return;

        ctx.strokeStyle = pal.glow;
        ctx.lineWidth = 2.2;
        ctx.globalAlpha = pulse * 0.85;
        ctx.beginPath();
        for (let v = 0; v < layer.vents.length; v++) {
            const vt = layer.vents[v];
            const sx = vt.ox * w;
            const sy = vt.oy * h;
            const len = vt.len * w * pulse;
            this.traceJaggedBolt(
                ctx,
                sx,
                sy,
                sx + vt.dirX * len,
                sy + vt.dirY * len,
                4,
                3.5,
                timeSec * 20.0,
                seed + v * 13
            );
        }
        ctx.stroke();
    }
}