import { RENDER_CONFIG } from './RenderConfig.js';

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
}

export class RockLayer {
    constructor() {
        this.cachedCanvas = null;
        this.recessedCanvas = null;
        this.builtForLevel = null;
    }

    buildLevelCache(level) {
        if (!level || !level.walls || level.walls.length === 0) return;
        const cfg = RENDER_CONFIG.rock;
        this.builtForLevel = level;

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

        // Crisp Outer Rim Highlight (Drawn along the exact same polygon path — zero drift!)
        ctx.save();
        traceAllLoops(ctx);
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';
        ctx.strokeStyle = cfg.outerOutlineColor;
        ctx.lineWidth = cfg.outerOutlineWidth;
        ctx.stroke();
        ctx.restore();

        // Draw Teal Bricks accurately based on their partial 16x16 layout
        if (level.rawMap) {
            const drawSubBrick = (bx, by) => {
                ctx.fillStyle = '#105b64';
                ctx.fillRect(bx, by, 16, 16);
                ctx.fillStyle = '#136f7a';
                ctx.strokeStyle = '#0a3d43';
                ctx.lineWidth = 1;
                ctx.fillRect(bx + 1, by + 1, 14, 14);
                ctx.strokeRect(bx + 1, by + 1, 14, 14);
                ctx.fillStyle = '#2cb1bf';
                ctx.fillRect(bx + 2, by + 2, 12, 2);
            };

            for (let y = 0; y < level.rawMap.length; y++) {
                for (let x = 0; x < level.rawMap[y].length; x++) {
                    const tid = level.rawMap[y][x];
                    const layout = TEAL_BRICK_LAYOUTS[tid];
                    if (layout) {
                        const px = x * 32;
                        const py = y * 32;
                        if (layout[0]) drawSubBrick(px, py);           // TL
                        if (layout[1]) drawSubBrick(px + 16, py);      // TR
                        if (layout[2]) drawSubBrick(px, py + 16);      // BL
                        if (layout[3]) drawSubBrick(px + 16, py + 16); // BR
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
    }

    drawRecessed(ctx, camera, viewW, viewH, level) {
        const cfg = RENDER_CONFIG.rock;
        if (!cfg.recessedEnabled) return;
        if (level && this.builtForLevel !== level) {
            this.buildLevelCache(level);
        }
        if (!this.recessedCanvas) return;
        const ox = camera.x * cfg.recessedParallax;
        const oy = camera.y * cfg.recessedParallax;
        ctx.save();
        if (cfg.recessedOpacity !== undefined) ctx.globalAlpha = cfg.recessedOpacity;
        ctx.drawImage(this.recessedCanvas, ox, oy);
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
