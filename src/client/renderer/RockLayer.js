import { RENDER_CONFIG } from './RenderConfig.js';

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

        // Procedural Subterranean Strata Striations inside the rock
        ctx.fillStyle = cfg.strataColor;
        for (let y = 0; y < h; y += cfg.strataStepY) {
            ctx.fillRect(0, y, w, cfg.strataHeight);
        }

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

        this.cachedCanvas = canvas;

        // 2. Build Layer -1: Recessed Cavern Back-Wall Shell (0.65x Parallax)
        const backCanvas = document.createElement('canvas');
        backCanvas.width = w;
        backCanvas.height = h;
        const bCtx = backCanvas.getContext('2d');

        bCtx.save();
        traceRockVolume(bCtx);
        bCtx.clip('evenodd');
        bCtx.fillStyle = 'rgba(14, 18, 28, 0.82)';
        bCtx.fillRect(0, 0, w, h);

        traceAllLoops(bCtx);
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
}
