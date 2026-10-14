export class PrefabLayer {
    draw(ctx, level, timeSec) {
        const prefabs = level?.highRes?.prefabs;
        if (!prefabs) return;

        for (const p of prefabs) {
            if (p.kind === 'PAD') {
                this.drawLandingPad(ctx, p, timeSec);
            } else if (p.kind === 'TEAL_BRICK') {
                this.drawTealBrick(ctx, p);
            } else if (p.kind === 'BASE_STRUCTURE') {
                this.drawBaseStructure(ctx, p, timeSec);
            } else if (p.kind === 'BARREL_STACK') {
                this.drawBarrelStack(ctx, p);
            } else if (p.kind === 'GRAVITY_EMITTER') {
                this.drawGravityEmitter(ctx, p, timeSec);
            } else if (p.kind === 'ANTENNA_MAST') {
                this.drawAntennaMast(ctx, p, timeSec);
            }
        }
    }

    drawLandingPad(ctx, p, timeSec) {
        ctx.save();
        const deckH = 12;
        // Sub-structure truss
        ctx.fillStyle = '#1b222c';
        ctx.strokeStyle = '#384454';
        ctx.lineWidth = 1.5;
        ctx.fillRect(p.x, p.y, p.w, p.h);
        ctx.strokeRect(p.x, p.y, p.w, p.h);

        // 3-Slice Metallic Top Deck
        const grad = ctx.createLinearGradient(p.x, p.y, p.x, p.y + deckH);
        grad.addColorStop(0, '#d0dae5');
        grad.addColorStop(0.5, '#8a99ad');
        grad.addColorStop(1, '#495464');
        ctx.fillStyle = grad;
        ctx.fillRect(p.x, p.y, p.w, deckH);

        // Sequenced Runway Approach Lights
        const isHome = p.tileId === 0x15;
        const numLights = Math.max(2, Math.floor(p.w / 24));
        for (let i = 0; i < numLights; i++) {
            const lx = p.x + 12 + i * ((p.w - 24) / Math.max(1, numLights - 1));
            const pulse = 0.5 + 0.5 * Math.sin(timeSec * 6 - i * 0.9);
            ctx.fillStyle = isHome
                ? `rgba(46, 255, 130, ${0.4 + pulse * 0.6})`
                : `rgba(255, 200, 50, ${0.4 + pulse * 0.6})`;
            ctx.fillRect(lx - 4, p.y + 3, 8, 4);
        }
        ctx.restore();
    }

    drawTealBrick(ctx, p) {
        ctx.save();
        ctx.fillStyle = '#136f7a';
        ctx.strokeStyle = '#2cb1bf';
        ctx.lineWidth = 2;
        ctx.fillRect(p.x + 1, p.y + 1, p.w - 2, p.h - 2);
        ctx.strokeRect(p.x + 1, p.y + 1, p.w - 2, p.h - 2);

        // Riveted internal grid cells
        ctx.strokeStyle = 'rgba(10, 45, 52, 0.75)';
        ctx.lineWidth = 1;
        for (let x = p.x + 32; x < p.x + p.w; x += 32) {
            ctx.beginPath();
            ctx.moveTo(x, p.y);
            ctx.lineTo(x, p.y + p.h);
            ctx.stroke();
        }
        for (let y = p.y + 32; y < p.y + p.h; y += 32) {
            ctx.beginPath();
            ctx.moveTo(p.x, y);
            ctx.lineTo(p.x + p.w, y);
            ctx.stroke();
        }
        ctx.restore();
    }

    drawBaseStructure(ctx, p, timeSec) {
        ctx.save();
        const grad = ctx.createLinearGradient(p.x, p.y, p.x, p.y + p.h);
        grad.addColorStop(0, '#2b3945');
        grad.addColorStop(1, '#161e26');
        ctx.fillStyle = grad;
        ctx.strokeStyle = '#4a6278';
        ctx.lineWidth = 2;
        ctx.fillRect(p.x, p.y, p.w, p.h);
        ctx.strokeRect(p.x, p.y, p.w, p.h);

        // Illuminated Command Bay Windows
        const glow = 0.7 + 0.3 * Math.sin(timeSec * 2.5);
        ctx.fillStyle = `rgba(100, 220, 255, ${glow})`;
        for (let wy = p.y + 8; wy < p.y + p.h - 10; wy += 16) {
            for (let wx = p.x + 8; wx < p.x + p.w - 12; wx += 20) {
                ctx.fillRect(wx, wy, 12, 6);
            }
        }
        ctx.restore();
    }

    drawBarrelStack(ctx, p) {
        ctx.save();
        ctx.fillStyle = '#1b5e68';
        ctx.strokeStyle = '#38b2c4';
        ctx.lineWidth = 1.5;
        for (let y = p.y; y < p.y + p.h; y += 16) {
            for (let x = p.x; x < p.x + p.w; x += 16) {
                ctx.fillRect(x + 2, y + 2, 12, 12);
                ctx.strokeRect(x + 2, y + 2, 12, 12);
            }
        }
        ctx.restore();
    }

    drawGravityEmitter(ctx, p, timeSec) {
        ctx.save();
        const pulse = 0.5 + 0.5 * Math.sin(timeSec * 8);
        ctx.fillStyle = '#1f2438';
        ctx.strokeStyle = `rgba(180, 100, 255, ${0.5 + pulse * 0.5})`;
        ctx.lineWidth = 2;
        ctx.fillRect(p.x, p.y, p.w, p.h);
        ctx.strokeRect(p.x, p.y, p.w, p.h);
        ctx.restore();
    }

    drawAntennaMast(ctx, p, timeSec) {
        ctx.save();
        const cx = p.x + p.w * 0.5;
        ctx.strokeStyle = '#7f8c8d';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(cx, p.y + p.h);
        ctx.lineTo(cx, p.y + 6);
        ctx.stroke();

        // Blinking warning beacon
        if (Math.sin(timeSec * 7 + p.x) > 0) {
            ctx.fillStyle = '#ff3b30';
            ctx.shadowColor = '#ff3b30';
            ctx.shadowBlur = 10;
            ctx.beginPath();
            ctx.arc(cx, p.y + 6, 4, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.restore();
    }
}