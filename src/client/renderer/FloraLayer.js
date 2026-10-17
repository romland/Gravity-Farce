import { RENDER_CONFIG, rollChance } from './RenderConfig.js';

export class FloraLayer {
    constructor() {
        this.anchors = [];
        this.drips = [];
        this.fireflies = [];
        this.spores = [];
        this.ripples = [];
        this.leafConfetti = [];
        this.creepingVines = [];
        this.builtForLevel = null;
        this.lastTimeSec = 0;
        this.haloSprites = new Map();
    }

    getHaloSprite(rgbStr) {
        let spr = this.haloSprites.get(rgbStr);
        if (spr) return spr;
        if (typeof document === 'undefined') return null;
        const sz = 64;
        const c = document.createElement('canvas');
        c.width = sz;
        c.height = sz;
        const gCtx = c.getContext('2d');
        const g = gCtx.createRadialGradient(32, 32, 2, 32, 32, 32);
        g.addColorStop(0, `rgba(${rgbStr}, 1.0)`);
        g.addColorStop(0.5, `rgba(${rgbStr}, 0.35)`);
        g.addColorStop(1, `rgba(${rgbStr}, 0.0)`);
        gCtx.fillStyle = g;
        gCtx.beginPath();
        gCtx.arc(32, 32, 32, 0, Math.PI * 2);
        gCtx.fill();
        this.haloSprites.set(rgbStr, c);
        return c;
    }

    initLevel(level) {
        this.builtForLevel = level;
        const raw = level?.highRes?.flora || [];
        this.anchors = raw.map((a, idx) => ({
            ...a,
            idx,
            bendAngle: 0,
            bendVel: 0,
            thrustExposureSec: 0,
            burning: false,
            charred: false,
            burnOriginT: 0.5,
            burnMinT: 0.5,
            burnMaxT: 0.5,
            shyness: 0,
            shredCooldown: 0
        }));
        this.drips = [];
        this.fireflies = [];
        this.spores = [];
        this.ripples = [];
        this.leafConfetti = [];
        this.creepingVines = [];

        // Seed interactive bioluminescent spore-fireflies around glowing flora
        if (RENDER_CONFIG.flora.firefliesEnabled !== false) {
            for (const a of this.anchors) {
                if (a.kind === 'GLOW_SHROOM' || a.kind === 'CAVE_FLOWER' || (a.kind === 'VINE' && a.seed > 72)) {
                    const ox = a.x + (Math.sin(a.seed) * 24);
                    const oy = a.kind === 'VINE' ? a.y + a.length : a.y - a.length * 0.8;
                    this.fireflies.push({
                        anchorIdx: a.idx,
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

        if (RENDER_CONFIG.flora.creepingVinesEnabled !== false && level) {
            this.initCreepingVines(level);
        }
    }

    initCreepingVines(level) {
        let seed = 314159;
        const rng = () => {
            seed = (seed * 16807) % 2147483647;
            return (seed - 1) / 2147483646;
        };

        const patchNoise = (wx, wy) => {
            return Math.sin(wx * 0.009 + 1.3) * Math.cos(wy * 0.009 - 0.7);
        };

        // 1. Contour-hugging creeping vines (inward-offset so the collision contour is NEVER obscured)
        if (level.walls) {
            for (const wall of level.walls) {
                const n = wall.length;
                if (n < 16) continue;
                for (let i = 0; i < n - 8; i += 10) {
                    const p0 = wall[i];
                    if (patchNoise(p0.x, p0.y) < 0.38 || rng() > 0.42) continue;

                    const span = 5 + Math.floor(rng() * 5);
                    const nodes = [];
                    for (let k = 0; k < span && (i + k + 1) < n; k++) {
                        const a = wall[i + k];
                        const b = wall[i + k + 1];
                        const dx = b.x - a.x;
                        const dy = b.y - a.y;
                        const len = Math.hypot(dx, dy) || 1;
                        // Outward air normal is (dy/len, -dx/len); inward rock normal is (-dy/len, dx/len)
                        const inX = -dy / len;
                        const inY = dx / len;
                        const inset = 4.5 + Math.sin(k * 1.4 + seed) * 2.5;
                        nodes.push({
                            x: a.x + inX * inset,
                            y: a.y + inY * inset,
                            leafSide: (k % 2 === 0 ? 1 : -1)
                        });
                    }
                    if (nodes.length >= 3) {
                        this.creepingVines.push({ nodes, seed: rng() * 100, kind: 'contour' });
                    }
                }
            }
        }

        // 2. Tree-dressing & Teal-brick climbing vines (strictly inside solid tile bounds)
        if (level.rawMap) {
            const map = level.rawMap;
            const treeTiles = new Set([0x2A, 0x2B, 0x2C, 0x2D, 0x2E, 0x2F, 0x30, 0x31, 0x34, 0x35, 0x36, 0x37, 0x38, 0x39, 0x3A]);
            const tealTiles = new Set([0x1B, 0x1C, 0x1D, 0x1E, 0x1F, 0x21, 0x24, 0x25, 0x26, 0x27, 0x28]);
            for (let y = 1; y < map.length - 1; y++) {
                for (let x = 1; x < map[y].length - 1; x++) {
                    const tid = map[y][x];
                    const isTree = treeTiles.has(tid);
                    const isTeal = tealTiles.has(tid);
                    if (!isTree && !isTeal) continue;

                    const wx = x * 32 + 16;
                    const wy = y * 32 + 16;
                    if (isTeal && (patchNoise(wx, wy) < 0.25 || rng() > 0.35)) continue;
                    if (isTree && rng() > 0.65) continue;

                    // Keep 6px inside the 32x32 tile so outer collision contour stays 100% clear
                    const nodes = [];
                    const segs = 4;
                    const startX = x * 32 + 7 + rng() * 18;
                    const startY = y * 32 + 6;
                    for (let s = 0; s <= segs; s++) {
                        const t = s / segs;
                        nodes.push({
                            x: startX + Math.sin(t * Math.PI * 1.5 + seed) * 5,
                            y: startY + t * 20,
                            leafSide: s % 2 === 0 ? 1 : -1
                        });
                    }
                    this.creepingVines.push({ nodes, seed: rng() * 100, kind: isTree ? 'tree' : 'teal' });
                }
            }
        }
    }

    igniteAnchor(idx, originT) {
        const a = this.anchors[idx];
        if (!a || a.burning || a.charred || a.kind === 'DRIP_EMITTER') return;
        const clampedT = Math.max(0.05, Math.min(0.95, originT ?? 0.5));
        a.burning = true;
        a.burnOriginT = clampedT;
        a.burnMinT = clampedT;
        a.burnMaxT = clampedT;
    }

    syncServerBurns(burns) {
        if (!Array.isArray(burns)) return;
        for (const b of burns) {
            const a = this.anchors[b.idx];
            if (!a || a.kind === 'DRIP_EMITTER') continue;
            a.burning = false;
            a.charred = true;
            a.burnOriginT = b.originT ?? 0.5;
            a.burnMinT = 0.0;
            a.burnMaxT = 1.0;
        }
    }

    resetBurns() {
        for (const a of this.anchors) {
            a.burning = false;
            a.charred = false;
            a.thrustExposureSec = 0;
            a.burnOriginT = 0.5;
            a.burnMinT = 0.5;
            a.burnMaxT = 0.5;
        }
    }

    isIntervalBurned(a, t0, t1) {
        if (!a.burning && !a.charred) return false;
        const mid = (t0 + t1) * 0.5;
        return mid >= a.burnMinT && mid <= a.burnMaxT;
    }

    isPointBurned(a, t) {
        if (!a.burning && !a.charred) return false;
        return t >= a.burnMinT && t <= a.burnMaxT;
    }

    triggerShock(x, y, radius = 85, amount = 0.85) {
        for (const a of this.anchors) {
            if (a.kind !== 'GLOW_SHROOM' && a.kind !== 'CAVE_FLOWER') continue;
            const d = Math.hypot(a.x - x, (a.y - a.length * 0.5) - y);
            if (d < radius) {
                const factor = (1 - d / radius) * amount;
                a.shyness = Math.min(1.0, (a.shyness || 0) + factor);
            }
        }
    }

    charInRadius(x, y, radius = 68) {
        for (const a of this.anchors) {
            if (a.kind === 'DRIP_EMITTER' || a.charred) continue;
            const dirY = a.kind === 'VINE' ? 1 : -1;
            const midY = a.y + dirY * a.length * 0.5;
            const d = Math.hypot(a.x - x, midY - y);
            if (d < radius) {
                if (d < radius * 0.55) {
                    a.burning = false;
                    a.charred = true;
                    a.burnMinT = 0.0;
                    a.burnMaxT = 1.0;
                } else if (!a.burning) {
                    this.igniteAnchor(a.idx, 0.5);
                }
            }
        }
    }

    updateAndDraw(ctx, players, timeSec, spawnParticlesFn, level, bullets, camera, viewW = 1600, viewH = 900) {
        const cfg = RENDER_CONFIG.flora;
        const dCfg = RENDER_CONFIG.details || {};
        if (!cfg.enabled) return;
        if (level && this.builtForLevel !== level) {
            this.initLevel(level);
        }
        if (!this.anchors.length) return;

        const dt = this.lastTimeSec > 0 ? Math.min(0.1, Math.max(0.004, timeSec - this.lastTimeSec)) : (1 / 60);
        const dt60 = dt * 60.0;
        this.lastTimeSec = timeSec;

        const camMinX = camera ? camera.x - 110 : -Infinity;
        const camMaxX = camera ? camera.x + viewW + 110 : Infinity;
        const camMinY = camera ? camera.y - 140 : -Infinity;
        const camMaxY = camera ? camera.y + viewH + 140 : Infinity;
        const shipList = Object.values(players).filter(p => !p.isDead);
        const bulletList = Array.isArray(bullets) ? bullets : [];

        ctx.save();

        // Draw subtle creeping vines along contours, teal bricks & trees (never obscuring collision edges)
        if (cfg.creepingVinesEnabled !== false && this.creepingVines.length > 0) {
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
            for (let i = 0; i < this.creepingVines.length; i++) {
                const cv = this.creepingVines[i];
                const n0 = cv.nodes[0];
                if (n0.x < camMinX || n0.x > camMaxX || n0.y < camMinY || n0.y > camMaxY) continue;

                const sway = Math.sin(timeSec * cfg.windSpeed + cv.seed) * 1.2;
                ctx.strokeStyle = cv.kind === 'teal' ? 'rgba(42, 155, 88, 0.72)' : 'rgba(46, 168, 86, 0.78)';
                ctx.lineWidth = cv.kind === 'tree' ? 2.2 : 1.8;
                ctx.beginPath();
                for (let k = 0; k < cv.nodes.length; k++) {
                    const nd = cv.nodes[k];
                    const px = nd.x + sway * (k / cv.nodes.length);
                    const py = nd.y + sway * 0.4 * (k / cv.nodes.length);
                    if (k === 0) ctx.moveTo(px, py);
                    else ctx.lineTo(px, py);
                }
                ctx.stroke();

                ctx.fillStyle = 'rgba(68, 205, 112, 0.75)';
                ctx.beginPath();
                for (let k = 1; k < cv.nodes.length; k++) {
                    const nd = cv.nodes[k];
                    const px = nd.x + sway * (k / cv.nodes.length) + nd.leafSide * 2.5;
                    const py = nd.y;
                    ctx.moveTo(px + 2.5, py);
                    ctx.ellipse(px, py, 2.8, 1.3, nd.leafSide * 0.4, 0, Math.PI * 2);
                }
                ctx.fill();
            }
        }

        for (const a of this.anchors) {
            if (a.kind === 'DRIP_EMITTER') {
                if (rollChance(cfg.dripSpawnChance, dt60) && this.drips.length < cfg.maxDrips) {
                    this.drips.push({ x: a.x, y: a.y + 4, vy: 1.5, life: 110 });
                }
                continue;
            }

            // Frustum cull offscreen flora anchors (huge reduction in per-frame draw calls)
            if (a.x < camMinX || a.x > camMaxX || a.y < camMinY || a.y > camMaxY) {
                continue;
            }

            if (a.shredCooldown > 0) a.shredCooldown -= dt60;
            if (a.shyness > 0) {
                a.shyness = Math.max(0, a.shyness - (dCfg.shyRecoveryRate ?? 0.015) * dt60);
            }

            // Interactive Ship-Wash & Thruster Blast Physics
            // Evaluate distance against the full vertical span of the plant so it stays parted while a ship is inside it!
            const dirY = a.kind === 'VINE' ? 1 : -1;
            let targetBend = 0;
            let hitByThruster = false;
            let contactT = 0.5;

            for (const s of shipList) {
                const dx = a.x - s.x;
                const clampedY = dirY > 0
                    ? Math.max(a.y, Math.min(a.y + a.length, s.y))
                    : Math.max(a.y - a.length, Math.min(a.y, s.y));
                const dy = clampedY - s.y;
                const dist = Math.hypot(dx, dy * 0.75);

                const isThrusting = Boolean(!s.isLanded && s.inputs && (s.inputs.up || s.inputs.analogUp > 0) && (s.fuel === undefined || s.fuel > 0));
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

                // Proximity Shyness when a ship roars past at high speed
                if (dCfg.enabled !== false && dCfg.shyFloraEnabled !== false && (a.kind === 'GLOW_SHROOM' || a.kind === 'CAVE_FLOWER')) {
                    const shipSpd = Math.hypot(s.vx || 0, s.vy || 0);
                    const shyRad = dCfg.shyShipRadius ?? 95;
                    if (dist < shyRad && (shipSpd > (dCfg.shySpeedThreshold ?? 4.2) || isThrusting)) {
                        a.shyness = Math.min(1.0, a.shyness + (1 - dist / shyRad) * 0.18 * dt60);
                    }
                }

                // Check if ship butt exhaust plume directly hits the flora to ignite it
                if (cfg.burnEnabled !== false && isThrusting && !a.burning && !a.charred && a.length > 0) {
                    const backX = -Math.cos(s.angle);
                    const backY = -Math.sin(s.angle);
                    const nozzleOff = cfg.burnNozzleOffset ?? 14;
                    const jetLen = cfg.burnJetLength ?? 42;
                    const jetRad = cfg.burnJetRadius ?? 22;
                    const buttX = s.x + backX * nozzleOff;
                    const buttY = s.y + backY * nozzleOff;

                    const minY = dirY > 0 ? a.y : a.y - a.length;
                    const maxY = dirY > 0 ? a.y + a.length : a.y;
                    const plumeMinY = Math.min(buttY, buttY + backY * jetLen) - jetRad;
                    const plumeMaxY = Math.max(buttY, buttY + backY * jetLen) + jetRad;
                    if (maxY < plumeMinY || minY > plumeMaxY) continue;

                    for (const step of [0.25, 0.65, 1.0]) {
                        const px = buttX + backX * jetLen * step;
                        const py = buttY + backY * jetLen * step;
                        if (level?.rawMap) {
                            const tid = level.rawMap[Math.floor(py / 32)]?.[Math.floor(px / 32)] ?? 0;
                            if (tid > 0 && tid < 0x90 && tid !== 0x20) break;
                        }
                        const cy = Math.max(minY, Math.min(maxY, py));
                        const swayAtY = a.bendAngle * 18 * (Math.abs(cy - a.y) / a.length);
                        const dotRear = ((a.x + swayAtY) - buttX) * backX + (cy - buttY) * backY;
                        if (dotRear < -4) continue;
                        if (Math.hypot(px - (a.x + swayAtY), py - cy) <= jetRad) {
                            hitByThruster = true;
                            contactT = Math.max(0.05, Math.min(0.95, Math.abs(cy - a.y) / a.length));
                            break;
                        }
                    }
                }
            }

            // Bullet Wake Disturbance & Foliage Shredding (Leaf Confetti)
            if (dCfg.enabled !== false && !a.charred && bulletList.length > 0) {
                const wakeRad = dCfg.bulletWakeRadius ?? 28;
                const minY = dirY > 0 ? a.y : a.y - a.length;
                const maxY = dirY > 0 ? a.y + a.length : a.y;
                for (let bIdx = 0; bIdx < bulletList.length; bIdx++) {
                    const b = bulletList[bIdx];
                    if (Math.abs(b.x - a.x) > wakeRad) continue;
                    if (b.y < minY - 8 || b.y > maxY + 8) continue;

                    if (dCfg.bulletWakeEnabled !== false) {
                        const push = (b.x <= a.x ? 1 : -1) * (dCfg.bulletWakeStrength ?? 0.024);
                        a.bendVel += push;
                    }

                    if (dCfg.foliageShreddingEnabled !== false && a.shredCooldown <= 0 &&
                        (a.kind === 'VINE' || a.kind === 'FERN' || a.kind === 'BROADLEAF') &&
                        this.leafConfetti.length < (dCfg.maxLeafConfetti ?? 40)) {
                        a.shredCooldown = 14;
                        for (let c = 0; c < 2; c++) {
                            this.leafConfetti.push({
                                x: b.x + (Math.random() - 0.5) * 6,
                                y: b.y + (Math.random() - 0.5) * 6,
                                vx: (Math.random() - 0.5) * 1.4,
                                vy: -0.3 + Math.random() * 0.5,
                                angle: Math.random() * Math.PI * 2,
                                spin: (Math.random() - 0.5) * 0.16,
                                life: 75 + Math.floor(Math.random() * 35),
                                maxLife: 110,
                                color: c === 0 ? '#38b862' : '#2ecc71'
                            });
                        }
                    }
                }
            }

            // Local predictive ignition (also authoritatively triggered by server flora_burn events)
            if (cfg.burnEnabled !== false && !a.burning && !a.charred) {
                if (hitByThruster) {
                    a.thrustExposureSec += dt;
                    if (a.thrustExposureSec >= (cfg.burnThrustRequired ?? 0.08)) {
                        this.igniteAnchor(a.idx, contactT);
                    }
                } else if (a.thrustExposureSec > 0) {
                    a.thrustExposureSec = Math.max(0, a.thrustExposureSec - dt * 1.5);
                }
            }

            // Advance slow bidirectional fire fronts outward from burnOriginT toward root (0) and tip (1)
            if (a.burning) {
                const spreadStep = (cfg.burnSpreadRate ?? 0.22) * dt;
                a.burnMinT = Math.max(0.0, a.burnMinT - spreadStep);
                a.burnMaxT = Math.min(1.0, a.burnMaxT + spreadStep);
                if (a.burnMinT <= 0.0 && a.burnMaxT >= 1.0) {
                    a.burning = false;
                    a.charred = true;
                }
            }

            // Emit rising bioluminescent spores from live, unburned flora
            if (cfg.sporesEnabled !== false && !this.isPointBurned(a, 0.95)) {
                if (a.kind === 'GLOW_SHROOM' || a.kind === 'CAVE_FLOWER' || (a.kind === 'VINE' && a.seed > 40)) {
                    if (rollChance(cfg.sporeSpawnChance ?? 0.012, dt60) && this.spores.length < (cfg.maxSpores ?? 55)) {
                        const tipY = a.kind === 'VINE' ? a.y + a.length : a.y - a.length;
                        const maxLife = cfg.sporeLifeTicks ?? 160;
                        this.spores.push({
                            x: a.x + (Math.random() - 0.5) * 10,
                            y: tipY,
                            vy: -(cfg.sporeRiseSpeed ?? 0.38) * (0.75 + Math.random() * 0.5),
                            phase: Math.random() * Math.PI * 2,
                            life: maxLife,
                            maxLife,
                            color: a.kind === 'CAVE_FLOWER'
                                ? ((Math.floor(a.seed) % 2 === 0) ? '#ffbe40' : '#ff6b9d')
                                : (a.kind === 'GLOW_SHROOM' ? '#00f2fe' : '#7dffaa')
                        });
                    }
                }
            }

            // Smoothly spring toward targetBend (holds open while ship is present, relaxes when ship leaves)
            const springK = targetBend !== 0 ? cfg.activeSpringK : cfg.restSpringK;
            a.bendVel += (targetBend - a.bendAngle) * springK * dt60;
            a.bendVel *= Math.pow(cfg.damping, dt60);
            a.bendAngle = Math.max(-cfg.maxBendAngle, Math.min(cfg.maxBendAngle, a.bendAngle + a.bendVel * dt60));

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

            if (a.burning) {
                this.drawBurnFronts(ctx, a, timeSec, cfg, spawnParticlesFn);
            }
        }

        // Update & draw falling subterranean water droplets
        ctx.fillStyle = 'rgba(130, 210, 255, 0.75)';
        for (let i = this.drips.length - 1; i >= 0; i--) {
            const d = this.drips[i];
            d.vy += 0.08 * dt60;
            d.y += d.vy * dt60;
            d.life -= dt60;

            // Check Ship Hull Deflection & Thruster Steam Vaporization
            let consumedByShip = false;
            if (dCfg.enabled !== false && dCfg.waterInteractionsEnabled !== false) {
                for (const s of shipList) {
                    const distToShip = Math.hypot(d.x - s.x, d.y - s.y);
                    if (distToShip < 18) {
                        if (spawnParticlesFn) spawnParticlesFn(d.x, d.y, (d.x - s.x) * 0.15, -1.2, 'rgba(155, 225, 255, 0.75)', 3, 14);
                        consumedByShip = true;
                        break;
                    }
                    const isThrusting = Boolean(s.inputs && s.inputs.up && (s.fuel === undefined || s.fuel > 0));
                    if (isThrusting && distToShip < 48) {
                        if (spawnParticlesFn) spawnParticlesFn(d.x, d.y, (Math.random() - 0.5) * 0.8, -1.4, 'rgba(235, 245, 255, 0.55)', 4, 22);
                        consumedByShip = true;
                        break;
                    }
                }
            }
            if (consumedByShip) {
                this.drips.splice(i, 1);
                continue;
            }

            // Check if droplet lands in an interactive subterranean water pool
            if (window.gfRenderer?.details?.splashWaterAt) {
                if (window.gfRenderer.details.splashWaterAt(d.x, d.y, 2.6)) {
                    if (spawnParticlesFn) spawnParticlesFn(d.x, d.y, 0, -0.7, 'rgba(0, 242, 254, 0.75)', 3, 14);
                    this.drips.splice(i, 1);
                    continue;
                }
            }

            // Check Solid Floor / Pad Hit for Puddle Ripples
            let hitFloor = d.life <= 0;
            if (!hitFloor && level?.rawMap) {
                const tx = Math.floor(d.x / 32);
                const ty = Math.floor(d.y / 32);
                const tid = level.rawMap[ty]?.[tx];
                if (tid && tid > 0 && tid < 0x90 && tid !== 0x20) {
                    hitFloor = true;
                }
            }

            if (hitFloor) {
                if (spawnParticlesFn) spawnParticlesFn(d.x, d.y, 0, -0.5, 'rgba(130, 210, 255, 0.6)', 2, 12);
                if (dCfg.enabled !== false && dCfg.waterInteractionsEnabled !== false && this.ripples.length < (dCfg.dripRippleMaxCount ?? 25)) {
                    this.ripples.push({ x: d.x, y: d.y, rx: 2.0, maxRx: 14.0, alpha: 0.65 });
                }
                this.drips.splice(i, 1);
                continue;
            }
            ctx.fillRect(d.x - 1, d.y - 3, 2, 5);
        }

        // Update & draw expanding water puddle ripples
        if (this.ripples.length > 0) {
            ctx.lineWidth = 1.2;
            for (let i = this.ripples.length - 1; i >= 0; i--) {
                const rp = this.ripples[i];
                rp.rx += 0.45 * dt60;
                rp.alpha -= 0.024 * dt60;
                if (rp.alpha <= 0 || rp.rx >= rp.maxRx) {
                    this.ripples.splice(i, 1);
                    continue;
                }
                ctx.strokeStyle = `rgba(145, 220, 255, ${rp.alpha})`;
                ctx.beginPath();
                ctx.ellipse(rp.x, rp.y, rp.rx, rp.rx * 0.28, 0, 0, Math.PI * 2);
                ctx.stroke();
            }
        }

        // Update & draw fluttering shredded leaf confetti
        if (this.leafConfetti.length > 0) {
            for (let i = this.leafConfetti.length - 1; i >= 0; i--) {
                const lf = this.leafConfetti[i];
                lf.x += (lf.vx + Math.sin(timeSec * 4.5 + i) * 0.35) * dt60;
                lf.y += lf.vy * dt60;
                lf.vy = Math.min(0.85, lf.vy + 0.015 * dt60);
                lf.vx *= Math.pow(0.97, dt60);
                lf.angle += lf.spin * dt60;
                lf.life -= dt60;
                if (lf.life <= 0) {
                    this.leafConfetti.splice(i, 1);
                    continue;
                }
                ctx.save();
                ctx.translate(lf.x, lf.y);
                ctx.rotate(lf.angle);
                ctx.globalAlpha = Math.min(1, lf.life / 25);
                ctx.fillStyle = lf.color;
                ctx.beginPath();
                ctx.ellipse(0, 0, 3.8, 1.7, 0, 0, Math.PI * 2);
                ctx.fill();
                ctx.restore();
            }
        }

        // Update & draw rising bioluminescent flora spores
        if (cfg.sporesEnabled !== false && this.spores.length > 0) {
            const sRad = cfg.sporeRadius ?? 1.7;
            const swayAmp = cfg.sporeSwayAmp ?? 0.45;
            ctx.globalCompositeOperation = 'lighter';
            for (let i = this.spores.length - 1; i >= 0; i--) {
                const sp = this.spores[i];
                sp.y += sp.vy * dt60;
                sp.x += Math.sin(timeSec * 2.2 + sp.phase) * swayAmp * dt60;
                if (dCfg.bulletWakeEnabled !== false && bulletList.length > 0) {
                    for (let bIdx = 0; bIdx < bulletList.length; bIdx++) {
                        const b = bulletList[bIdx];
                        const dx = sp.x - b.x;
                        const dy = sp.y - b.y;
                        if (Math.abs(dx) < 22 && Math.abs(dy) < 22) {
                            sp.x += (dx >= 0 ? 1.2 : -1.2);
                        }
                    }
                }
                sp.life -= dt60;
                if (sp.life <= 0) {
                    this.spores.splice(i, 1);
                    continue;
                }
                const lifeRatio = sp.life / sp.maxLife;
                const fade = lifeRatio < 0.25 ? (lifeRatio / 0.25) : (lifeRatio > 0.85 ? (1 - lifeRatio) / 0.15 : 1.0);
                ctx.globalAlpha = Math.max(0, Math.min(1, fade * 0.75));
                ctx.fillStyle = sp.color;
                ctx.beginPath();
                ctx.arc(sp.x, sp.y, sRad, 0, Math.PI * 2);
                ctx.fill();
            }
            ctx.globalAlpha = 1.0;
            ctx.globalCompositeOperation = 'source-over';
        }

        // Update & draw interactive bioluminescent firefly/spore swarms
        if (cfg.firefliesEnabled !== false && this.fireflies.length > 0) {
            const ffRadius = cfg.fireflyRadius ?? 1.8;
            const ffAlpha = cfg.fireflyAlpha ?? 0.45;
            ctx.globalCompositeOperation = 'lighter';
            for (const f of this.fireflies) {
                const host = this.anchors[f.anchorIdx];
                if (host && (host.burning || host.charred)) continue;
                const targetX = f.homeX + Math.sin(timeSec * 1.6 + f.phase) * 18;
                const targetY = f.homeY + Math.cos(timeSec * 1.3 + f.phase * 1.7) * 14;
                f.vx += (targetX - f.x) * 0.025 * dt60;
                f.vy += (targetY - f.y) * 0.025 * dt60;

                for (const s of shipList) {
                    const dx = f.x - s.x;
                    const dy = f.y - s.y;
                    const d = Math.hypot(dx, dy);
                    if (d < 110 && d > 1) {
                        const push = ((110 - d) / 110) * (s.inputs?.up ? 1.8 : 0.9);
                        f.vx += (dx / d) * push * dt60;
                        f.vy += (dy / d) * push * dt60;
                    }
                }

                f.vx *= Math.pow(0.88, dt60);
                f.vy *= Math.pow(0.88, dt60);
                f.x += f.vx * dt60;
                f.y += f.vy * dt60;

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
        ctx.lineCap = 'round';

        let prevX = a.x;
        let prevY = a.y;
        let tipX = a.x;
        let tipY = a.y;
        const charColor = cfg.burnCharColor || '#181512';
        const charScale = cfg.burnCharWidthScale ?? 0.68;

        if (!a.burning && !a.charred) {
            // Fast path: 1 batched stroke for the entire unburned vine instead of 7 separate strokes!
            ctx.strokeStyle = '#2ea355';
            ctx.lineWidth = 4.0;
            ctx.beginPath();
            ctx.moveTo(prevX, prevY);
            const washOffset = a.bendAngle * a.length * cfg.vineWashScale;
            for (let s = 1; s <= segments; s++) {
                const t = s / segments;
                const wind = Math.sin(timeSec * cfg.windSpeed + a.seed + t * 2.0) * cfg.vineWindAmp;
                tipX = a.x + (wind + washOffset) * (t * t);
                tipY = a.y + a.length * t;
                ctx.lineTo(tipX, tipY);
            }
            ctx.stroke();
        } else {
            for (let s = 1; s <= segments; s++) {
                const t0 = (s - 1) / segments;
                const t = s / segments;
                const segBurned = this.isIntervalBurned(a, t0, t);
                const windAmp = segBurned ? cfg.vineWindAmp * 0.25 : cfg.vineWindAmp;
                const wind = Math.sin(timeSec * cfg.windSpeed + a.seed + t * 2.0) * windAmp;
                const washOffset = a.bendAngle * a.length * cfg.vineWashScale;
                tipX = a.x + (wind + washOffset) * (t * t);
                tipY = a.y + a.length * t;

                ctx.strokeStyle = segBurned ? charColor : '#2ea355';
                ctx.lineWidth = segBurned ? (4.0 * charScale) : 4.0;
                ctx.beginPath();
                ctx.moveTo(prevX, prevY);
                ctx.lineTo(tipX, tipY);
                ctx.stroke();

                prevX = tipX;
                prevY = tipY;
            }
        }

        // Secondary side-leaf nodes along the vine (burned off where fire has passed)
        ctx.fillStyle = '#38b862';
        ctx.beginPath();
        for (let s = 2; s < segments; s += 2) {
            const t = s / segments;
            if (this.isPointBurned(a, t)) continue;
            const wind = Math.sin(timeSec * cfg.windSpeed + a.seed + t * 2.0) * cfg.vineWindAmp;
            const washOffset = a.bendAngle * a.length * cfg.vineWashScale;
            const lx = a.x + (wind + washOffset) * (t * t);
            const ly = a.y + a.length * t;
            const side = (s % 4 === 0 ? 1 : -1) * 7;
            ctx.moveTo(lx + side + 6, ly);
            ctx.ellipse(lx + side, ly, 6, 2.5, side > 0 ? 0.4 : -0.4, 0, Math.PI * 2);
        }
        ctx.fill();

        // Hanging blossoms along mature vines
        if (cfg.vineBlossomsEnabled !== false && a.seed > 52 && !this.isPointBurned(a, 0.55)) {
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

        // Bioluminescent spore tip with soft local halo (extinguished when tip is burned)
        if (!this.isPointBurned(a, 0.98)) {
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
    }

    drawFern(ctx, a, timeSec, cfg) {
        const windAmp = a.charred ? cfg.fernWindAmp * 0.25 : cfg.fernWindAmp;
        const sway = Math.sin(timeSec * (cfg.windSpeed * 1.25) + a.seed) * windAmp + a.bendAngle * cfg.fernWashScale;
        const charColor = cfg.burnCharColor || '#181512';
        const charScale = cfg.burnCharWidthScale ?? 0.68;
        ctx.lineCap = 'round';

        for (const spread of [-0.75, -0.35, 0, 0.35, 0.75]) {
            const frondLen = a.length * (1.0 - Math.abs(spread) * 0.35);
            const ctrlX = a.x + spread * 22 + sway * 0.5;
            const ctrlY = a.y - frondLen * 0.6;
            const endX = a.x + spread * 38 + sway;
            const endY = a.y - frondLen;

            // Draw frond rachis in 5 segments so fire burns outward along the stem leaving black skeleton
            let px = a.x;
            let py = a.y;
            for (let s = 1; s <= 5; s++) {
                const t0 = (s - 1) / 5;
                const t = s / 5;
                const omt = 1 - t;
                const nx = omt * omt * a.x + 2 * omt * t * ctrlX + t * t * endX;
                const ny = omt * omt * a.y + 2 * omt * t * ctrlY + t * t * endY;
                const segBurned = this.isIntervalBurned(a, t0, t);
                ctx.strokeStyle = segBurned ? charColor : '#38b862';
                ctx.lineWidth = segBurned ? (3.2 * charScale) : 3.2;
                ctx.beginPath();
                ctx.moveTo(px, py);
                ctx.lineTo(nx, ny);
                ctx.stroke();
                px = nx;
                py = ny;
            }

            // Serrated pinnae leaflets along each frond (disintegrate where burned)
            ctx.fillStyle = '#4cd97b';
            for (let p = 1; p <= 4; p++) {
                const pt = p / 5;
                if (this.isPointBurned(a, pt)) continue;
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
        const windAmp = a.charred ? cfg.shroomWindAmp * 0.25 : cfg.shroomWindAmp;
        const sway = Math.sin(timeSec * cfg.windSpeed + a.seed) * windAmp + a.bendAngle * cfg.shroomWashScale;
        const shyFactor = 1.0 - (a.shyness || 0) * 0.32;
        const effLen = a.length * shyFactor;
        const tipX = a.x + sway;
        const tipY = a.y - effLen;
        const pulse = (0.78 + 0.22 * Math.sin(timeSec * 3.2 + a.seed)) * (1.0 - (a.shyness || 0) * 0.65);
        const capBurned = this.isPointBurned(a, 0.92);
        const charColor = cfg.burnCharColor || '#181512';
        const charScale = cfg.burnCharWidthScale ?? 0.68;

        // Outer bioluminescent aura (uses pre-baked sprite instead of per-frame createRadialGradient!)
        if (!capBurned && cfg.localHaloEnabled !== false) {
            const haloR = (cfg.shroomHaloRadius ?? 16.0) * pulse;
            const haloA = (cfg.shroomHaloAlpha ?? 0.22) * (1.0 - (a.shyness || 0) * 0.65);
            const spr = this.getHaloSprite('0, 242, 254');
            if (spr) {
                ctx.save();
                ctx.globalAlpha = haloA;
                ctx.drawImage(spr, tipX - haloR, tipY - haloR, haloR * 2, haloR * 2);
                ctx.restore();
            }
        }

        // Segmented stem so fire chars progressively along the stalk
        const ctrlX = a.x + sway * 0.4;
        const ctrlY = a.y - effLen * 0.5;
        let px = a.x;
        let py = a.y;
        for (let s = 1; s <= 5; s++) {
            const t0 = (s - 1) / 5;
            const t = s / 5;
            const omt = 1 - t;
            const nx = omt * omt * a.x + 2 * omt * t * ctrlX + t * t * tipX;
            const ny = omt * omt * a.y + 2 * omt * t * ctrlY + t * t * tipY;
            const segBurned = this.isIntervalBurned(a, t0, t);
            ctx.strokeStyle = segBurned ? charColor : '#70a1ff';
            ctx.lineWidth = segBurned ? (3.5 * charScale) : 3.5;
            ctx.beginPath();
            ctx.moveTo(px, py);
            ctx.lineTo(nx, ny);
            ctx.stroke();
            px = nx;
            py = ny;
        }

        // Gill underside shadow
        ctx.fillStyle = capBurned ? '#0d0b0a' : '#1b3b6f';
        ctx.beginPath();
        ctx.ellipse(tipX, tipY + 1, capBurned ? 8.5 : 11.5, capBurned ? 2.5 : 4.0, 0, 0, Math.PI * 2);
        ctx.fill();

        // Glowing umbrella cap
        ctx.fillStyle = capBurned ? charColor : '#00f2fe';
        ctx.beginPath();
        ctx.arc(tipX, tipY, capBurned ? 8.5 : 11.5, Math.PI, 0);
        ctx.fill();

        // Inner bright core spots
        if (!capBurned) {
            ctx.fillStyle = '#d6ffff';
            ctx.beginPath();
            ctx.arc(tipX - 4, tipY - 4, 2.0, 0, Math.PI * 2);
            ctx.arc(tipX + 3, tipY - 6, 1.6, 0, Math.PI * 2);
            ctx.fill();
        }
    }

    drawBroadleaf(ctx, a, timeSec, cfg) {
        const windAmp = a.charred ? cfg.fernWindAmp * 0.25 : cfg.fernWindAmp;
        const sway = Math.sin(timeSec * cfg.windSpeed + a.seed) * windAmp + a.bendAngle * cfg.fernWashScale;
        const charColor = cfg.burnCharColor || '#181512';
        const charScale = cfg.burnCharWidthScale ?? 0.68;
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
            const leafBurned = this.isPointBurned(a, 0.55);

            ctx.save();
            ctx.translate(midX, midY);
            ctx.rotate(lAngle);

            if (!leafBurned) {
                ctx.fillStyle = lf.color;
                ctx.beginPath();
                ctx.ellipse(0, 0, len * 0.52, len * 0.24, 0, 0, Math.PI * 2);
                ctx.fill();
            }

            // Main central rib structure remains as black skeleton when leaf blades burn away
            ctx.strokeStyle = leafBurned ? charColor : lf.vein;
            ctx.lineWidth = leafBurned ? (2.6 * charScale) : 1.6;
            ctx.beginPath();
            ctx.moveTo(-len * 0.45, 0);
            ctx.lineTo(len * 0.42, 0);
            ctx.stroke();
            ctx.restore();
        }
    }

    drawCaveFlower(ctx, a, timeSec, cfg) {
        const windAmp = a.charred ? cfg.shroomWindAmp * 0.25 : cfg.shroomWindAmp;
        const sway = Math.sin(timeSec * cfg.windSpeed + a.seed) * windAmp + a.bendAngle * cfg.shroomWashScale;
        const shyFactor = 1.0 - (a.shyness || 0) * 0.28;
        const effLen = a.length * shyFactor;
        const tipX = a.x + sway;
        const tipY = a.y - effLen;
        const pulse = (0.8 + 0.2 * Math.sin(timeSec * 3.8 + a.seed)) * (1.0 - (a.shyness || 0) * 0.65);
        const headBurned = this.isPointBurned(a, 0.92);
        const charColor = cfg.burnCharColor || '#181512';
        const charScale = cfg.burnCharWidthScale ?? 0.68;

        // Segmented stem
        const ctrlX = a.x + sway * 0.35;
        const ctrlY = a.y - effLen * 0.5;
        let px = a.x;
        let py = a.y;
        for (let s = 1; s <= 5; s++) {
            const t0 = (s - 1) / 5;
            const t = s / 5;
            const omt = 1 - t;
            const nx = omt * omt * a.x + 2 * omt * t * ctrlX + t * t * tipX;
            const ny = omt * omt * a.y + 2 * omt * t * ctrlY + t * t * tipY;
            const segBurned = this.isIntervalBurned(a, t0, t);
            ctx.strokeStyle = segBurned ? charColor : '#2ecc71';
            ctx.lineWidth = segBurned ? (3.0 * charScale) : 3.0;
            ctx.beginPath();
            ctx.moveTo(px, py);
            ctx.lineTo(nx, ny);
            ctx.stroke();
            px = nx;
            py = ny;
        }

        if (headBurned) {
            // Charred calyx skeleton at tip
            ctx.fillStyle = charColor;
            ctx.beginPath();
            ctx.arc(tipX, tipY, 3.2, 0, Math.PI * 2);
            ctx.fill();
            return;
        }

        // Local blossom glow halo
        const colorType = Math.floor(a.seed) % 4;
        let petalColor, coreColor, glowRgb;
        if (colorType === 0) { petalColor = '#ffbe40'; coreColor = '#fff6b0'; glowRgb = '255, 190, 64'; }
        else if (colorType === 1) { petalColor = '#ff6b9d'; coreColor = '#ffe0f0'; glowRgb = '255, 107, 157'; }
        else if (colorType === 2) { petalColor = '#4facfe'; coreColor = '#e0f7fa'; glowRgb = '79, 172, 254'; }
        else { petalColor = '#b57edd'; coreColor = '#f3e5f5'; glowRgb = '181, 126, 221'; }

        if (cfg.localHaloEnabled !== false) {
            const haloR = (cfg.flowerHaloRadius ?? 14.0) * pulse;
            const haloA = (cfg.flowerHaloAlpha ?? 0.20) * (1.0 - (a.shyness || 0) * 0.65);
            const spr = this.getHaloSprite(glowRgb);
            if (spr) {
                ctx.save();
                ctx.globalAlpha = haloA;
                ctx.drawImage(spr, tipX - haloR, tipY - haloR, haloR * 2, haloR * 2);
                ctx.restore();
            }
        }

        // Cupped bioluminescent petals (contract inward when shy!)
        const petalReach = 5.5 * (1.0 - (a.shyness || 0) * 0.45);
        ctx.fillStyle = petalColor;
        for (let p = 0; p < 5; p++) {
            const ang = (p / 5) * Math.PI * 2 + timeSec * 0.25;
            ctx.beginPath();
            ctx.ellipse(tipX + Math.cos(ang) * petalReach, tipY + Math.sin(ang) * petalReach, 6.2 * shyFactor, 3.6 * shyFactor, ang, 0, Math.PI * 2);
            ctx.fill();
        }

        // Luminous stamen core
        ctx.fillStyle = coreColor;
        ctx.beginPath();
        ctx.arc(tipX, tipY, 3.8, 0, Math.PI * 2);
        ctx.fill();
    }

    drawBurnFronts(ctx, a, timeSec, cfg, spawnParticlesFn) {
        const dirY = a.kind === 'VINE' ? 1 : -1;
        const flameLen = cfg.burnFlameLength ?? 10.0;
        const fronts = [];
        if (a.burnMinT > 0.02) fronts.push(a.burnMinT);
        if (a.burnMaxT < 0.98) fronts.push(a.burnMaxT);

        for (const ft of fronts) {
            const fx = a.x + (a.bendAngle * 16) * ft + Math.sin(timeSec * 14 + ft * 9) * 1.5;
            const fy = a.y + dirY * a.length * ft;
            const flicker = 0.75 + 0.25 * Math.sin(timeSec * 22 + a.seed + ft * 12);

            // Outer orange-red ember tongue
            ctx.fillStyle = 'rgba(255, 95, 25, 0.85)';
            ctx.beginPath();
            ctx.arc(fx, fy, flameLen * 0.45 * flicker, 0, Math.PI * 2);
            ctx.fill();

            // Rising flame tip
            ctx.beginPath();
            ctx.moveTo(fx - flameLen * 0.35, fy);
            ctx.lineTo(fx, fy - flameLen * flicker);
            ctx.lineTo(fx + flameLen * 0.35, fy);
            ctx.closePath();
            ctx.fill();

            // Hot yellow-white core
            ctx.fillStyle = '#fff3a0';
            ctx.beginPath();
            ctx.arc(fx, fy - 1, flameLen * 0.22 * flicker, 0, Math.PI * 2);
            ctx.fill();

            if (spawnParticlesFn && rollChance(0.18, 1.0)) {
                spawnParticlesFn(fx, fy, (Math.random() - 0.5) * 0.4, -0.6 - Math.random() * 0.5, '#ff6b1a', 1, 18);
            }
        }
    }
}
