import { RENDER_CONFIG } from './RenderConfig.js';

const METAL_TILES = new Set([
    0x15, 0x29, 0x1B, 0x1C, 0x1D, 0x1E, 0x1F, 0x21, 0x24, 0x25, 0x26, 0x27, 0x28,
    0x67, 0x68, 0x69, 0x6A, 0x6B, 0x6C, 0x6D, 0x6E, 0x6F, 0x70, 0x71, 0x72,
    0x77, 0x78, 0x79, 0x7A, 0x7B, 0x7C, 0x86, 0x87, 0x88, 0x89, 0x8A, 0x8B, 0x8C, 0x8F
]);

const DEFAULT_GROUND_BASIN_TILES = [
    0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0A, 0x0B, 0x0C, 0x0D, 0x0F,
    0x11, 0x12, 0x14, 0x16, 0x17, 0x19, 0x1A, 0x22, 0x23,
    0x5E, 0x5F, 0x60, 0x61, 0x62, 0x63, 0x64, 0x65, 0x66,
    0x73, 0x74, 0x76, 0x84, 0x85
];

const DEFAULT_TREE_BASIN_TILES = [
    0x2A, 0x2B, 0x2C, 0x2D, 0x2E, 0x2F, 0x30, 0x31,
    0x34, 0x35, 0x36, 0x37, 0x38, 0x39, 0x3A
];

export class MicroDetailsLayer {
    constructor() {
        this.builtForLevel = null;
        this.heatSpots = [];
        this.sparks = [];
        this.smokePuffs = [];
        this.crashPlumes = [];
        this.prefabScorches = [];
        this.gravStreams = [];
        this.crystals = [];
        this.waterPools = [];
        this.stalactites = [];
        this.fallingShards = [];
        this.shockwaves = [];
        this.shipPrev = new Map();
        this.turretPrevCooldown = new Map();
    }

    initLevel(level) {
        this.builtForLevel = level;
        this.heatSpots = [];
        this.sparks = [];
        this.smokePuffs = [];
        this.crashPlumes = [];
        this.prefabScorches = [];
        this.gravStreams = [];
        this.crystals = [];
        this.waterPools = [];
        this.stalactites = [];
        this.fallingShards = [];
        this.shockwaves = [];
        this.shipPrev.clear();
        this.turretPrevCooldown.clear();

        if (!level) return;
        const cfg = RENDER_CONFIG.details || {};

        // 1. Seed Gravity Well Stream Emitters (0xCC - 0xCF)
        if (level.rawMap) {
            for (let y = 0; y < level.rawMap.length; y++) {
                for (let x = 0; x < level.rawMap[y].length; x++) {
                    const t = level.rawMap[y][x];
                    if (t >= 0xCC && t <= 0xCF) {
                        // IMPNOTE 5: Respect transposed force directions (0xCC=Right, 0xCD=Down, 0xCE=Left, 0xCF=Up)
                        const vx = t === 0xCC ? 1 : (t === 0xCE ? -1 : 0);
                        const vy = t === 0xCD ? 1 : (t === 0xCF ? -1 : 0);
                        this.gravStreams.push({
                            tileX: x,
                            tileY: y,
                            tileId: t,
                            x: x * 32 + 16,
                            y: y * 32 + 16,
                            vx,
                            vy,
                            motes: Array.from({ length: cfg.gravityMotesPerTile ?? 2 }, () => ({
                                ox: (Math.random() - 0.5) * 28,
                                oy: (Math.random() - 0.5) * 28,
                                phase: Math.random()
                            }))
                        });
                    }
                }
            }
        }

        // 2. Seed Crystalline Glint Specs along Rock Contours
        if (level.walls) {
            const stride = cfg.crystalVertexStride ?? 19;
            for (const wall of level.walls) {
                for (let i = 0; i < wall.length; i += stride) {
                    const pt = wall[i];
                    const h = Math.abs(Math.sin(pt.x * 12.9898 + pt.y * 78.233) * 43758.5453) % 1;
                    if (h < 0.45) {
                        this.crystals.push({
                            x: pt.x,
                            y: pt.y,
                            phase: h * Math.PI * 2,
                            color: h < 0.2 ? '#a8ecff' : '#ffe6a3'
                        });
                    }
                }
            }
        }

        // 3. Seed Interactive Subterranean Water Pools in Floor Basins
        if (cfg.waterPoolsEnabled !== false && level.rawMap) {
            this.initWaterPools(level, cfg);
        }

        // 4. Seed Atmospheric Hanging Ceiling Stalactites
        const isRaceLevel = level.rawMap && level.rawMap.some(row => row.some(t => t >= 0xDA && t <= 0xE1));
        if (cfg.stalactitesEnabled !== false && (!isRaceLevel || cfg.stalactiteInRacesEnabled === true) && level.walls && level.rawMap) {
            this.initHangingStalactites(level, cfg);
        }
    }

    initWaterPools(level, cfg) {
        const map = level.rawMap;
        const h = map.length;
        const w = h > 0 ? map[0].length : 0;
        const maxPools = cfg.maxWaterPools ?? 6;
        const minSpan = cfg.waterMinSpanTiles ?? 2;
        const maxSpan = cfg.waterMaxSpanTiles ?? 10;
        const minBankRise = cfg.waterMinBankRiseTiles ?? 1;
        const rarityChance = cfg.waterRarityChance ?? 0.85;
        const depthPx = cfg.waterDepthPx ?? 18;
        const used = new Set();

        const allowedSet = new Set(cfg.waterAllowedGroundTiles || DEFAULT_GROUND_BASIN_TILES);
        if (cfg.waterAllowTreeBases !== false) {
            for (const tid of (cfg.waterAllowedTreeTiles || DEFAULT_TREE_BASIN_TILES)) {
                allowedSet.add(tid);
            }
        }

        const isValidBasinTile = (tx, ty) => {
            if (ty < 0 || ty >= h || tx < 0 || tx >= w) return false;
            const t = map[ty][tx];
            return allowedSet.has(t);
        };

        const hasDryEntityOrPadAt = (tx, ty) => {
            const t = map[ty]?.[tx] ?? 0;
            if (METAL_TILES.has(t)) return true;
            if (t >= 0x3B && t <= 0x4E) return true; // Race checkpoints
            if (t >= 0x7D && t <= 0x83) return true; // Antenna masts
            if (t >= 0xAE) return true;              // Turrets, pickups, spawns, triggers
            return false;
        };

        // Verify that a rock/tree bank on the left or right rises above the water surface and has a solid bottom corner
        const hasHighBank = (bankX, basinY) => {
            if (!isValidBasinTile(bankX, basinY + 1)) return false;
            for (let r = 0; r < Math.ceil(minBankRise); r++) {
                if (!isValidBasinTile(bankX, basinY - r)) return false;
            }
            return true;
        };

        const isSolidOrBottom = (tx, ty) => {
            if (ty >= h) return true;
            const t = map[ty]?.[tx] ?? 0;
            return t !== 0;
        };

        let seed = 8191;
        const rng = () => {
            seed = (seed * 16807) % 2147483647;
            return (seed - 1) / 2147483646;
        };

        // Scan bottom-up for enclosed natural ground / tree-root basins
        for (let y = h - 2; y >= 2 && this.waterPools.length < maxPools; y--) {
            for (let x = 1; x < w - 2 && this.waterPools.length < maxPools; x++) {
                if (used.has(`${x},${y}`)) continue;
                if (map[y][x] !== 0 || !isValidBasinTile(x, y + 1) || !hasHighBank(x - 1, y)) continue;

                let span = 0;
                let valid = true;
                while (x + span < w - 1 && map[y][x + span] === 0 && span <= maxSpan) {
                    const cx = x + span;
                    if (!isValidBasinTile(cx, y + 1) || hasDryEntityOrPadAt(cx, y) || hasDryEntityOrPadAt(cx, y - 1) || !isSolidOrBottom(cx, y + 2)) {
                        valid = false;
                        break;
                    }
                    span++;
                }

                if (valid && span >= minSpan && span <= maxSpan && hasHighBank(x + span, y)) {
                    for (let dy = -2; dy <= 2; dy++) {
                        for (let k = -1; k <= span; k++) used.add(`${x + k},${y + dy}`);
                    }
                    if (rng() > rarityChance) continue;

                    const px = x * 32;
                    const pw = span * 32;
                    const surfaceY = (y + 1) * 32 - depthPx;
                    const nodeCount = Math.max(8, Math.min(24, span * 3));
                    this.waterPools.push({
                        x: px,
                        y: surfaceY,
                        w: pw,
                        bottomY: (y + 1) * 32,
                        nodes: new Float32Array(nodeCount),
                        vels: new Float32Array(nodeCount),
                        nodeCount
                    });
                }
            }
        }
    }

    initHangingStalactites(level, cfg) {
        const maxCount = cfg.maxHangingStalactites ?? 55;
        const minLen = cfg.stalactiteMinLength ?? 22;
        const maxLen = cfg.stalactiteMaxLength ?? 48;
        const minHW = cfg.stalactiteMinHalfWidth ?? 4.2;
        const maxHW = cfg.stalactiteMaxHalfWidth ?? 8.0;
        const map = level.rawMap;
        let seed = 7319;
        const rng = () => {
            seed = (seed * 16807) % 2147483647;
            return (seed - 1) / 2147483646;
        };

        for (const wall of level.walls) {
            const n = wall.length;
            if (n < 6) continue;
            for (let i = 0; i < n - 1 && this.stalactites.length < maxCount; i += 4) {
                const p1 = wall[i];
                const p2 = wall[i + 1];
                const dx = p2.x - p1.x;
                const dy = p2.y - p1.y;
                const segLen = Math.hypot(dx, dy);
                if (segLen < 2.5) continue;

                // Outward normal into cavern air: (dy, -dx) / segLen. Ceiling has ny > 0.72 (pointing down)
                const ny = -dx / segLen;
                if (ny < 0.72) continue;
                if (rng() > 0.30) continue;

                const wx = (p1.x + p2.x) * 0.5;
                const wy = (p1.y + p2.y) * 0.5;
                const tx = Math.floor(wx / 32);
                const ty = Math.floor((wy + 20) / 32);
                const belowTid = map[ty]?.[tx] ?? 1;
                if (belowTid !== 0) continue;

                // Avoid overlapping closely with previously placed stalactites
                if (this.stalactites.some(s => Math.hypot(s.x - wx, s.y - wy) < 26)) continue;

                const length = minLen + rng() * Math.max(2, maxLen - minLen);
                const halfW = minHW + rng() * Math.max(0.5, maxHW - minHW);
                this.stalactites.push({
                    x: wx,
                    y: wy,
                    length,
                    halfW,
                    intact: true,
                    shake: 0,
                    skew: (rng() - 0.5) * 3.2
                });
            }
        }
    }

    splashWaterAt(x, y, impulse = 3.5) {
        for (const pool of this.waterPools) {
            if (x >= pool.x && x <= pool.x + pool.w && Math.abs(y - pool.y) <= 22) {
                const idx = Math.floor(((x - pool.x) / pool.w) * (pool.nodeCount - 1));
                for (let k = -2; k <= 2; k++) {
                    const ni = idx + k;
                    if (ni >= 0 && ni < pool.nodeCount) {
                        pool.vels[ni] += impulse * (1 - Math.abs(k) * 0.3);
                    }
                }
                return true;
            }
        }
        return false;
    }

    shatterStalactite(st, impactVx = 0) {
        if (!st || !st.intact) return;
        st.intact = false;
        this.fallingShards.push({
            x: st.x,
            y: st.y + st.length * 0.45,
            vx: impactVx * 0.15 + (Math.random() - 0.5) * 0.9,
            vy: 0.6,
            angle: 0,
            spin: (Math.random() - 0.5) * 0.14,
            length: st.length * 0.78,
            halfW: st.halfW * 0.85,
            life: 180
        });
        for (let i = 0; i < 7 && this.sparks.length < 110; i++) {
            this.sparks.push({
                x: st.x + (Math.random() - 0.5) * 8,
                y: st.y + 8 + Math.random() * 12,
                vx: (Math.random() - 0.5) * 2.2,
                vy: 0.4 + Math.random() * 1.8,
                gravity: 0.08,
                life: 24 + Math.floor(Math.random() * 16),
                maxLife: 40,
                size: 1.8 + Math.random() * 1.6,
                color: i % 2 === 0 ? '#b98250' : '#5c3c26'
            });
        }
    }

    onBulletImpact(x, y, level, rockLayer, floraLayer) {
        const cfg = RENDER_CONFIG.details;
        if (!cfg || !cfg.enabled) return false;

        if (floraLayer && cfg.shyFloraEnabled !== false) {
            floraLayer.triggerShock(x, y, cfg.shyBulletRadius ?? 85, 0.85);
        }

        // Check if bullet impacted or grazed a hanging ceiling stalactite
        if (cfg.stalactiteShatterEnabled !== false && this.stalactites.length > 0) {
            for (const st of this.stalactites) {
                if (!st.intact) continue;
                const dist = Math.hypot(x - st.x, y - (st.y + st.length * 0.5));
                if (dist < 22) {
                    this.shatterStalactite(st, 0);
                } else if (dist < 95) {
                    st.shake = Math.min(1.0, st.shake + (1 - dist / 95) * 0.75);
                    if (this.sparks.length < (cfg.maxSparks ?? 90)) {
                        this.sparks.push({
                            x: st.x + (Math.random() - 0.5) * 6,
                            y: st.y + st.length * 0.7,
                            vx: (Math.random() - 0.5) * 0.4,
                            vy: 0.6 + Math.random() * 0.9,
                            gravity: 0.04,
                            life: 28,
                            maxLife: 28,
                            size: 1.5,
                            color: 'rgba(185, 130, 80, 0.75)'
                        });
                    }
                }
            }
        }

        // Check if bullet splashed into a water pool
        if (this.splashWaterAt(x, y, 4.5)) {
            for (let i = 0; i < 5 && this.sparks.length < (cfg.maxSparks ?? 90); i++) {
                this.sparks.push({
                    x: x + (Math.random() - 0.5) * 6,
                    y,
                    vx: (Math.random() - 0.5) * 1.8,
                    vy: -1.4 - Math.random() * 1.6,
                    gravity: 0.09,
                    life: 20,
                    maxLife: 20,
                    size: 1.9,
                    color: 'rgba(110, 235, 255, 0.85)'
                });
            }
        }

        if (cfg.bulletImpactsEnabled === false) return false;

        const tx = Math.floor(x / 32);
        const ty = Math.floor(y / 32);
        const tid = level?.rawMap?.[ty]?.[tx] ?? 0;

        // Check nearby 3x3 for solid or metal surface context
        let isMetal = METAL_TILES.has(tid) || (tid >= 0xAE && tid <= 0xBC);
        let isSolid = isMetal || tid > 0;
        if (!isSolid && level?.rawMap) {
            for (let dy = -1; dy <= 1; dy++) {
                for (let dx = -1; dx <= 1; dx++) {
                    const nTid = level.rawMap[ty + dy]?.[tx + dx] ?? 0;
                    if (METAL_TILES.has(nTid) || (nTid >= 0xAE && nTid <= 0xBC)) isMetal = true;
                    if (nTid > 0 && nTid < 0x90) isSolid = true;
                }
            }
        }

        const count = cfg.ricochetSparkCount ?? 6;
        for (let i = 0; i < count && this.sparks.length < (cfg.maxSparks ?? 90); i++) {
            const ang = Math.random() * Math.PI * 2;
            const spd = (1.2 + Math.random() * 2.8) * (isMetal ? 1.25 : 0.9);
            this.sparks.push({
                x,
                y,
                vx: Math.cos(ang) * spd,
                vy: Math.sin(ang) * spd - 0.6,
                gravity: isMetal ? 0.06 : 0.11,
                life: 14 + Math.floor(Math.random() * 14),
                maxLife: 28,
                size: isMetal ? 1.6 : 2.1,
                color: isMetal
                    ? (i % 2 === 0 ? '#dff9ff' : '#4facfe')
                    : (i % 3 === 0 ? '#ffbe40' : (i % 3 === 1 ? '#ff6b2b' : '#6e4e37'))
            });
        }

        if (!isMetal && isSolid && rockLayer && cfg.bulletScorchMarksEnabled !== false) {
            rockLayer.stampScorch(x, y, 4.5, 0.38);
        }
        return true;
    }

    onExplosion(x, y, vx, vy, level, rockLayer, floraLayer, scale = 1.0) {
        const cfg = RENDER_CONFIG.details;
        if (!cfg || !cfg.enabled || cfg.crashStainsEnabled === false) return;

        // Lead slightly along impact velocity so high-speed crashes stain deep into the wall they hit
        const impactX = x + (vx || 0) * 1.5;
        const impactY = y + (vy || 0) * 1.5;
        const radius = (cfg.crashStainRadius ?? 38) * scale;
        const alpha = cfg.crashStainAlpha ?? 0.72;
        const rays = Math.round((cfg.crashRayCount ?? 14) * scale);

        // 1. Stamp permanent blast soot onto RockLayer offscreen cache (zero ongoing frame cost)
        if (rockLayer) {
            rockLayer.stampBlastCrater(impactX, impactY, radius, alpha, rays);
        }

        // 2. If crash overlaps a Prefab (Pad, Teal Brick, Base Structure), record a clipped decal
        const prefabs = level?.highRes?.prefabs || [];
        for (const p of prefabs) {
            if (p.kind === 'RACE_MARKER') continue;
            if (impactX + radius > p.x && impactX - radius < p.x + p.w &&
                impactY + radius > p.y && impactY - radius < p.y + p.h) {
                if (this.prefabScorches.length >= (cfg.maxPrefabScorches ?? 40)) {
                    this.prefabScorches.shift();
                }
                this.prefabScorches.push({
                    x: impactX,
                    y: impactY,
                    r: radius * 0.85,
                    alpha: alpha * 0.85,
                    clipX: p.x,
                    clipY: p.y,
                    clipW: p.w,
                    clipH: p.h
                });
            }
        }

        // 3. Seed glowing cherry-orange cooling embers on surrounding solid tiles
        for (let i = 0; i < 5 && this.heatSpots.length < (cfg.maxHeatSpots ?? 28); i++) {
            const ang = Math.random() * Math.PI * 2;
            const dist = Math.random() * (radius * 0.55);
            const hx = impactX + Math.cos(ang) * dist;
            const hy = impactY + Math.sin(ang) * dist;
            const tx = Math.floor(hx / 32);
            const ty = Math.floor(hy / 32);
            const tid = level?.rawMap?.[ty]?.[tx];
            if (tid && tid > 0 && tid < 0x90 && tid !== 0x20) {
                this.heatSpots.push({ x: hx, y: hy, heat: 0.75 + Math.random() * 0.25 });
            }
        }

        // 4. Instantly char or ignite flora caught in the fireball
        if (floraLayer && typeof floraLayer.charInRadius === 'function') {
            floraLayer.charInRadius(impactX, impactY, (cfg.crashFloraCharRadius ?? 68) * scale);
        }

        // 4.5. Spawn High-Visibility Supersonic Shockwave Condensation Ring & Shatter Nearby Stalactites
        if (cfg.shockwaveRingsEnabled !== false) {
            const maxR = (cfg.shockwaveMaxRadius ?? 280) * scale;
            const maxLife = Math.max(18, Math.round((cfg.shockwaveDurationTicks ?? 38) * scale));
            if (this.shockwaves.length >= 6) this.shockwaves.shift();
            this.shockwaves.push({
                x: impactX,
                y: impactY,
                r: 12,
                prevR: 0,
                maxR,
                life: 0,
                maxLife,
                alpha: 0.95
            });
        }

        if (cfg.stalactitesEnabled !== false && cfg.stalactiteShatterEnabled !== false && this.stalactites.length > 0) {
            for (const st of this.stalactites) {
                if (!st.intact) continue;
                const d = Math.hypot(st.x - impactX, (st.y + st.length * 0.5) - impactY);
                if (d < 135 * scale) {
                    this.shatterStalactite(st, (st.x - impactX) * 0.08);
                } else if (d < 280 * scale) {
                    st.shake = 1.0;
                }
            }
        }

        for (const pool of this.waterPools) {
            const cx = Math.max(pool.x, Math.min(pool.x + pool.w, impactX));
            const d = Math.hypot(cx - impactX, pool.y - impactY);
            if (d < 180 * scale) {
                this.splashWaterAt(cx, pool.y, 7.5 * (1 - d / (180 * scale)));
            }
        }

        // 5. Spawn a lingering dark smoke plume emitter if the explosion touched a wall, floor, or prefab
        if (cfg.crashSmokeEnabled !== false) {
            let nearSurface = false;
            if (level?.rawMap) {
                const cx = Math.floor(impactX / 32);
                const cy = Math.floor(impactY / 32);
                for (let dy = -1; dy <= 1 && !nearSurface; dy++) {
                    for (let dx = -1; dx <= 1; dx++) {
                        const tid = level.rawMap[cy + dy]?.[cx + dx];
                        if (tid && tid > 0 && tid < 0x90 && tid !== 0x20) {
                            nearSurface = true;
                            break;
                        }
                    }
                }
            }
            if (nearSurface) {
                if (this.crashPlumes.length >= (cfg.maxCrashPlumes ?? 12)) {
                    this.crashPlumes.shift();
                }
                const duration = Math.round((cfg.crashSmokeDurationTicks ?? 210) * scale);
                this.crashPlumes.push({
                    x: impactX,
                    y: impactY,
                    life: duration,
                    maxLife: duration,
                    scale
                });
            }
        }
    }

    // Rendered BEFORE RockLayer so water edges tuck seamlessly behind the foreground rock contour!
    drawWaterPools(ctx, camera, viewW, viewH, level, players, bullets, timeSec) {
        const cfg = RENDER_CONFIG.details;
        if (!cfg || !cfg.enabled || cfg.waterPoolsEnabled === false) return;
        if (level && this.builtForLevel !== level) {
            this.initLevel(level);
        }
        if (this.waterPools.length === 0) return;

        const activeShips = players ? Object.values(players).filter(s => !s.isDead) : [];
        const bulletList = Array.isArray(bullets) ? bullets : [];
        const padPx = cfg.waterOverlapPx ?? 24;

        ctx.save();
        for (const pool of this.waterPools) {
            if (pool.x + pool.w < camera.x - 40 || pool.x > camera.x + viewW + 40 ||
                pool.bottomY < camera.y - 40 || pool.y > camera.y + viewH + 40) {
                continue;
            }

            const n = pool.nodeCount;
            const totalW = pool.w + padPx * 2;
            const startX = pool.x - padPx;
            const stepX = totalW / (n - 1);

            // Ship hull skimming & thruster exhaust depression
            for (let sIdx = 0; sIdx < activeShips.length; sIdx++) {
                const s = activeShips[sIdx];
                if (s.x < pool.x - 50 || s.x > pool.x + pool.w + 50) continue;
                const dy = pool.y - s.y;
                const isThrusting = Boolean(!s.isLanded && s.inputs && s.inputs.up && (s.fuel === undefined || s.fuel > 0));

                if (Math.abs(dy) < 22 && s.x >= pool.x && s.x <= pool.x + pool.w) {
                    const idx = Math.max(1, Math.min(n - 2, Math.floor(((s.x - startX) / totalW) * (n - 1))));
                    pool.vels[idx] += Math.min(2.8, Math.max(-2.8, (s.vy || 0) * 0.4 + 0.7));
                    if (Math.random() < 0.22 && this.sparks.length < (cfg.maxSparks ?? 90)) {
                        this.sparks.push({
                            x: s.x + (Math.random() - 0.5) * 12,
                            y: pool.y,
                            vx: -(s.vx || 0) * 0.25 + (Math.random() - 0.5) * 1.4,
                            vy: -1.0 - Math.random() * 1.2,
                            gravity: 0.08,
                            life: 15,
                            maxLife: 15,
                            size: 1.7,
                            color: 'rgba(110, 242, 255, 0.8)'
                        });
                    }
                }

                if (isThrusting && dy > -8 && dy < 90) {
                    const backX = -Math.cos(s.angle);
                    const backY = -Math.sin(s.angle);
                    if (backY > 0.2) {
                        const hitX = s.x + backX * (dy / backY);
                        if (hitX >= pool.x && hitX <= pool.x + pool.w) {
                            const idx = Math.max(1, Math.min(n - 2, Math.floor(((hitX - startX) / totalW) * (n - 1))));
                            const strength = (1 - dy / 90) * 1.9;
                            for (let k = -2; k <= 2; k++) {
                                const ni = idx + k;
                                if (ni > 0 && ni < n - 1) {
                                    pool.vels[ni] += (Math.abs(k) === 2 ? -strength * 0.5 : strength * (1 - Math.abs(k) * 0.3));
                                }
                            }
                            if (Math.random() < 0.28 && this.sparks.length < (cfg.maxSparks ?? 90)) {
                                const side = Math.random() > 0.5 ? 1 : -1;
                                this.sparks.push({
                                    x: hitX + side * (6 + Math.random() * 8),
                                    y: pool.y + 1,
                                    vx: side * (1.1 + Math.random() * 1.6),
                                    vy: -1.1 - Math.random() * 1.2,
                                    gravity: 0.09,
                                    life: 14,
                                    maxLife: 14,
                                    size: 1.6,
                                    color: 'rgba(135, 245, 255, 0.78)'
                                });
                            }
                        }
                    }
                }
            }

            for (let b = 0; b < bulletList.length; b++) {
                const bul = bulletList[b];
                if (bul.x >= pool.x && bul.x <= pool.x + pool.w && Math.abs(bul.y - pool.y) < 12) {
                    const idx = Math.max(1, Math.min(n - 2, Math.floor(((bul.x - startX) / totalW) * (n - 1))));
                    pool.vels[idx] += 2.0;
                }
            }

            // Fast 1D spring integration (zero object allocations)
            for (let i = 1; i < n - 1; i++) {
                const neighborAvg = (pool.nodes[i - 1] + pool.nodes[i + 1]) * 0.5;
                const accel = -0.045 * pool.nodes[i] + (neighborAvg - pool.nodes[i]) * 0.24;
                pool.vels[i] = (pool.vels[i] + accel) * 0.91;
            }
            pool.nodes[0] = 0;
            pool.nodes[n - 1] = 0;
            for (let i = 1; i < n - 1; i++) {
                pool.nodes[i] = Math.max(-8, Math.min(8, pool.nodes[i] + pool.vels[i]));
            }

            // Draw water body extended by padPx into left, right, and bottom rock (RockLayer masks the edges!)
            const deepBottomY = pool.bottomY + padPx + 32;
            ctx.fillStyle = 'rgba(10, 82, 118, 0.62)';
            ctx.beginPath();
            ctx.moveTo(startX, deepBottomY);
            for (let i = 0; i < n; i++) {
                const wx = startX + i * stepX;
                const wy = pool.y + pool.nodes[i] + Math.sin(timeSec * 2.4 + i * 0.6) * 0.7;
                ctx.lineTo(wx, wy);
            }
            ctx.lineTo(startX + totalW, deepBottomY);
            ctx.closePath();
            ctx.fill();

            // Crisp glowing cyan surface meniscus
            ctx.strokeStyle = 'rgba(120, 245, 255, 0.72)';
            ctx.lineWidth = 1.8;
            ctx.beginPath();
            for (let i = 0; i < n; i++) {
                const wx = startX + i * stepX;
                const wy = pool.y + pool.nodes[i] + Math.sin(timeSec * 2.4 + i * 0.6) * 0.7;
                if (i === 0) ctx.moveTo(wx, wy);
                else ctx.lineTo(wx, wy);
            }
            ctx.stroke();
        }
        ctx.restore();
    }

    updateAndDraw(ctx, camera, viewW, viewH, level, players, turrets, bullets, timeSec, rockLayer, floraLayer) {
        const cfg = RENDER_CONFIG.details;
        if (!cfg || !cfg.enabled) return;
        if (level && this.builtForLevel !== level) {
            this.initLevel(level);
        }

        ctx.save();

        // 0. Render Clipped Blast Soot Decals on Metal Pads / Base Structures
        if (this.prefabScorches.length > 0) {
            for (const sc of this.prefabScorches) {
                if (sc.x + sc.r < camera.x || sc.x - sc.r > camera.x + viewW ||
                    sc.y + sc.r < camera.y || sc.y - sc.r > camera.y + viewH) continue;
                ctx.save();
                ctx.beginPath();
                ctx.rect(sc.clipX, sc.clipY, sc.clipW, sc.clipH);
                ctx.clip();
                const g = ctx.createRadialGradient(sc.x, sc.y, sc.r * 0.1, sc.x, sc.y, sc.r);
                g.addColorStop(0, `rgba(6, 4, 3, ${sc.alpha})`);
                g.addColorStop(0.55, `rgba(14, 10, 8, ${sc.alpha * 0.55})`);
                g.addColorStop(1, 'rgba(10, 8, 6, 0)');
                ctx.fillStyle = g;
                ctx.beginPath();
                ctx.arc(sc.x, sc.y, sc.r, 0, Math.PI * 2);
                ctx.fill();
                ctx.restore();
            }
        }

        // 1. Gravity Well Directional Stream Particles
        if (cfg.gravityStreamsEnabled !== false && this.gravStreams.length > 0) {
            const speed = cfg.gravityStreamSpeed ?? 1.4;
            ctx.strokeStyle = cfg.gravityStreamColor || 'rgba(185, 120, 255, 0.38)';
            ctx.lineWidth = 1.5;
            ctx.lineCap = 'round';
            for (const gs of this.gravStreams) {
                if (gs.x < camera.x - 40 || gs.x > camera.x + viewW + 40 || gs.y < camera.y - 40 || gs.y > camera.y + viewH + 40) continue;
                for (const m of gs.motes) {
                    const t = (timeSec * speed + m.phase) % 1;
                    const px = gs.x + m.ox + gs.vx * (t - 0.5) * 26;
                    const py = gs.y + m.oy + gs.vy * (t - 0.5) * 26;
                    const alpha = Math.sin(t * Math.PI);
                    ctx.globalAlpha = alpha * 0.55;
                    ctx.beginPath();
                    ctx.moveTo(px - gs.vx * 4, py - gs.vy * 4);
                    ctx.lineTo(px + gs.vx * 4, py + gs.vy * 4);
                    ctx.stroke();
                }
            }
            ctx.globalAlpha = 1.0;
        }

        // 1.5. Magnetic Anomaly Plasma Arcs (Gravity Wells 0xCC - 0xCF locking onto ships!)
        if (cfg.gravityArcsEnabled !== false && players && this.gravStreams.length > 0) {
            ctx.save();
            ctx.globalCompositeOperation = 'lighter';
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
            for (const id in players) {
                const p = players[id];
                if (p.isDead) continue;
                if (p.x < camera.x - 120 || p.x > camera.x + viewW + 120 || p.y < camera.y - 120 || p.y > camera.y + viewH + 120) continue;

                // Find all gravity well tiles within range of the ship
                const nearbyWells = [];
                for (let i = 0; i < this.gravStreams.length; i++) {
                    const gs = this.gravStreams[i];
                    const d = Math.hypot(gs.x - p.x, gs.y - p.y);
                    if (d < 135) {
                        nearbyWells.push({ gs, d });
                    }
                }
                if (nearbyWells.length === 0) continue;

                nearbyWells.sort((a, b) => a.d - b.d);
                const primary = nearbyWells[0].gs;

                // Draw pulsing magnetic containment corona around the ship hull
                const pulse = 0.65 + 0.35 * Math.sin(timeSec * 18 + p.x * 0.1);
                const grad = ctx.createRadialGradient(p.x, p.y, 6, p.x, p.y, 34);
                grad.addColorStop(0, `rgba(195, 110, 255, ${0.42 * pulse})`);
                grad.addColorStop(0.6, `rgba(0, 242, 254, ${0.22 * pulse})`);
                grad.addColorStop(1, 'rgba(180, 90, 255, 0)');
                ctx.fillStyle = grad;
                ctx.beginPath();
                ctx.arc(p.x, p.y, 34, 0, Math.PI * 2);
                ctx.fill();

                // Draw directional pull chevrons on the ship showing the active magnet force vector
                for (let c = 0; c < 3; c++) {
                    const ct = ((timeSec * 3.5 + c * 0.33) % 1);
                    const cx = p.x + primary.vx * (10 + ct * 24);
                    const cy = p.y + primary.vy * (10 + ct * 24);
                    const perpX = -primary.vy * 6;
                    const perpY = primary.vx * 6;
                    ctx.strokeStyle = `rgba(0, 242, 254, ${(1 - ct) * 0.85})`;
                    ctx.lineWidth = 1.8;
                    ctx.beginPath();
                    ctx.moveTo(cx - primary.vx * 5 + perpX, cy - primary.vy * 5 + perpY);
                    ctx.lineTo(cx, cy);
                    ctx.lineTo(cx - primary.vx * 5 - perpX, cy - primary.vy * 5 - perpY);
                    ctx.stroke();
                }

                // Draw crackling jagged plasma lightning tendrils from the closest gravity tiles to the ship hull
                const arcCount = Math.min(3, nearbyWells.length);
                for (let a = 0; a < arcCount; a++) {
                    const well = nearbyWells[a].gs;
                    const segs = 6;
                    const dx = p.x - well.x;
                    const dy = p.y - well.y;
                    const nx = -dy / (Math.hypot(dx, dy) || 1);
                    const ny = dx / (Math.hypot(dx, dy) || 1);

                    ctx.strokeStyle = a % 2 === 0 ? 'rgba(205, 130, 255, 0.85)' : 'rgba(90, 245, 255, 0.85)';
                    ctx.lineWidth = a === 0 ? 2.2 : 1.4;
                    ctx.beginPath();
                    ctx.moveTo(well.x, well.y);
                    for (let s = 1; s < segs; s++) {
                        const t = s / segs;
                        const jitter = Math.sin(timeSec * 42 + s * 7.3 + a * 3.1) * 11 * Math.sin(t * Math.PI);
                        ctx.lineTo(well.x + dx * t + nx * jitter, well.y + dy * t + ny * jitter);
                    }
                    ctx.lineTo(p.x, p.y);
                    ctx.stroke();
                }
            }
            ctx.restore();
        }

        // 2. Ship Thruster Surface Dust/Scorch & Landing Touchdown Effects
        if (players && level?.rawMap) {
            for (const id in players) {
                const p = players[id];
                const prev = this.shipPrev.get(id);

                if (!p.isDead) {
                    // Check Landing Touchdown transition
                    if (cfg.landingEffectsEnabled !== false && prev && !prev.isLanded && p.isLanded) {
                        const impactVy = Math.max(0, prev.vy || 0.8);
                        const hardLanding = impactVy >= (cfg.hardLandingVyThreshold ?? 1.25);
                        const puffCount = hardLanding ? 7 : 4;
                        for (let i = 0; i < puffCount && this.sparks.length < (cfg.maxSparks ?? 90); i++) {
                            const dir = i % 2 === 0 ? -1 : 1;
                            this.sparks.push({
                                x: p.x + dir * (6 + Math.random() * 5),
                                y: p.y + 12,
                                vx: dir * (0.35 + Math.random() * 0.55),
                                vy: -0.10 - Math.random() * 0.35,
                                gravity: hardLanding ? 0.06 : -0.02,
                                life: 22 + Math.floor(Math.random() * 14),
                                maxLife: 36,
                                size: hardLanding ? 1.8 : 2.5,
                                color: hardLanding ? '#ffd260' : 'rgba(190, 200, 215, 0.55)'
                            });
                        }
                        // Slow, lingering cryo-frost mist that stays near the landing gear and dissolves gradually
                        const ventCount = cfg.padVentCountPerSide ?? 4;
                        const ventSpdX = cfg.padVentSpeedX ?? 0.42;
                        const ventLife = cfg.padVentLifeTicks ?? 88;
                        const ventAlpha = cfg.padVentAlpha ?? 0.34;
                        const ventGrow = cfg.padVentGrowRate ?? 0.06;
                        for (let side of [-1, 1]) {
                            for (let k = 0; k < ventCount && this.smokePuffs.length < 75; k++) {
                                const lifeTicks = ventLife + Math.floor((Math.random() - 0.5) * 20);
                                this.smokePuffs.push({
                                    x: p.x + side * (5 + k * 3.5),
                                    y: p.y + 13.5,
                                    vx: side * (ventSpdX * (0.55 + Math.random() * 0.65)),
                                    vy: -0.04 - Math.random() * 0.09,
                                    r: 3.4 + Math.random() * 1.8,
                                    grow: ventGrow,
                                    life: lifeTicks,
                                    maxLife: lifeTicks,
                                    rgb: '220, 248, 255',
                                    peakAlpha: ventAlpha
                                });
                            }
                        }
                    }

                    // Subtle RCS attitude-thruster micro-sparks when rotating in flight
                    if (!p.isLanded && p.inputs && (p.inputs.left !== p.inputs.right) && Math.random() < 0.45 && this.sparks.length < (cfg.maxSparks ?? 90)) {
                        const cos = Math.cos(p.angle);
                        const sin = Math.sin(p.angle);
                        const localX = 10.5;
                        const localY = p.inputs.left ? 3.5 : -3.5;
                        const jetDirY = p.inputs.left ? 1 : -1;
                        const wx = p.x + cos * localX - sin * localY;
                        const wy = p.y + sin * localX + cos * localY;
                        const jvx = (p.vx || 0) * 0.3 - sin * jetDirY * (1.4 + Math.random() * 0.9);
                        const jvy = (p.vy || 0) * 0.3 + cos * jetDirY * (1.4 + Math.random() * 0.9);
                        this.sparks.push({
                            x: wx,
                            y: wy,
                            vx: jvx,
                            vy: jvy,
                            gravity: 0,
                            life: 6 + Math.floor(Math.random() * 5),
                            maxLife: 11,
                            size: 1.2,
                            color: 'rgba(165, 235, 255, 0.65)'
                        });
                    }

                    // Check Thruster Exhaust Plume against Walls/Floors/Pads
                    const isThrusting = Boolean(p.inputs && (p.inputs.up || p.inputs.analogUp > 0) && p.fuel > 0);
                    if (isThrusting && (cfg.thrusterDustEnabled !== false || cfg.thrusterScorchEnabled !== false)) {
                        const backX = -Math.cos(p.angle);
                        const backY = -Math.sin(p.angle);
                        const reach = cfg.thrusterWallReachPx ?? 46;

                        for (const d of [22, 34, reach]) {
                            const hx = p.x + backX * d;
                            const hy = p.y + backY * d;
                            const tx = Math.floor(hx / 32);
                            const ty = Math.floor(hy / 32);
                            const tid = level.rawMap[ty]?.[tx];
                            if (tid && tid > 0 && tid < 0x90 && tid !== 0x20 && tid !== 0x32 && tid !== 0x33) {
                                // Tangential dust & pebble kick-up
                                if (cfg.thrusterDustEnabled !== false && Math.random() < 0.65 && this.sparks.length < (cfg.maxSparks ?? 90)) {
                                    const side = Math.random() > 0.5 ? 1 : -1;
                                    const tangX = -backY * side + (Math.random() - 0.5) * 0.4;
                                    const tangY = backX * side + (Math.random() - 0.5) * 0.4;
                                    const spd = 1.1 + Math.random() * 1.9;
                                    const isPebble = Math.random() < 0.35;
                                    this.sparks.push({
                                        x: hx - backX * 4,
                                        y: hy - backY * 4,
                                        vx: tangX * spd,
                                        vy: tangY * spd,
                                        gravity: isPebble ? 0.09 : -0.015,
                                        life: 14 + Math.floor(Math.random() * 12),
                                        maxLife: 26,
                                        size: isPebble ? 1.8 : 2.8,
                                        color: isPebble ? '#9c6b46' : 'rgba(180, 155, 135, 0.42)'
                                    });
                                }

                                // Rock Scorch & Temporary Cherry-Orange Heat Glow
                                if (cfg.thrusterScorchEnabled !== false) {
                                    if (rockLayer && Math.random() < 0.35) {
                                        rockLayer.stampScorch(hx, hy, 7.0, 0.08);
                                    }
                                    let existing = this.heatSpots.find(h => Math.hypot(h.x - hx, h.y - hy) < 14);
                                    if (existing) {
                                        existing.heat = Math.min(1.0, existing.heat + 0.08);
                                    } else if (this.heatSpots.length < (cfg.maxHeatSpots ?? 28)) {
                                        this.heatSpots.push({ x: hx, y: hy, heat: 0.35 });
                                    }
                                }
                                break;
                            }
                        }
                    }
                }

                this.shipPrev.set(id, {
                    isLanded: Boolean(p.isLanded),
                    vy: p.vy || 0
                });
            }
        }

        // 2.8. Update & Draw Atmospheric Hanging Ceiling Stalactites & Tumbling Rock Shards
        if (cfg.stalactitesEnabled !== false && this.stalactites.length > 0) {
            const activeShips = players ? Object.values(players).filter(s => !s.isDead) : [];
            const stAlpha = cfg.stalactiteAlpha ?? 0.88;
            const rimAlpha = cfg.stalactiteRimAlpha ?? 0.55;
            for (const st of this.stalactites) {
                if (st.x < camera.x - 40 || st.x > camera.x + viewW + 40 ||
                    st.y + st.length < camera.y - 40 || st.y > camera.y + viewH + 40) {
                    continue;
                }

                // Check direct ship collision or close thruster resonance
                if (st.intact) {
                    for (const s of activeShips) {
                        const d = Math.hypot(s.x - st.x, s.y - (st.y + st.length * 0.5));
                        if (d < 20) {
                            this.shatterStalactite(st, s.vx || 0);
                            break;
                        } else if (d < 75 && s.inputs?.up) {
                            st.shake = Math.min(1.0, st.shake + 0.12);
                            if (Math.random() < 0.25 && this.sparks.length < (cfg.maxSparks ?? 90)) {
                                this.sparks.push({
                                    x: st.x + (Math.random() - 0.5) * 5,
                                    y: st.y + st.length * 0.85,
                                    vx: (Math.random() - 0.5) * 0.35,
                                    vy: 0.7 + Math.random() * 0.8,
                                    gravity: 0.04,
                                    life: 24,
                                    maxLife: 24,
                                    size: 1.4,
                                    color: 'rgba(185, 130, 80, 0.7)'
                                });
                            }
                        }
                    }
                }

                const jitterX = st.shake > 0 ? Math.sin(timeSec * 55 + st.x) * st.shake * 2.4 : 0;
                if (st.shake > 0) st.shake = Math.max(0, st.shake - 0.03);

                const drawLen = st.intact ? st.length : st.length * 0.28;
                const tipX = st.x + st.skew + jitterX;
                const tipY = st.y + drawLen;

                // West warm lit rock facet
                ctx.fillStyle = `rgba(122, 79, 48, ${stAlpha})`;
                ctx.beginPath();
                ctx.moveTo(st.x - st.halfW, st.y);
                ctx.lineTo(st.x, st.y);
                ctx.lineTo(tipX, tipY);
                ctx.closePath();
                ctx.fill();

                // East deep shadow rock facet
                ctx.fillStyle = `rgba(56, 34, 21, ${stAlpha})`;
                ctx.beginPath();
                ctx.moveTo(st.x, st.y);
                ctx.lineTo(st.x + st.halfW, st.y);
                ctx.lineTo(tipX, tipY);
                ctx.closePath();
                ctx.fill();

                // Ochre mineral ridge highlight so stalactites stand out against the dark cavern
                if (rimAlpha > 0) {
                    ctx.strokeStyle = `rgba(185, 130, 80, ${rimAlpha})`;
                    ctx.lineWidth = 1.1;
                    ctx.beginPath();
                    ctx.moveTo(st.x - st.halfW, st.y);
                    ctx.lineTo(tipX, tipY);
                    ctx.stroke();
                }
            }

            // Update & render tumbling shattered stalactite shards
            for (let i = this.fallingShards.length - 1; i >= 0; i--) {
                const sh = this.fallingShards[i];
                sh.vy += 0.14;
                sh.x += sh.vx;
                sh.y += sh.vy;
                sh.angle += sh.spin;
                sh.life--;

                if (this.splashWaterAt(sh.x, sh.y, 6.5)) {
                    this.fallingShards.splice(i, 1);
                    continue;
                }

                const tx = Math.floor(sh.x / 32);
                const ty = Math.floor(sh.y / 32);
                const tid = level?.rawMap?.[ty]?.[tx] ?? 0;
                if (sh.life <= 0 || (tid > 0 && tid < 0x90 && tid !== 0x20)) {
                    for (let k = 0; k < 5 && this.sparks.length < (cfg.maxSparks ?? 90); k++) {
                        this.sparks.push({
                            x: sh.x,
                            y: sh.y,
                            vx: (Math.random() - 0.5) * 2.6,
                            vy: -0.8 - Math.random() * 1.8,
                            gravity: 0.09,
                            life: 18,
                            maxLife: 18,
                            size: 1.9,
                            color: k % 2 === 0 ? '#b98250' : '#5c3c26'
                        });
                    }
                    this.fallingShards.splice(i, 1);
                    continue;
                }

                ctx.save();
                ctx.translate(sh.x, sh.y);
                ctx.rotate(sh.angle);
                ctx.fillStyle = '#6e472b';
                ctx.strokeStyle = '#b98250';
                ctx.lineWidth = 1.2;
                ctx.beginPath();
                ctx.moveTo(-sh.halfW, -sh.length * 0.5);
                ctx.lineTo(sh.halfW, -sh.length * 0.5);
                ctx.lineTo(0, sh.length * 0.5);
                ctx.closePath();
                ctx.fill();
                ctx.stroke();
                ctx.restore();
            }
        }

        // 3. Turret Hot Barrel Smoke After Firing
        if (cfg.turretBarrelSmokeEnabled !== false && Array.isArray(turrets)) {
            for (let i = 0; i < turrets.length; i++) {
                const t = turrets[i];
                if (!t.active) continue;
                const key = `${Math.round(t.x)},${Math.round(t.y)}`;
                // Detect firing sound or spawn subtle periodic wisp if turret is recently active
                if (Math.random() < (cfg.turretSmokeChance ?? 0.018) && this.smokePuffs.length < (cfg.maxSmokePuffs ?? 35)) {
                    const my = t.type === 0xB6 ? t.y + 14 : t.y - 16;
                    this.smokePuffs.push({
                        x: t.x + (Math.random() - 0.5) * 4,
                        y: my,
                        vx: (Math.random() - 0.5) * 0.25,
                        vy: -0.35 - Math.random() * 0.25,
                        r: 2.2,
                        life: 38,
                        maxLife: 38
                    });
                }
                this.turretPrevCooldown.set(key, true);
            }
        }

        // 3.5. Update Lingering Crash-Site Dark Smoke Plume Emitters
        if (cfg.crashSmokeEnabled !== false && this.crashPlumes.length > 0) {
            const maxSmoke = (cfg.maxSmokePuffs ?? 35) + 30;
            const baseChance = cfg.crashSmokeSpawnChance ?? 0.42;
            const scaleFactor = cfg.crashSmokeAlpha ?? 0.75;
            for (let i = this.crashPlumes.length - 1; i >= 0; i--) {
                const cp = this.crashPlumes[i];
                cp.life--;
                if (cp.life <= 0) {
                    this.crashPlumes.splice(i, 1);
                    continue;
                }
                const intensity = cp.life / cp.maxLife;
                if (Math.random() < baseChance * (0.35 + intensity * 0.65) && this.smokePuffs.length < maxSmoke) {
                    const puffLife = 52 + Math.floor(Math.random() * 26);
                    this.smokePuffs.push({
                        x: cp.x + (Math.random() - 0.5) * 18 * cp.scale,
                        y: cp.y + (Math.random() - 0.5) * 10 * cp.scale,
                        vx: (Math.random() - 0.5) * 0.45,
                        vy: -0.58 - Math.random() * 0.45,
                        r: (4.8 + Math.random() * 3.8) * cp.scale,
                        grow: 0.18,
                        life: puffLife,
                        maxLife: puffLife,
                        rgb: '32, 27, 24',
                        peakAlpha: scaleFactor * (0.5 + intensity * 0.5)
                    });
                }
            }
        }

        // 4. Draw Cooling Rock Heat Glow Spots
        if (this.heatSpots.length > 0) {
            ctx.globalCompositeOperation = 'lighter';
            const coolRate = cfg.scorchHeatDecay ?? 0.012;
            for (let i = this.heatSpots.length - 1; i >= 0; i--) {
                const hs = this.heatSpots[i];
                hs.heat -= coolRate;
                if (hs.heat <= 0) {
                    this.heatSpots.splice(i, 1);
                    continue;
                }
                const rad = 6 + hs.heat * 8;
                const g = ctx.createRadialGradient(hs.x, hs.y, 1, hs.x, hs.y, rad);
                g.addColorStop(0, `rgba(255, 120, 35, ${hs.heat * 0.55})`);
                g.addColorStop(1, 'rgba(255, 60, 10, 0)');
                ctx.fillStyle = g;
                ctx.beginPath();
                ctx.arc(hs.x, hs.y, rad, 0, Math.PI * 2);
                ctx.fill();
            }
            ctx.globalCompositeOperation = 'source-over';
        }

        // 5. Update & Draw Turret Muzzle & Crash-Site Smoke Puffs (with Ship Swirl Interaction)
        if (this.smokePuffs.length > 0) {
            const pushRad = cfg.smokePushRadius ?? 75;
            const pushForce = cfg.smokePushForce ?? 0.85;
            const activeShips = players ? Object.values(players).filter(s => !s.isDead) : [];

            for (let i = this.smokePuffs.length - 1; i >= 0; i--) {
                const sm = this.smokePuffs[i];

                // Deflect smoke particles away from passing ship hulls / thruster wash
                if (activeShips.length > 0) {
                    for (const s of activeShips) {
                        const dx = sm.x - s.x;
                        const dy = sm.y - s.y;
                        const dist = Math.hypot(dx, dy);
                        if (dist < pushRad && dist > 1) {
                            const power = (1 - dist / pushRad) * pushForce;
                            sm.vx += (dx / dist) * power;
                            sm.vy += (dy / dist) * power * 0.5 - 0.08; // Upward draft pull
                        }
                    }
                }

                sm.x += sm.vx + Math.sin(timeSec * 3 + i) * 0.08;
                sm.y += sm.vy;
                sm.r += sm.grow ?? 0.09;
                sm.vx *= 0.96;
                sm.vy *= 0.97;
                sm.life--;
                if (sm.life <= 0) {
                    this.smokePuffs.splice(i, 1);
                    continue;
                }
                const lifeRatio = sm.life / sm.maxLife;
                const env = lifeRatio > 0.85 ? (1.0 - lifeRatio) / 0.15 : lifeRatio / 0.85;
                const a = env * (sm.peakAlpha ?? 0.28);
                const rgb = sm.rgb || '175, 185, 195';
                ctx.fillStyle = `rgba(${rgb}, ${a})`;
                ctx.beginPath();
                ctx.arc(sm.x, sm.y, sm.r, 0, Math.PI * 2);
                ctx.fill();
            }
        }

        // 6. Update & Draw Ricochet Sparks, Rock Chips & Dust Puffs
        if (this.sparks.length > 0) {
            for (let i = this.sparks.length - 1; i >= 0; i--) {
                const sp = this.sparks[i];
                sp.x += sp.vx;
                sp.y += sp.vy;
                sp.vy += sp.gravity;
                sp.vx *= 0.96;
                sp.life--;
                if (sp.life <= 0) {
                    this.sparks.splice(i, 1);
                    continue;
                }
                ctx.globalAlpha = Math.max(0, sp.life / sp.maxLife);
                ctx.fillStyle = sp.color;
                ctx.beginPath();
                ctx.arc(sp.x, sp.y, sp.size, 0, Math.PI * 2);
                ctx.fill();
            }
            ctx.globalAlpha = 1.0;
        }

        // 6.5. Update & Draw Supersonic Shockwave Condensation Rings & Ceiling Dust Curtain
        if (cfg.shockwaveRingsEnabled !== false && this.shockwaves.length > 0) {
            ctx.save();
            ctx.globalCompositeOperation = 'lighter';
            for (let i = this.shockwaves.length - 1; i >= 0; i--) {
                const sw = this.shockwaves[i];
                sw.prevR = sw.r;
                sw.life++;
                const progress = sw.life / sw.maxLife;
                if (progress >= 1.0) {
                    this.shockwaves.splice(i, 1);
                    continue;
                }

                // Smooth ease-out expansion and quadratic fade-out so rings always vanish cleanly
                const easeOut = 1.0 - Math.pow(1.0 - progress, 2.2);
                sw.r = 12 + (sw.maxR - 12) * easeOut;
                const alpha = Math.pow(1.0 - progress, 1.8) * sw.alpha;

                // Outer refractive Mach condensation ring
                ctx.strokeStyle = `rgba(165, 238, 255, ${alpha * 0.85})`;
                ctx.lineWidth = Math.max(1.5, 6.5 * (1.0 - progress));
                ctx.beginPath();
                ctx.arc(sw.x, sw.y, sw.r, 0, Math.PI * 2);
                ctx.stroke();

                // Inner thermal pressure wave
                ctx.strokeStyle = `rgba(255, 195, 95, ${alpha * 0.55})`;
                ctx.lineWidth = Math.max(1.0, 3.0 * (1.0 - progress));
                ctx.beginPath();
                ctx.arc(sw.x, sw.y, sw.r * 0.84, 0, Math.PI * 2);
                ctx.stroke();

                // Shake loose a curtain of mineral dust from ceiling contours crossed by the shockwave front
                if (level?.walls) {
                    for (const wall of level.walls) {
                        for (let w = 0; w < wall.length - 1; w += 3) {
                            const pt = wall[w];
                            if (pt.y > sw.y + 40) continue; // Prefer ceilings & upper walls
                            const d = Math.hypot(pt.x - sw.x, pt.y - sw.y);
                            if (d >= sw.prevR && d <= sw.r) {
                                const nextPt = wall[w + 1];
                                const segDx = nextPt.x - pt.x;
                                if (segDx < -0.5 && this.sparks.length < 130) { // Ceiling segment
                                    this.sparks.push({
                                        x: pt.x + (Math.random() - 0.5) * 8,
                                        y: pt.y + 4,
                                        vx: (Math.random() - 0.5) * 0.6,
                                        vy: 0.9 + Math.random() * 1.6,
                                        gravity: 0.05,
                                        life: 32 + Math.floor(Math.random() * 20),
                                        maxLife: 52,
                                        size: 1.8 + Math.random() * 1.4,
                                        color: 'rgba(205, 155, 105, 0.78)'
                                    });
                                }
                            }
                        }
                    }
                }
            }
            ctx.restore();
        }

        // 7. Crystalline Glints on the Rock Rim (Triggered by Camera Motion or Ship Proximity)
        if (cfg.crystalGlintsEnabled !== false && this.crystals.length > 0) {
            const camPhase = (camera.x + camera.y) * 0.035;
            for (const c of this.crystals) {
                if (c.x < camera.x || c.x > camera.x + viewW || c.y < camera.y || c.y > camera.y + viewH) continue;
                let shipBoost = 0;
                if (players) {
                    for (const id in players) {
                        const p = players[id];
                        if (!p.isDead && Math.hypot(p.x - c.x, p.y - c.y) < 160) {
                            shipBoost = 0.35;
                            break;
                        }
                    }
                }
                const glint = Math.sin(camPhase + timeSec * 1.8 + c.phase);
                const threshold = 0.92 - shipBoost;
                if (glint > threshold) {
                    const intensity = (glint - threshold) / (1.0 - threshold);
                    const r = 3.5 * intensity;
                    ctx.strokeStyle = c.color;
                    ctx.globalAlpha = intensity * (cfg.crystalGlintAlpha ?? 0.75);
                    ctx.lineWidth = 1.2;
                    ctx.beginPath();
                    ctx.moveTo(c.x - r, c.y);
                    ctx.lineTo(c.x + r, c.y);
                    ctx.moveTo(c.x, c.y - r);
                    ctx.lineTo(c.x, c.y + r);
                    ctx.stroke();
                }
            }
            ctx.globalAlpha = 1.0;
        }

        ctx.restore();
    }
}