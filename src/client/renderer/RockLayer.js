import { RENDER_CONFIG, rollChance } from './RenderConfig.js';

const TEAL_BRICK_LAYOUTS = {
    0x1B: [1, 1, 1, 1], // Full
    0x1C: [0, 0, 1, 0], // Bottom-Left Only
    0x1D: [1, 0, 1, 1], // TL, BL, BR
    0x1E: [0, 1, 1, 1], // TR, BL, BR
    0x1F: [0, 0, 0, 1], // Bottom-Right Only
    0x21: [1, 1, 1, 1], // Full (Variant)
    0x24: [0, 0, 1, 1], // BL, BR (Ground Top)
    0x25: [0, 1, 1, 1], // TR, BL, BR (Ground TL)
    0x26: [0, 0, 1, 1], // BL, BR (Ground Top Variant)
    0x27: [1, 0, 1, 1], // TL, BL, BR (Ground TR)
    0x28: [1, 1, 1, 1]  // Full (Variant)
};

class RockTextureGenerator {
    static createGrainPattern(cfg) {
        const pCanvas = document.createElement('canvas');
        pCanvas.width = 160;
        pCanvas.height = 160;
        const pCtx = pCanvas.getContext('2d');

        let seed = 918273;
        const rng = () => {
            seed = (seed * 16807) % 2147483647;
            return (seed - 1) / 2147483646;
        };

        const speckleCount = cfg.grainSpeckleCount ?? 750;
        // Micro-speckle mineral grain
        for (let i = 0; i < speckleCount; i++) {
            const x = rng() * 160;
            const y = rng() * 160;
            const r = 0.8 + rng() * 2.4;
            pCtx.fillStyle = rng() > 0.5
                ? `rgba(255, 205, 155, ${0.03 + rng() * 0.05})`
                : `rgba(8, 4, 2, ${0.08 + rng() * 0.12})`;
            pCtx.fillRect(x, y, r, r);
        }

        const fissureCount = cfg.grainFissureCount ?? 22;
        // Angular basalt micro-fissures
        pCtx.lineWidth = 1.1;
        for (let i = 0; i < fissureCount; i++) {
            let cx = rng() * 160;
            let cy = rng() * 160;
            pCtx.strokeStyle = rng() > 0.35 ? 'rgba(10, 5, 3, 0.24)' : 'rgba(195, 135, 85, 0.08)';
            pCtx.beginPath();
            pCtx.moveTo(cx, cy);
            for (let s = 0; s < 3; s++) {
                cx += (rng() - 0.5) * 26;
                cy += (rng() - 0.5) * 18;
                pCtx.lineTo(cx, cy);
            }
            pCtx.stroke();
        }
        return pCanvas;
    }

    static drawWarpedStrataAndVeins(ctx, w, h, cfg) {
        let seed = 424242;
        const rng = () => {
            seed = (seed * 16807) % 2147483647;
            return (seed - 1) / 2147483646;
        };

        // 1. Multi-frequency warped geological strata ribbons
        const bandColors = [
            'rgba(14, 8, 5, 0.42)',
            'rgba(58, 36, 22, 0.28)',
            'rgba(28, 17, 12, 0.36)',
            'rgba(78, 48, 30, 0.18)'
        ];
        const stepY = cfg.strataStepY || 28;
        for (let baseY = -40, idx = 0; baseY < h + 60; baseY += stepY, idx++) {
            const bandH = (cfg.strataHeight || 10) * (0.65 + rng() * 0.9);
            const phase1 = rng() * Math.PI * 2;
            const phase2 = rng() * Math.PI * 2;
            const freq1 = 0.0035 + rng() * 0.0025;
            const freq2 = 0.011 + rng() * 0.006;
            const amp1 = (cfg.strataWarpAmp1 ?? 12) * (0.75 + rng() * 0.5);
            const amp2 = (cfg.strataWarpAmp2 ?? 4) * (0.75 + rng() * 0.5);

            ctx.fillStyle = bandColors[idx % bandColors.length];
            ctx.beginPath();
            for (let x = 0; x <= w; x += 32) {
                const dy = Math.sin(x * freq1 + phase1) * amp1 + Math.cos(x * freq2 + phase2) * amp2;
                if (x === 0) ctx.moveTo(x, baseY + dy);
                else ctx.lineTo(x, baseY + dy);
            }
            for (let x = w; x >= 0; x -= 32) {
                const dy = Math.sin(x * freq1 + phase1) * amp1 + Math.cos(x * freq2 + phase2) * amp2;
                ctx.lineTo(x, baseY + dy + bandH);
            }
            ctx.closePath();
            ctx.fill();
        }

        // 2. Repeating micro-grain pattern overlay
        if (cfg.grainEnabled !== false) {
            const grainCanvas = this.createGrainPattern(cfg);
            const pattern = ctx.createPattern(grainCanvas, 'repeat');
            if (pattern) {
                ctx.fillStyle = pattern;
                ctx.fillRect(0, 0, w, h);
            }
        }

        // 3. Tectonic fault lines & glowing mineral/quartz veins
        if (cfg.mineralVeinsEnabled !== false) {
            const divisor = cfg.mineralVeinDensityDivisor || 55000;
            const veinCount = Math.floor((w * h) / divisor);
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
            for (let i = 0; i < veinCount; i++) {
                let vx = rng() * w;
                let vy = rng() * h;
                let angle = rng() * Math.PI * 2;
                const isQuartz = rng() > 0.62;
                const segs = 5 + Math.floor(rng() * 7);

                ctx.strokeStyle = isQuartz
                    ? 'rgba(165, 210, 235, 0.14)'
                    : 'rgba(12, 7, 4, 0.45)';
                ctx.lineWidth = isQuartz ? 1.8 : 2.5;
                ctx.beginPath();
                ctx.moveTo(vx, vy);
                for (let s = 0; s < segs; s++) {
                    angle += (rng() - 0.5) * 1.1;
                    const len = 18 + rng() * 34;
                    vx += Math.cos(angle) * len;
                    vy += Math.sin(angle) * len;
                    ctx.lineTo(vx, vy);
                }
                ctx.stroke();
            }
        }
    }

    static drawProceduralStalactites(ctx, level, cfg) {
        if (cfg.stalactitesEnabled === false || !level.walls) return;
        const maxSpan = cfg.stalactiteMaxSpanPx || 140;
        const ridgeAlpha = cfg.stalactiteRidgeAlpha ?? 0.38;
        const shadeAlpha = cfg.stalactiteShadeAlpha ?? 0.42;

        // Strictly internal 3D rock faceting for existing thin vertical cave walls/stalactites/stalagmites.
        // Drawn while clipped to traceRockVolume so it NEVER protrudes into the playfield!
        for (const wall of level.walls) {
            const n = wall.length;
            if (n < 12) continue;

            // Find opposing vertical/steep wall segments on the same loop that form a thin rock spine
            for (let i = 0; i < n - 1; i += 2) {
                const p1 = wall[i];
                const p2 = wall[(i + 1) % n];
                const dy1 = p2.y - p1.y;
                const dx1 = p2.x - p1.x;
                if (Math.abs(dy1) < 3.0 || Math.abs(dx1) > Math.abs(dy1) * 0.8) continue;

                // Look for an opposite-facing wall segment at roughly the same Y within maxSpan
                let bestOpp = null;
                let bestDistX = maxSpan;
                for (let j = 0; j < n - 1; j += 2) {
                    if (Math.abs(i - j) < 6 || Math.abs(i - j) > n - 6) continue;
                    const q1 = wall[j];
                    const q2 = wall[(j + 1) % n];
                    const dy2 = q2.y - q1.y;
                    // Opposite vertical direction means solid rock sits between p1 and q1
                    if (dy1 * dy2 >= 0) continue;
                    if (Math.abs(q1.y - p1.y) > 20) continue;
                    const distX = q1.x - p1.x;
                    if (distX > 12 && distX < bestDistX) {
                        bestDistX = distX;
                        bestOpp = q1;
                    }
                }

                if (!bestOpp) continue;

                const midX = (p1.x + bestOpp.x) * 0.5 + Math.sin(p1.y * 0.08) * (bestDistX * 0.12);
                const midY = (p1.y + bestOpp.y) * 0.5;
                const segH = Math.max(12, Math.abs(dy1) * 2.2);

                // East shadow facet inside the stalactite/stalagmite column
                ctx.fillStyle = `rgba(14, 8, 5, ${shadeAlpha})`;
                ctx.beginPath();
                ctx.moveTo(midX, midY - segH * 0.5);
                ctx.lineTo(bestOpp.x, bestOpp.y - segH * 0.5);
                ctx.lineTo(bestOpp.x, bestOpp.y + segH * 0.5);
                ctx.lineTo(midX, midY + segH * 0.5);
                ctx.closePath();
                ctx.fill();

                // Central craggy mineral spine highlight
                ctx.strokeStyle = `rgba(195, 140, 90, ${ridgeAlpha})`;
                ctx.lineWidth = 2.0;
                ctx.beginPath();
                ctx.moveTo(midX, midY - segH * 0.5);
                ctx.lineTo(midX + Math.cos(midY * 0.15) * 3.0, midY + segH * 0.5);
                ctx.stroke();
            }
        }
    }

    static drawWetSpecularSheen(ctx, level, cfg) {
        if (cfg.wetSheenEnabled === false || !level.walls) return;
        const drips = (level.highRes?.flora || []).filter(f => f.kind === 'DRIP_EMITTER');
        const rangeX = cfg.wetDripRangeX || 140;
        const rangeY = cfg.wetDripRangeY || 380;

        ctx.save();
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        for (const wall of level.walls) {
            const n = wall.length;
            if (n < 4) continue;
            for (let i = 0; i < n - 1; i++) {
                const p1 = wall[i];
                const p2 = wall[i + 1];
                const mx = (p1.x + p2.x) * 0.5;
                const my = (p1.y + p2.y) * 0.5;

                // Check if segment is near a water drip emitter or damp lower cavern zone
                let isWet = false;
                for (let d = 0; d < drips.length; d++) {
                    const dr = drips[d];
                    if (Math.abs(mx - dr.x) < rangeX && my >= dr.y - 40 && my <= dr.y + rangeY) {
                        isWet = true;
                        break;
                    }
                }
                if (!isWet) {
                    const dampNoise = Math.sin(mx * 0.012 + my * 0.009) * Math.cos(mx * 0.007 - my * 0.015);
                    if (dampNoise > 0.58) isWet = true;
                }
                if (!isWet) continue;

                ctx.strokeStyle = cfg.wetSheenColor || 'rgba(155, 228, 255, 0.32)';
                ctx.lineWidth = cfg.wetSheenWidth || 1.8;
                ctx.beginPath();
                ctx.moveTo(p1.x, p1.y);
                ctx.lineTo(p2.x, p2.y);
                ctx.stroke();
            }
        }
        ctx.restore();
    }

    static drawMachinedTealBrick(ctx, bx, by, neighbors) {
        // Deep recessed mounting socket
        ctx.fillStyle = '#061a1e';
        ctx.fillRect(bx, by, 16, 16);

        // Chamfered metallic armor plate
        const ch = 2.5;
        ctx.beginPath();
        ctx.moveTo(bx + ch, by + 0.5);
        ctx.lineTo(bx + 15.5 - ch, by + 0.5);
        ctx.lineTo(bx + 15.5, by + ch);
        ctx.lineTo(bx + 15.5, by + 15.5 - ch);
        ctx.lineTo(bx + 15.5 - ch, by + 15.5);
        ctx.lineTo(bx + ch, by + 15.5);
        ctx.lineTo(bx + 0.5, by + 15.5 - ch);
        ctx.lineTo(bx + 0.5, by + ch);
        ctx.closePath();

        const grad = ctx.createLinearGradient(bx, by, bx + 16, by + 16);
        grad.addColorStop(0, '#238996');
        grad.addColorStop(0.45, '#145e68');
        grad.addColorStop(1, '#0b3840');
        ctx.fillStyle = grad;
        ctx.fill();

        ctx.lineWidth = 1.0;
        ctx.strokeStyle = '#07262b';
        ctx.stroke();

        // Top-left directional specular bevel
        ctx.strokeStyle = 'rgba(110, 238, 250, 0.55)';
        ctx.lineWidth = 1.1;
        ctx.beginPath();
        ctx.moveTo(bx + 1.2, by + 13.5);
        ctx.lineTo(bx + 1.2, by + ch);
        ctx.lineTo(bx + ch, by + 1.2);
        ctx.lineTo(bx + 13.5, by + 1.2);
        ctx.stroke();

        // Recessed inner armor panel with subtle diagonal milled rib
        ctx.fillStyle = 'rgba(8, 36, 42, 0.55)';
        ctx.fillRect(bx + 3.5, by + 3.5, 9, 9);
        ctx.strokeStyle = 'rgba(56, 190, 205, 0.22)';
        ctx.lineWidth = 1.0;
        ctx.strokeRect(bx + 3.5, by + 3.5, 9, 9);

        ctx.strokeStyle = 'rgba(35, 137, 150, 0.35)';
        ctx.beginPath();
        ctx.moveTo(bx + 4.5, by + 11.5);
        ctx.lineTo(bx + 11.5, by + 4.5);
        ctx.stroke();

        // Micro-rivets at corners
        ctx.fillStyle = 'rgba(150, 245, 255, 0.45)';
        ctx.fillRect(bx + 2.2, by + 2.2, 1.2, 1.2);
        ctx.fillRect(bx + 12.6, by + 2.2, 1.2, 1.2);
        ctx.fillStyle = 'rgba(5, 20, 24, 0.75)';
        ctx.fillRect(bx + 2.2, by + 12.6, 1.2, 1.2);
        ctx.fillRect(bx + 12.6, by + 12.6, 1.2, 1.2);

        // Weld-seam shadow on exposed outer edges where brick meets rock/air
        if (!neighbors.top) {
            ctx.fillStyle = 'rgba(135, 250, 255, 0.28)';
            ctx.fillRect(bx + 2, by + 0.5, 12, 1.0);
        }
        if (!neighbors.bottom) {
            ctx.fillStyle = 'rgba(4, 14, 18, 0.75)';
            ctx.fillRect(bx + 2, by + 14.5, 12, 1.5);
        }
    }
}

export class RockLayer {
    constructor() {
        this.cachedCanvas = null;
        this.recessedCanvas = null;
        this.builtForLevel = null;
        this.cataclysms = [];
        this.cataclysmDebris = [];
        this.recessedFlatPlatforms = [];
        this.ghostShip = null;
        this.lastRecessedTimeMs = 0;
    }

    buildLevelCache(level) {
        if (!level || !level.walls || level.walls.length === 0) return;
        const cfg = RENDER_CONFIG.rock;
        this.builtForLevel = level;
        this.cataclysms = [];
        this.cataclysmDebris = [];
        this.recessedFlatPlatforms = [];
        this.ghostShip = null;

        const w = level.width;
        const h = level.height;

        // 1. Build Main Playfield Rock Mesh Canvas (Single Source of Truth from Smoothed Polygons)
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');

        // Includes outer level bounding box so even-odd rule fills SOLID ROCK
        // and carves out the enclosed cavern air loops as transparent sky!
        const traceRockVolume = (targetCtx) => {
            targetCtx.beginPath();
            targetCtx.rect(-64, -64, w + 128, h + 128);
            for (const wall of level.walls) {
                if (wall.length < 3) continue;
                targetCtx.moveTo(wall[0].x, wall[0].y);
                for (let i = 1; i < wall.length; i++) {
                    targetCtx.lineTo(wall[i].x, wall[i].y);
                }
                targetCtx.closePath();
            }
        };

        const traceAllLoops = (targetCtx) => {
            targetCtx.beginPath();
            for (const wall of level.walls) {
                if (wall.length < 3) continue;
                targetCtx.moveTo(wall[0].x, wall[0].y);
                for (let i = 1; i < wall.length; i++) {
                    targetCtx.lineTo(wall[i].x, wall[i].y);
                }
                targetCtx.closePath();
            }
        };

        // Clip to the exact even-odd interior of the rock mass
        ctx.save();
        traceRockVolume(ctx);
        ctx.clip('evenodd');

        // Deep Bedrock Fill
        ctx.fillStyle = cfg.bedrockColor;
        ctx.fillRect(0, 0, w, h);

        // Multi-scale Organic Warped Strata, Basalt Micro-Grain & Mineral Veins
        RockTextureGenerator.drawWarpedStrataAndVeins(ctx, w, h, cfg);

        // Inner Bevel Layer 1 (Mid-Rock Warmth via thick inner stroke clipped to rock)
        traceAllLoops(ctx);
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';
        ctx.strokeStyle = cfg.midBevelColor;
        ctx.lineWidth = cfg.midBevelWidth;
        ctx.stroke();

        // Inner Bevel Layer 2 (Warm Ochre Sub-Rim)
        traceAllLoops(ctx);
        ctx.strokeStyle = cfg.innerRimColor;
        ctx.lineWidth = cfg.innerRimWidth;
        ctx.stroke();

        // Internal Rock Crevice Shadow Lines
        traceAllLoops(ctx);
        ctx.strokeStyle = 'rgba(12, 7, 4, 0.55)';
        ctx.lineWidth = 3.0;
        ctx.stroke();

        // Internal 3D-Faceted Stalactite/Stalagmite Shading (Strictly clipped inside rock mass!)
        RockTextureGenerator.drawProceduralStalactites(ctx, level, cfg);

        ctx.restore();

        // Crisp Outer Rim Highlight (Masked out where Teal Bricks / Prefabs sit so contours don't cut across bricks!)
        ctx.save();
        if (level.rawMap) {
            ctx.beginPath();
            ctx.rect(-64, -64, w + 128, h + 128);
            for (let y = 0; y < level.rawMap.length; y++) {
                for (let x = 0; x < level.rawMap[y].length; x++) {
                    const tid = level.rawMap[y][x];
                    const layout = TEAL_BRICK_LAYOUTS[tid];
                    if (layout) {
                        const px = x * 32;
                        const py = y * 32;
                        const pad = 2.5;
                        if (layout[0]) ctx.rect(px - pad, py - pad, 16 + pad * 2, 16 + pad * 2);
                        if (layout[1]) ctx.rect(px + 16 - pad, py - pad, 16 + pad * 2, 16 + pad * 2);
                        if (layout[2]) ctx.rect(px - pad, py + 16 - pad, 16 + pad * 2, 16 + pad * 2);
                        if (layout[3]) ctx.rect(px + 16 - pad, py + 16 - pad, 16 + pad * 2, 16 + pad * 2);
                    }
                }
            }
            ctx.clip('evenodd');
        }
        traceAllLoops(ctx);
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';
        ctx.strokeStyle = cfg.outerOutlineColor;
        ctx.lineWidth = cfg.outerOutlineWidth;
        ctx.stroke();
        ctx.restore();

        // Draw Teal Bricks accurately based on their partial 16x16 layout
        if (level.rawMap) {
            const hasSubBrickAt = (subX, subY) => {
                const tx = Math.floor(subX / 2);
                const ty = Math.floor(subY / 2);
                const tid = level.rawMap[ty]?.[tx];
                const lay = TEAL_BRICK_LAYOUTS[tid];
                if (!lay) return false;
                const qx = ((subX % 2) + 2) % 2;
                const qy = ((subY % 2) + 2) % 2;
                return Boolean(lay[qy * 2 + qx]);
            };

            for (let y = 0; y < level.rawMap.length; y++) {
                for (let x = 0; x < level.rawMap[y].length; x++) {
                    const tid = level.rawMap[y][x];
                    const layout = TEAL_BRICK_LAYOUTS[tid];
                    if (layout) {
                        const px = x * 32;
                        const py = y * 32;
                        for (let qy = 0; qy < 2; qy++) {
                            for (let qx = 0; qx < 2; qx++) {
                                if (!layout[qy * 2 + qx]) continue;
                                const sx = x * 2 + qx;
                                const sy = y * 2 + qy;
                                RockTextureGenerator.drawMachinedTealBrick(
                                    ctx,
                                    px + qx * 16,
                                    py + qy * 16,
                                    {
                                        top: hasSubBrickAt(sx, sy - 1),
                                        bottom: hasSubBrickAt(sx, sy + 1),
                                        left: hasSubBrickAt(sx - 1, sy),
                                        right: hasSubBrickAt(sx + 1, sy)
                                    }
                                );
                            }
                        }
                    }
                }
            }
        }

        // Glossy Wet Specular Rim on damp rock & beneath water drip emitters
        RockTextureGenerator.drawWetSpecularSheen(ctx, level, cfg);

        this.cachedCanvas = canvas;

        // 2. Build Layer -1: Recessed Cavern Back-Wall Shell (0.65x Parallax)
        const backCanvas = document.createElement('canvas');
        backCanvas.width = w;
        backCanvas.height = h;
        const bCtx = backCanvas.getContext('2d');

        const siblingWalls = (level.highRes?.recessedWalls && level.highRes.recessedWalls.length > 0)
            ? level.highRes.recessedWalls
            : level.walls;
        const scaleX = level.highRes?.recessedWidth ? (w / level.highRes.recessedWidth) : 1.0;
        const scaleY = level.highRes?.recessedHeight ? (h / level.highRes.recessedHeight) : 1.0;

        const traceRecessedVolume = (targetCtx, includeOuterRect) => {
            targetCtx.beginPath();
            if (includeOuterRect) {
                targetCtx.rect(-64, -64, w + 128, h + 128);
            }
            for (const wall of siblingWalls) {
                if (wall.length < 3) continue;
                targetCtx.moveTo(wall[0].x * scaleX, wall[0].y * scaleY);
                for (let i = 1; i < wall.length; i++) {
                    targetCtx.lineTo(wall[i].x * scaleX, wall[i].y * scaleY);
                }
                targetCtx.closePath();
            }
        };

        bCtx.save();
        traceRecessedVolume(bCtx, true);
        bCtx.clip('evenodd');
        bCtx.fillStyle = 'rgba(14, 18, 28, 0.82)';
        bCtx.fillRect(0, 0, w, h);

        RockTextureGenerator.drawWarpedStrataAndVeins(bCtx, w, h, {
            ...cfg,
            strataStepY: 42,
            mineralVeinsEnabled: false
        });

        traceRecessedVolume(bCtx, false);
        bCtx.lineJoin = 'round';
        bCtx.strokeStyle = '#1c2436';
        bCtx.lineWidth = 44;
        bCtx.stroke();
        bCtx.restore();

        this.recessedCanvas = backCanvas;

        // Extract flat horizontal ledges on the sibling recessed walls for TODO 1 (faded background ghost ship)
        for (const wall of siblingWalls) {
            for (let i = 0; i < wall.length - 1; i++) {
                const p1 = wall[i];
                const p2 = wall[i + 1];
                const dx = (p2.x - p1.x) * scaleX;
                const dy = (p2.y - p1.y) * scaleY;
                // In screen space (+Y down), outward normal is (dy, -dx). Flat floor has dy ~ 0 and dx > 0 (ny < 0)
                if (dx >= 28 && Math.abs(dy) <= 2.0) {
                    this.recessedFlatPlatforms.push({
                        x: (p1.x + p2.x) * 0.5 * scaleX,
                        y: (p1.y + p2.y) * 0.5 * scaleY
                    });
                }
            }
        }
    }

    drawRecessed(ctx, camera, viewW, viewH, level) {
        const cfg = RENDER_CONFIG.rock;
        if (!cfg.recessedEnabled) return;
        if (level && this.builtForLevel !== level) {
            this.buildLevelCache(level);
        }
        if (!this.recessedCanvas) return;
        const nowMs = performance.now();
        const dtSec = this.lastRecessedTimeMs > 0 ? Math.min(0.05, Math.max(0.002, (nowMs - this.lastRecessedTimeMs) * 0.001)) : (1 / 60);
        const dt60 = dtSec * 60.0;
        this.lastRecessedTimeMs = nowMs;
        const ox = camera.x * cfg.recessedParallax;
        const oy = camera.y * cfg.recessedParallax;
        ctx.save();
        if (cfg.recessedOpacity !== undefined) ctx.globalAlpha = cfg.recessedOpacity;
        const sx = Math.max(0, Math.floor(camera.x - ox));
        const sy = Math.max(0, Math.floor(camera.y - oy));
        const sw = Math.min(this.recessedCanvas.width - sx, viewW + 4);
        const sh = Math.min(this.recessedCanvas.height - sy, viewH + 4);
        if (sw > 0 && sh > 0) {
            ctx.drawImage(this.recessedCanvas, sx, sy, sw, sh, ox + sx, oy + sy, sw, sh);
        }
        if (cfg.recessedCataclysmsEnabled !== false) {
            this.updateAndDrawRecessedCataclysms(ctx, camera, viewW, viewH, ox, oy, level, cfg, dt60);
        }
        if (cfg.recessedGhostShipEnabled !== false) {
            this.updateAndDrawRecessedGhostShip(ctx, camera, viewW, viewH, ox, oy, cfg, dt60);
        }
        ctx.restore();
    }

    updateAndDrawRecessedCataclysms(ctx, camera, viewW, viewH, ox, oy, level, cfg, dt60 = 1.0) {
        const maxActive = cfg.recessedCataclysmMaxActive ?? 1;
        const spawnChance = cfg.recessedCataclysmSpawnChance ?? 0.00045;
        const baseAlpha = cfg.recessedCataclysmAlpha ?? 0.11;
        const baseSpeed = cfg.recessedCataclysmBaseSpeed ?? 0.38;
        const speedVar = cfg.recessedCataclysmSpeedVar ?? 0.22;
        const grav = cfg.recessedCataclysmGravity ?? 0.0022;
        const maxTrail = cfg.recessedCataclysmTrailLength ?? 42;
        const burnMult = cfg.recessedCataclysmBurnGlowMultiplier ?? 2.2;
        const emberChance = cfg.recessedCataclysmEmberShedChance ?? 0.22;

        if (this.cataclysms.length < maxActive && rollChance(spawnChance, dt60)) {
            const spawnX = camera.x + viewW * (0.15 + Math.random() * 0.70);
            const spawnY = camera.y + viewH * (0.05 + Math.random() * 0.35);
            const dirSign = Math.random() > 0.5 ? 1 : -1;
            const angle = (Math.PI * 0.5) + dirSign * (0.28 + Math.random() * 0.42);
            const speed = baseSpeed + Math.random() * speedVar;
            const isComet = Math.random() > 0.45;
            const maxLife = 220 + Math.floor(Math.random() * 140);
            this.cataclysms.push({
                x: spawnX - ox,
                y: spawnY - oy,
                vx: Math.cos(angle) * speed,
                maxLife,
                vy: Math.abs(Math.sin(angle)) * speed + 0.12,
                r: 4.0 + Math.random() * 2.5,
                life: maxLife * 2,
                maxLife: maxLife * 2,
                isComet,
                trail: []
            });
        }

        if (this.cataclysms.length === 0 && this.cataclysmDebris.length === 0) return;

        ctx.save();
        ctx.translate(ox, oy);
        ctx.globalCompositeOperation = 'source-over';

        for (let i = this.cataclysms.length - 1; i >= 0; i--) {
            const c = this.cataclysms[i];
            c.trail.push({ x: c.x, y: c.y });
            if (c.trail.length > maxTrail) c.trail.shift();

            c.x += c.vx * dt60;
            c.y += c.vy * dt60;
            c.vy += grav * dt60;
            c.life -= dt60;

            // Continuously shed slow-burning sparks/embers along the tail wake
            if (rollChance(emberChance, dt60) && this.cataclysmDebris.length < 64) {
                this.cataclysmDebris.push({
                    x: c.x + (Math.random() - 0.5) * c.r * 0.9,
                    y: c.y + (Math.random() - 0.5) * c.r * 0.9,
                    vx: -c.vx * (0.12 + Math.random() * 0.2) + (Math.random() - 0.5) * 0.14,
                    vy: -c.vy * (0.12 + Math.random() * 0.2) - 0.05 + (Math.random() - 0.5) * 0.14,
                    r: 1.0 + Math.random() * 1.4,
                    life: 48 + Math.floor(Math.random() * 36),
                    maxLife: 84,
                    isComet: c.isComet
                });
            }

            // Check approximate collision against recessed cavern boundary
            let hitWall = c.life <= 0;
            if (!hitWall && level?.highRes?.recessedWalls) {
                const scaleX = level.highRes.recessedWidth ? (level.width / level.highRes.recessedWidth) : 1.0;
                const scaleY = level.highRes.recessedHeight ? (level.height / level.highRes.recessedHeight) : 1.0;
                const walls = level.highRes.recessedWalls;
                for (let w = 0; w < walls.length && !hitWall; w++) {
                    const loop = walls[w];
                    for (let k = 0; k < loop.length; k += 4) {
                        const wx = loop[k].x * scaleX;
                        const wy = loop[k].y * scaleY;
                        if (Math.abs(c.x - wx) < 18 && Math.abs(c.y - wy) < 18) {
                            hitWall = true;
                            break;
                        }
                    }
                }
            }

            if (hitWall) {
                // Stamp subtle faded crater onto recessed wall and scatter slow background embers
                if (this.recessedCanvas) {
                    const bCtx = this.recessedCanvas.getContext('2d');
                    bCtx.save();
                    bCtx.globalCompositeOperation = 'source-atop';
                    const cg = bCtx.createRadialGradient(c.x, c.y, 2, c.x, c.y, c.r * 5.5);
                    cg.addColorStop(0, 'rgba(255, 110, 40, 0.14)');
                    cg.addColorStop(0.5, 'rgba(10, 6, 4, 0.28)');
                    cg.addColorStop(1, 'rgba(0, 0, 0, 0)');
                    bCtx.fillStyle = cg;
                    bCtx.beginPath();
                    bCtx.arc(c.x, c.y, c.r * 5.5, 0, Math.PI * 2);
                    bCtx.fill();
                    bCtx.restore();
                }
                for (let d = 0; d < 10 && this.cataclysmDebris.length < 36; d++) {
                    const ang = Math.random() * Math.PI * 2;
                    const spd = 0.18 + Math.random() * 0.55;
                    this.cataclysmDebris.push({
                        x: c.x,
                        y: c.y,
                        vx: Math.cos(ang) * spd - c.vx * 0.15,
                        vy: Math.sin(ang) * spd - Math.abs(c.vy) * 0.2,
                        r: 1.2 + Math.random() * 1.8,
                        life: 65 + Math.floor(Math.random() * 45),
                        maxLife: 110,
                        isComet: c.isComet
                    });
                }
                this.cataclysms.splice(i, 1);
                continue;
            }

            // Draw long smoldering meteor tail with outer burn envelope + hot inner core
            for (let t = 0; t < c.trail.length; t++) {
                const ratio = (t + 1) / c.trail.length;
                const jitterX = Math.sin(t * 1.7 + c.life * 0.08) * (1 - ratio) * 1.2;
                const jitterY = Math.cos(t * 1.3 - c.life * 0.06) * (1 - ratio) * 1.2;
                const tx = c.trail[t].x + jitterX;
                const ty = c.trail[t].y + jitterY;

                ctx.globalAlpha = Math.pow(ratio, 1.35) * baseAlpha * 0.35;
                ctx.fillStyle = c.isComet ? '#2b4c66' : '#593325';
                ctx.beginPath();
                ctx.arc(tx, ty, c.r * (0.55 + ratio * 1.15), 0, Math.PI * 2);
                ctx.fill();

                ctx.globalAlpha = Math.pow(ratio, 1.8) * baseAlpha * 0.65;
                ctx.fillStyle = c.isComet ? '#567d99' : '#8a563c';
                ctx.beginPath();
                ctx.arc(tx, ty, c.r * ratio * 0.75, 0, Math.PI * 2);
                ctx.fill();
            }

            // Draw wide atmospheric burn halo around fireball head
            const burnR = c.r * burnMult;
            const halo = ctx.createRadialGradient(c.x, c.y, c.r * 0.2, c.x, c.y, burnR);
            halo.addColorStop(0, c.isComet ? `rgba(105, 145, 175, ${baseAlpha * 0.65})` : `rgba(155, 105, 75, ${baseAlpha * 0.65})`);
            halo.addColorStop(0.45, c.isComet ? `rgba(55, 85, 115, ${baseAlpha * 0.30})` : `rgba(95, 55, 40, ${baseAlpha * 0.30})`);
            halo.addColorStop(1, 'rgba(0, 0, 0, 0)');
            ctx.globalAlpha = 1.0;
            ctx.fillStyle = halo;
            ctx.beginPath();
            ctx.arc(c.x, c.y, burnR, 0, Math.PI * 2);
            ctx.fill();

            // Draw glowing core
            ctx.globalAlpha = baseAlpha * 0.85;
            ctx.fillStyle = c.isComet ? '#9bb8cc' : '#bfa082';
            ctx.beginPath();
            ctx.arc(c.x, c.y, c.r, 0, Math.PI * 2);
            ctx.fill();
        }

        for (let i = this.cataclysmDebris.length - 1; i >= 0; i--) {
            const d = this.cataclysmDebris[i];
            d.x += d.vx * dt60;
            d.y += d.vy * dt60;
            d.vy += grav * 1.4 * dt60;
            d.vx *= Math.pow(0.985, dt60);
            d.life -= dt60;
            if (d.life <= 0) {
                this.cataclysmDebris.splice(i, 1);
                continue;
            }
            ctx.globalAlpha = (d.life / d.maxLife) * baseAlpha * 0.75;
            ctx.fillStyle = d.isComet ? '#6c8ea6' : '#8c6249';
            ctx.beginPath();
            ctx.arc(d.x, d.y, d.r, 0, Math.PI * 2);
            ctx.fill();
        }

        ctx.restore();
    }

    updateAndDrawRecessedGhostShip(ctx, camera, viewW, viewH, ox, oy, cfg, dt60 = 1.0) {
        if (this.recessedFlatPlatforms.length === 0) return;
        const maxAlpha = cfg.recessedGhostShipMaxAlpha ?? 0.14;
        const spawnChance = cfg.recessedGhostShipSpawnChance ?? 0.0005;

        if (!this.ghostShip && rollChance(spawnChance, dt60)) {
            // Pick a flat platform visible within the current camera view
            const visiblePads = this.recessedFlatPlatforms.filter(p => {
                const wx = p.x + ox;
                const wy = p.y + oy;
                return wx > camera.x + 120 && wx < camera.x + viewW - 120 &&
                       wy > camera.y + 140 && wy < camera.y + viewH - 80;
            });
            if (visiblePads.length > 0) {
                const pad = visiblePads[Math.floor(Math.random() * visiblePads.length)];
                this.ghostShip = {
                    padX: pad.x,
                    padY: pad.y - 8,
                    x: pad.x + (Math.random() - 0.5) * 40,
                    y: pad.y - 95,
                    angle: -Math.PI / 2,
                    state: 'landing', // 'landing' -> 'idling' -> 'logging_out'
                    timer: 0,
                    idleDuration: 180 + Math.floor(Math.random() * 140),
                    alpha: 0
                };
            }
        }

        if (!this.ghostShip) return;
        const g = this.ghostShip;
        g.timer += dt60;

        if (g.state === 'landing') {
            g.alpha = Math.min(maxAlpha, g.alpha + 0.003 * dt60);
            g.x += (g.padX - g.x) * (1 - Math.pow(0.96, dt60));
            g.y += (g.padY - g.y) * (1 - Math.pow(0.965, dt60));
            g.angle = -Math.PI / 2 + (g.padX - g.x) * 0.015;
            if (Math.abs(g.y - g.padY) < 1.2) {
                g.y = g.padY;
                g.angle = -Math.PI / 2;
                g.state = 'idling';
                g.timer = 0;
            }
        } else if (g.state === 'idling') {
            g.alpha = maxAlpha;
            if (g.timer >= g.idleDuration) {
                g.state = 'logging_out';
                g.timer = 0;
            }
        } else if (g.state === 'logging_out') {
            g.alpha = Math.max(0, maxAlpha * (1 - g.timer / 45));
            if (g.timer >= 45) {
                this.ghostShip = null;
                return;
            }
        }

        ctx.save();
        ctx.translate(ox + g.x, oy + g.y);
        ctx.scale(0.55, 0.55); // Background depth scale
        ctx.globalAlpha = g.alpha;

        if (g.state === 'logging_out') {
            // Faint vertical quantum-despawn beam ("log out" effect)
            ctx.fillStyle = 'rgba(130, 210, 255, 0.45)';
            ctx.fillRect(-10 * (1 - g.timer / 45), -70, 20 * (1 - g.timer / 45), 82);
        }

        ctx.rotate(g.angle);
        ctx.strokeStyle = '#7f9eb2';
        ctx.fillStyle = '#121822';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(16, 0);
        ctx.lineTo(-16, 11.2);
        ctx.lineTo(-8, 0);
        ctx.lineTo(-16, -11.2);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        if (g.state === 'landing') {
            ctx.fillStyle = 'rgba(130, 210, 255, 0.65)';
            ctx.beginPath();
            ctx.moveTo(-8, -2);
            ctx.lineTo(-18 - Math.random() * 6, 0);
            ctx.lineTo(-8, 2);
            ctx.fill();
        }
        ctx.restore();
    }

    draw(ctx, camera, viewW, viewH) {
        if (this.cachedCanvas) {
            const sx = Math.max(0, Math.floor(camera.x));
            const sy = Math.max(0, Math.floor(camera.y));
            const sw = Math.min(this.cachedCanvas.width - sx, viewW + 2);
            const sh = Math.min(this.cachedCanvas.height - sy, viewH + 2);
            if (sw > 0 && sh > 0) {
                ctx.drawImage(this.cachedCanvas, sx, sy, sw, sh, sx, sy, sw, sh);
            }
        }
    }

    stampScorch(x, y, radius = 6, alpha = 0.25) {
        if (!this.cachedCanvas) return;
        const ctx = this.cachedCanvas.getContext('2d');
        ctx.save();
        // source-atop ensures scorch/soot only paints onto existing rock pixels and NEVER into transparent sky!
        ctx.globalCompositeOperation = 'source-atop';
        const g = ctx.createRadialGradient(x, y, 1, x, y, radius);
        g.addColorStop(0, `rgba(8, 5, 4, ${alpha})`);
        g.addColorStop(1, 'rgba(8, 5, 4, 0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
    }

    stampBlastCrater(x, y, radius = 38, alpha = 0.72, rayCount = 14) {
        if (!this.cachedCanvas) return;
        const ctx = this.cachedCanvas.getContext('2d');
        ctx.save();
        // Strictly clip to existing rock pixels so mid-air explosions only stain adjacent rock walls
        ctx.globalCompositeOperation = 'source-atop';

        // 1. Deep carbonized core & outer soot gradient
        const g = ctx.createRadialGradient(x, y, radius * 0.08, x, y, radius);
        g.addColorStop(0, `rgba(4, 3, 2, ${Math.min(0.95, alpha * 1.15)})`);
        g.addColorStop(0.45, `rgba(12, 8, 6, ${alpha * 0.75})`);
        g.addColorStop(0.8, `rgba(22, 15, 11, ${alpha * 0.3})`);
        g.addColorStop(1, 'rgba(12, 8, 6, 0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, Math.PI * 2);
        ctx.fill();

        // 2. Jagged radial blast-soot streaks & fracture lines
        ctx.lineCap = 'round';
        for (let i = 0; i < rayCount; i++) {
            const angle = (i / rayCount) * Math.PI * 2 + (Math.random() - 0.5) * 0.35;
            const len = radius * (0.55 + Math.random() * 0.65);
            ctx.strokeStyle = `rgba(6, 4, 3, ${alpha * (0.35 + Math.random() * 0.4)})`;
            ctx.lineWidth = 1.4 + Math.random() * 2.4;
            ctx.beginPath();
            ctx.moveTo(x + Math.cos(angle) * 3, y + Math.sin(angle) * 3);
            ctx.lineTo(x + Math.cos(angle) * len, y + Math.sin(angle) * len);
            ctx.stroke();
        }

        // 3. Outer spatter droplets
        ctx.fillStyle = `rgba(8, 5, 4, ${alpha * 0.65})`;
        for (let i = 0; i < rayCount; i++) {
            const angle = Math.random() * Math.PI * 2;
            const dist = radius * (0.35 + Math.random() * 0.75);
            const r = 1.2 + Math.random() * 2.6;
            ctx.beginPath();
            ctx.arc(x + Math.cos(angle) * dist, y + Math.sin(angle) * dist, r, 0, Math.PI * 2);
            ctx.fill();
        }

        ctx.restore();
    }
}
