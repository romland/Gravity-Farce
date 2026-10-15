import { RENDER_CONFIG } from './RenderConfig.js';

export class ParallaxLayer {
    constructor(viewW, viewH) {
        this.viewW = viewW;
        this.viewH = viewH;
        this.pillars = [];
        this.motes = [];
        this.nebulas = [];
        this.godRays = [];
        this.pillarSprites = [];
        this.initProceduralBackdrop();
    }

    createCraggyMonolithSprite(rng, isFar) {
        if (typeof document === 'undefined') return null;
        const sw = 240;
        const sh = 640;
        const canvas = document.createElement('canvas');
        canvas.width = sw;
        canvas.height = sh;
        const ctx = canvas.getContext('2d');

        const steps = 16;
        const leftPts = [];
        const rightPts = [];
        const midPts = [];

        for (let i = 0; i <= steps; i++) {
            const t = i / steps;
            const y = t * sh;
            // Hourglass tectonic column profile with craggy jagged ledges
            const waist = 0.42 + 0.58 * Math.pow(Math.abs(t - 0.5) * 2, 1.35);
            const jagL = (rng() - 0.5) * 28;
            const jagR = (rng() - 0.5) * 28;
            const halfW = Math.max(18, (sw * 0.42) * waist);
            const lx = Math.max(4, sw * 0.5 - halfW + jagL);
            const rx = Math.min(sw - 4, sw * 0.5 + halfW + jagR);
            leftPts.push({ x: lx, y });
            rightPts.push({ x: rx, y });
            midPts.push({ x: (lx + rx) * 0.5 + (rng() - 0.5) * 18, y });
        }

        // West-facing lit basalt face
        const litGrad = ctx.createLinearGradient(0, 0, sw, 0);
        litGrad.addColorStop(0, isFar ? '#162033' : '#1e2b42');
        litGrad.addColorStop(1, isFar ? '#0c121f' : '#111829');
        ctx.fillStyle = litGrad;
        ctx.beginPath();
        ctx.moveTo(leftPts[0].x, leftPts[0].y);
        for (let i = 1; i <= steps; i++) ctx.lineTo(leftPts[i].x, leftPts[i].y);
        for (let i = steps; i >= 0; i--) ctx.lineTo(rightPts[i].x, rightPts[i].y);
        ctx.closePath();
        ctx.fill();

        // East-facing deep shadow facet
        ctx.fillStyle = isFar ? 'rgba(6, 9, 16, 0.55)' : 'rgba(7, 10, 18, 0.68)';
        ctx.beginPath();
        ctx.moveTo(midPts[0].x, midPts[0].y);
        for (let i = 1; i <= steps; i++) ctx.lineTo(midPts[i].x, midPts[i].y);
        for (let i = steps; i >= 0; i--) ctx.lineTo(rightPts[i].x, rightPts[i].y);
        ctx.closePath();
        ctx.fill();

        // Crisp rim highlight along the western crag edge & central spine
        ctx.strokeStyle = isFar ? 'rgba(79, 172, 254, 0.10)' : 'rgba(110, 195, 255, 0.16)';
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.moveTo(leftPts[0].x, leftPts[0].y);
        for (let i = 1; i <= steps; i++) ctx.lineTo(leftPts[i].x, leftPts[i].y);
        ctx.stroke();

        // Top & bottom atmospheric fade so pillars blend seamlessly into the cavern abyss
        ctx.globalCompositeOperation = 'destination-in';
        const maskGrad = ctx.createLinearGradient(0, 0, 0, sh);
        maskGrad.addColorStop(0, 'rgba(0,0,0,0)');
        maskGrad.addColorStop(0.18, 'rgba(0,0,0,1)');
        maskGrad.addColorStop(0.82, 'rgba(0,0,0,1)');
        maskGrad.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = maskGrad;
        ctx.fillRect(0, 0, sw, sh);
        ctx.globalCompositeOperation = 'source-over';

        return canvas;
    }

    initProceduralBackdrop() {
        let seed = 1337;
        const rng = () => {
            seed = (seed * 16807) % 2147483647;
            return (seed - 1) / 2147483646;
        };
        const cfg = RENDER_CONFIG.parallax;

        const nebulaPalettes = [
            ['rgba(88, 42, 168, 0.22)', 'rgba(32, 84, 188, 0.10)', 'rgba(10, 16, 34, 0)'],
            ['rgba(24, 128, 168, 0.20)', 'rgba(18, 178, 132, 0.09)', 'rgba(8, 20, 30, 0)'],
            ['rgba(162, 42, 118, 0.16)', 'rgba(72, 38, 140, 0.08)', 'rgba(10, 12, 26, 0)'],
            ['rgba(40, 95, 205, 0.20)', 'rgba(90, 40, 165, 0.09)', 'rgba(8, 12, 24, 0)']
        ];

        const nebulaCount = cfg.nebulaCount || 7;
        for (let i = 0; i < nebulaCount; i++) {
            const pal = nebulaPalettes[i % nebulaPalettes.length];
            const spriteSize = 512;
            const nCanvas = typeof document !== 'undefined' ? document.createElement('canvas') : null;
            if (nCanvas) {
                nCanvas.width = spriteSize;
                nCanvas.height = spriteSize;
                const nCtx = nCanvas.getContext('2d');
                for (let L = 0; L < 4; L++) {
                    const ox = spriteSize * (0.35 + rng() * 0.3);
                    const oy = spriteSize * (0.35 + rng() * 0.3);
                    const rad = spriteSize * (0.28 + rng() * 0.2);
                    const g = nCtx.createRadialGradient(ox, oy, rad * 0.08, ox, oy, rad);
                    g.addColorStop(0, pal[0]);
                    g.addColorStop(0.55, pal[1]);
                    g.addColorStop(1, pal[2]);
                    nCtx.fillStyle = g;
                    nCtx.beginPath();
                    nCtx.arc(ox, oy, rad, 0, Math.PI * 2);
                    nCtx.fill();
                }
            }
            this.nebulas.push({
                x: rng() * 3200,
                y: rng() * 2800,
                w: 680 + rng() * 620,
                h: 480 + rng() * 480,
                depth: (cfg.nebulaParallax || 0.12) * (0.75 + rng() * 0.5),
                driftX: (rng() - 0.5) * 4.5,
                driftY: (rng() - 0.5) * 3.0,
                phase: rng() * Math.PI * 2,
                sprite: nCanvas
            });
        }

        for (let s = 0; s < 6; s++) {
            this.pillarSprites.push(this.createCraggyMonolithSprite(rng, s % 2 === 0));
        }

        for (let i = 0; i < cfg.pillarCount; i++) {
            const isFar = i % 2 === 0;
            this.pillars.push({
                x: rng() * 2600,
                y: rng() * 3600,
                w: 90 + rng() * 220,
                h: 300 + rng() * 700,
                depth: isFar ? cfg.farPillarDepth : cfg.nearPillarDepth,
                sprite: this.pillarSprites[(isFar ? 0 : 1) + (i % 3) * 2]
            });
        }

        for (let i = 0; i < 6; i++) {
            this.godRays.push({
                x: rng() * 2400,
                width: 90 + rng() * 140,
                phase: rng() * Math.PI * 2,
                speed: 0.25 + rng() * 0.35,
                color: i % 2 === 0 ? 'rgba(79, 195, 255, 0.038)' : 'rgba(110, 255, 190, 0.032)'
            });
        }

        for (let i = 0; i < cfg.moteCount; i++) {
            this.motes.push({
                x: rng() * 2000,
                y: rng() * 2000,
                r: 1.2 + rng() * 2.2,
                speed: 0.15 + rng() * 0.35,
                phase: rng() * Math.PI * 2,
                color: rng() > 0.45
                    ? 'rgba(79, 172, 254, 0.38)'
                    : (rng() > 0.2 ? 'rgba(120, 255, 170, 0.35)' : 'rgba(255, 190, 95, 0.35)')
            });
        }
    }

    draw(ctx, camera, timeSec) {
        const cfg = RENDER_CONFIG.parallax;
        // Layer -3: Deep Subterranean Void Gradient
        const grad = ctx.createLinearGradient(0, 0, 0, this.viewH);
        grad.addColorStop(0, '#070910');
        grad.addColorStop(0.5, '#0c111d');
        grad.addColorStop(1, '#080b14');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, this.viewW, this.viewH);
        if (!cfg.enabled) return;

        ctx.save();

        // Layer -2.5: Subtle Volumetric Nebula / Subterranean Ionized Gas Clouds
        if (cfg.nebulaEnabled !== false) {
            const nebWrapW = 3200;
            const nebWrapH = 2800;
            const nebOpacity = cfg.nebulaOpacity ?? 0.45;
            ctx.globalCompositeOperation = 'screen';
            for (const n of this.nebulas) {
                if (!n.sprite) continue;
                const nx = ((n.x + timeSec * n.driftX - camera.x * n.depth + 600) % nebWrapW + nebWrapW) % nebWrapW - 600;
                const ny = ((n.y + timeSec * n.driftY - camera.y * n.depth + 500) % nebWrapH + nebWrapH) % nebWrapH - 500;
                if (nx + n.w < 0 || nx > this.viewW || ny + n.h < 0 || ny > this.viewH) continue;
                const pulse = 0.78 + 0.22 * Math.sin(timeSec * 0.45 + n.phase);
                ctx.globalAlpha = pulse * nebOpacity;
                ctx.drawImage(n.sprite, nx, ny, n.w, n.h);
            }
            ctx.globalAlpha = 1.0;
            ctx.globalCompositeOperation = 'source-over';
        }

        // Layer -2: Distant Mega-Cavern Pillars (0.18x and 0.32x Parallax)
        const wrapW = 2600;
        const wrapH = 3600;
        for (const p of this.pillars) {
            const sx = ((p.x - camera.x * p.depth + 400) % wrapW + wrapW) % wrapW - 400;
            const sy = ((p.y - camera.y * p.depth + 750) % wrapH + wrapH) % wrapH - 750;
            if (sx + p.w < 0 || sx > this.viewW || sy + p.h < 0 || sy > this.viewH) continue;

            if (p.sprite) {
                ctx.drawImage(p.sprite, sx, sy, p.w, p.h);
            }
        }

        // Layer -1.5: Subterranean Atmospheric Mist & Diagonal Shimmering God-Rays
        if (cfg.godRaysEnabled !== false) {
            ctx.globalCompositeOperation = 'screen';
            const rayWrapW = 2400;
            const rayOpacity = cfg.godRayOpacity ?? 0.40;
            for (const ray of this.godRays) {
                const rx = ((ray.x + Math.sin(timeSec * ray.speed + ray.phase) * 55 - camera.x * 0.24 + 300) % rayWrapW + rayWrapW) % rayWrapW - 300;
                const shimmer = 0.55 + 0.45 * Math.sin(timeSec * 0.7 + ray.phase);
                ctx.globalAlpha = shimmer * rayOpacity;
                ctx.fillStyle = ray.color;
                ctx.beginPath();
                ctx.moveTo(rx, 0);
                ctx.lineTo(rx + ray.width, 0);
                ctx.lineTo(rx + ray.width + 240, this.viewH);
                ctx.lineTo(rx + 240, this.viewH);
                ctx.closePath();
                ctx.fill();
            }
            ctx.globalAlpha = 1.0;
            ctx.globalCompositeOperation = 'source-over';
        }

        // Ambient Bioluminescent Spores (0.5x Parallax)
        const moteW = this.viewW + 60;
        const moteH = this.viewH + 60;
        ctx.globalCompositeOperation = 'lighter';
        for (const m of this.motes) {
            const mx = ((m.x + Math.sin(timeSec * 0.6 + m.phase) * 20 - camera.x * cfg.moteParallax + 30) % moteW + moteW) % moteW - 30;
            const my = ((m.y - timeSec * 12 * m.speed - camera.y * cfg.moteParallax + 30) % moteH + moteH) % moteH - 30;
            const twinkle = 0.5 + 0.5 * Math.sin(timeSec * 2.4 + m.phase);
            ctx.globalAlpha = 0.45 + twinkle * 0.55;
            ctx.fillStyle = m.color;
            ctx.beginPath();
            ctx.arc(mx, my, m.r * (0.85 + twinkle * 0.4), 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.restore();
    }
}
