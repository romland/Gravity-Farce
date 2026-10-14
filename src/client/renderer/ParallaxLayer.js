import { RENDER_CONFIG } from './RenderConfig.js';

export class ParallaxLayer {
    constructor(viewW, viewH) {
        this.viewW = viewW;
        this.viewH = viewH;
        this.pillars = [];
        this.motes = [];
        this.initProceduralBackdrop();
    }

    initProceduralBackdrop() {
        let seed = 1337;
        const rng = () => {
            seed = (seed * 16807) % 2147483647;
            return (seed - 1) / 2147483646;
        };
        const cfg = RENDER_CONFIG.parallax;

        for (let i = 0; i < cfg.pillarCount; i++) {
            this.pillars.push({
                x: rng() * 2600,
                y: rng() * 3600,
                w: 90 + rng() * 220,
                h: 300 + rng() * 700,
                depth: i % 2 === 0 ? cfg.farPillarDepth : cfg.nearPillarDepth
            });
        }

        for (let i = 0; i < cfg.moteCount; i++) {
            this.motes.push({
                x: rng() * 2000,
                y: rng() * 2000,
                r: 1.2 + rng() * 2.2,
                speed: 0.15 + rng() * 0.35,
                phase: rng() * Math.PI * 2,
                color: rng() > 0.4 ? 'rgba(79, 172, 254, 0.28)' : 'rgba(120, 255, 170, 0.25)'
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

        // Layer -2: Distant Mega-Cavern Pillars (0.18x and 0.32x Parallax)
        ctx.save();
        const wrapW = 2600;
        const wrapH = 3600;
        for (const p of this.pillars) {
            const sx = ((p.x - camera.x * p.depth + 400) % wrapW + wrapW) % wrapW - 400;
            const sy = ((p.y - camera.y * p.depth + 750) % wrapH + wrapH) % wrapH - 750;
            if (sx + p.w < 0 || sx > this.viewW || sy + p.h < 0 || sy > this.viewH) continue;

            ctx.fillStyle = p.depth < 0.25 ? '#0f1624' : '#141d2f';
            ctx.beginPath();
            ctx.ellipse(sx + p.w * 0.5, sy + p.h * 0.5, p.w * 0.5, p.h * 0.5, 0, 0, Math.PI * 2);
            ctx.fill();
        }

        // Ambient Bioluminescent Spores (0.5x Parallax)
        const moteW = this.viewW + 60;
        const moteH = this.viewH + 60;
        for (const m of this.motes) {
            const mx = ((m.x + Math.sin(timeSec * 0.6 + m.phase) * 20 - camera.x * cfg.moteParallax + 30) % moteW + moteW) % moteW - 30;
            const my = ((m.y - timeSec * 12 * m.speed - camera.y * cfg.moteParallax + 30) % moteH + moteH) % moteH - 30;
            ctx.fillStyle = m.color;
            ctx.beginPath();
            ctx.arc(mx, my, m.r, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.restore();
    }
}