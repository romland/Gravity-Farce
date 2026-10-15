import { RENDER_CONFIG } from './RenderConfig.js';

class EnvironmentalLightBaker {
    static buildStaticLightCanvas(level) {
        if (!level || !RENDER_CONFIG.lighting?.enabled) return null;
        const lCfg = RENDER_CONFIG.lighting;
        const scale = lCfg.scale || 0.25;
        const lw = Math.max(1, Math.ceil(level.width * scale));
        const lh = Math.max(1, Math.ceil(level.height * scale));

        const canvas = document.createElement('canvas');
        canvas.width = lw;
        canvas.height = lh;
        const ctx = canvas.getContext('2d');
        ctx.scale(scale, scale);
        ctx.globalCompositeOperation = 'lighter';

        const addRadialLight = (x, y, radius, r, gCol, b, alpha) => {
            if (!radius || radius <= 0 || !alpha || alpha <= 0) return;
            const g = ctx.createRadialGradient(x, y, radius * 0.04, x, y, radius);
            g.addColorStop(0, `rgba(${r}, ${gCol}, ${b}, ${alpha})`);
            g.addColorStop(0.45, `rgba(${r}, ${gCol}, ${b}, ${alpha * 0.35})`);
            g.addColorStop(1, 'rgba(0, 0, 0, 0)');
            ctx.fillStyle = g;
            ctx.beginPath();
            ctx.arc(x, y, radius, 0, Math.PI * 2);
            ctx.fill();
        };

        // 1. Bake Bioluminescent Flora Lights (Subtle illumination on neighboring rock & foliage)
        const flora = level.highRes?.flora || [];
        for (const a of flora) {
            if (a.kind === 'GLOW_SHROOM') {
                addRadialLight(a.x, a.y - a.length, lCfg.shroomRadius, 0, 242, 254, lCfg.shroomIntensity ?? 0.24);
            } else if (a.kind === 'CAVE_FLOWER') {
                const isGold = (Math.floor(a.seed) % 2) === 0;
                addRadialLight(
                    a.x,
                    a.y - a.length,
                    lCfg.flowerRadius,
                    isGold ? 255 : 255,
                    isGold ? 200 : 105,
                    isGold ? 75 : 165,
                    lCfg.flowerIntensity ?? 0.20
                );
            } else if (a.kind === 'VINE') {
                addRadialLight(a.x, a.y + a.length, lCfg.vineTipRadius, 110, 255, 165, lCfg.vineTipIntensity ?? 0.14);
            }
        }

        // 2. Bake Decorative Prefab Lights & Colorblind-Accessible Race Beacons
        const prefabs = level.highRes?.prefabs || [];
        for (const p of prefabs) {
            const cx = p.x + p.w * 0.5;
            const cy = p.y + p.h * 0.5;
            if (p.kind === 'PAD') {
                const isHome = p.tileId === 0x15;
                addRadialLight(
                    cx,
                    p.y + 4,
                    lCfg.padRadius,
                    isHome ? 46 : 255,
                    isHome ? 255 : 200,
                    isHome ? 140 : 60,
                    lCfg.padIntensity ?? 0.18
                );
            } else if (p.kind === 'BASE_STRUCTURE') {
                addRadialLight(cx, cy, lCfg.baseRadius, 95, 220, 255, lCfg.baseIntensity ?? 0.20);
            } else if (p.kind === 'GRAVITY_EMITTER') {
                addRadialLight(cx, cy, lCfg.gravityRadius, 195, 105, 255, lCfg.gravityIntensity ?? 0.22);
            } else if (p.kind === 'ANTENNA_MAST') {
                addRadialLight(cx, p.y + 6, lCfg.beaconRadius, 255, 65, 55, lCfg.beaconIntensity ?? 0.22);
            } else if (p.kind === 'RACE_MARKER') {
                addRadialLight(cx, cy, lCfg.raceMarkerRadius, 0, 245, 255, lCfg.raceMarkerIntensity ?? 0.26);
            }
        }

        return canvas;
    }
}

export class PrefabLayer {
    constructor(assetManager = null) {
        this.assetManager = assetManager;
        this.lightCanvas = null;
        this.builtForLevel = null;
    }

    draw(ctx, level, timeSec, players) {
        const prefabs = level?.highRes?.prefabs;
        if (!prefabs) return;
        if (this.builtForLevel !== level) {
            this.builtForLevel = level;
            this.lightCanvas = EnvironmentalLightBaker.buildStaticLightCanvas(level);
        }

        for (const p of prefabs) {
            if (p.kind === 'PAD') {
                this.drawLandingPad(ctx, p, timeSec, players);
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
            } else if (p.kind === 'RACE_MARKER') {
                this.drawRaceMarker(ctx, p, timeSec);
            }
        }
    }

    drawEnvironmentalGlow(ctx, camera, viewW, viewH, level, timeSec, players) {
        if (!level || !RENDER_CONFIG.lighting?.enabled) return;
        if (this.builtForLevel !== level) {
            this.builtForLevel = level;
            this.lightCanvas = EnvironmentalLightBaker.buildStaticLightCanvas(level);
        }
        if (!this.lightCanvas) return;

        const lCfg = RENDER_CONFIG.lighting;
        const scale = lCfg.scale || 0.25;
        const pulseAmp = lCfg.pulseAmplitude ?? 0.06;
        const pulse = (1.0 - pulseAmp) + pulseAmp * Math.sin(timeSec * (lCfg.pulseSpeed || 2.2));

        ctx.save();
        ctx.globalCompositeOperation = 'screen';
        ctx.globalAlpha = (lCfg.ambientIntensity ?? 0.28) * pulse;

        const sx = Math.max(0, camera.x * scale);
        const sy = Math.max(0, camera.y * scale);
        const sw = Math.min(this.lightCanvas.width - sx, (viewW + 4) * scale);
        const sh = Math.min(this.lightCanvas.height - sy, (viewH + 4) * scale);
        if (sw > 0 && sh > 0) {
            ctx.drawImage(
                this.lightCanvas,
                sx,
                sy,
                sw,
                sh,
                sx / scale,
                sy / scale,
                sw / scale,
                sh / scale
            );
        }

        // Dynamic Ship Engine Thruster Illumination onto neighboring walls & flora
        if (players && lCfg.shipLightEnabled !== false) {
            ctx.globalCompositeOperation = 'lighter';
            ctx.globalAlpha = 1.0;
            for (const id in players) {
                const p = players[id];
                if (p.isDead) continue;
                const isThrusting = Boolean(p.inputs && p.inputs.up && p.fuel > 0);
                const rad = isThrusting ? (lCfg.shipThrustRadius ?? 90) : (lCfg.shipIdleRadius ?? 44);
                const alpha = isThrusting ? (lCfg.shipThrustIntensity ?? 0.20) : (lCfg.shipIdleIntensity ?? 0.08);
                if (rad <= 0 || alpha <= 0) continue;
                const g = ctx.createRadialGradient(p.x, p.y, 4, p.x, p.y, rad);
                g.addColorStop(0, `rgba(79, 195, 255, ${alpha})`);
                g.addColorStop(1, 'rgba(0, 0, 0, 0)');
                ctx.fillStyle = g;
                ctx.beginPath();
                ctx.arc(p.x, p.y, rad, 0, Math.PI * 2);
                ctx.fill();
            }
        }
        ctx.restore();
    }

    drawLandingPad(ctx, p, timeSec, players) {
        ctx.save();
        const dCfg = RENDER_CONFIG.details || {};
        let dockedShip = null;
        if (dCfg.padWeightInteractionEnabled !== false && players) {
            for (const id in players) {
                const s = players[id];
                if (!s.isDead && s.isLanded && s.x >= p.x - 10 && s.x <= p.x + p.w + 10 && Math.abs(s.y - (p.y - 14)) < 12) {
                    dockedShip = s;
                    break;
                }
            }
        }

        const deckH = 12;
        const deckSink = dockedShip ? 1.5 : 0;
        // Sub-structure truss
        ctx.fillStyle = '#1b222c';
        ctx.strokeStyle = '#384454';
        ctx.lineWidth = 1.5;
        ctx.fillRect(p.x, p.y, p.w, p.h);
        ctx.strokeRect(p.x, p.y, p.w, p.h);

        // 3-Slice Metallic Top Deck
        const grad = ctx.createLinearGradient(p.x, p.y + deckSink, p.x, p.y + deckSink + deckH);
        grad.addColorStop(0, '#d0dae5');
        grad.addColorStop(0.5, '#8a99ad');
        grad.addColorStop(1, '#495464');
        ctx.fillStyle = grad;
        ctx.fillRect(p.x, p.y + deckSink, p.w, deckH);

        // Sequenced Runway Approach Lights
        const isHome = p.tileId === 0x15;
        const numLights = Math.max(2, Math.floor(p.w / 24));
        for (let i = 0; i < numLights; i++) {
            const lx = p.x + 12 + i * ((p.w - 24) / Math.max(1, numLights - 1));
            if (dockedShip) {
                ctx.fillStyle = 'rgba(0, 242, 254, 0.95)';
            } else {
                const pulse = 0.5 + 0.5 * Math.sin(timeSec * 6 - i * 0.9);
                ctx.fillStyle = isHome
                    ? `rgba(46, 255, 130, ${0.4 + pulse * 0.6})`
                    : `rgba(255, 200, 50, ${0.4 + pulse * 0.6})`;
            }
            ctx.fillRect(lx - 4, p.y + deckSink + 3, 8, 4);
        }

        // Animated Docked Energy / Cargo Transfer Pulses rising into the landed ship
        if (dockedShip) {
            const hasCargo = dockedShip.cargoStack && dockedShip.cargoStack.length > 0;
            const ringT = (timeSec * 2.2) % 1;
            const ry = p.y - ringT * 18;
            ctx.strokeStyle = hasCargo
                ? `rgba(46, 255, 130, ${(1 - ringT) * 0.65})`
                : `rgba(0, 242, 254, ${(1 - ringT) * 0.45})`;
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.moveTo(dockedShip.x - 12 * (1 - ringT * 0.3), ry);
            ctx.lineTo(dockedShip.x + 12 * (1 - ringT * 0.3), ry);
            ctx.stroke();
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
        const sprite = this.assetManager?.get('PREFAB_BASE');
        if (sprite) {
            ctx.drawImage(sprite, p.x, p.y, p.w, p.h);
            return;
        }
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
        const sprite = this.assetManager?.get('PREFAB_BARREL');
        if (sprite) {
            for (let y = p.y; y < p.y + p.h; y += 32) {
                for (let x = p.x; x < p.x + p.w; x += 32) {
                    ctx.drawImage(sprite, x, y, 32, 32);
                }
            }
            return;
        }
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
        const blink = 0.5 + 0.5 * Math.sin(timeSec * 7 + p.x);
        if (blink > 0.25) {
            const g = ctx.createRadialGradient(cx, p.y + 6, 1, cx, p.y + 6, 18 * blink);
            g.addColorStop(0, `rgba(255, 75, 60, ${0.45 * blink})`);
            g.addColorStop(0.4, `rgba(255, 45, 30, ${0.18 * blink})`);
            g.addColorStop(1, 'rgba(255, 45, 30, 0)');
            ctx.fillStyle = g;
            ctx.beginPath();
            ctx.arc(cx, p.y + 6, 18 * blink, 0, Math.PI * 2);
            ctx.fill();

            ctx.fillStyle = '#ffffff';
            ctx.beginPath();
            ctx.arc(cx, p.y + 6, 3.5, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.restore();
    }

    drawRaceMarker(ctx, p, timeSec) {
        // Strictly 32x32 tile-accurate Colorblind-safe Checkpoint Tile
        ctx.save();
        const lCfg = RENDER_CONFIG.lighting || {};
        const cx = p.x + p.w * 0.5;
        const cy = p.y + p.h * 0.5;
        const pulse = 0.65 + 0.35 * Math.sin(timeSec * 6.5 + p.x * 0.05);

        // Subtle, configurable local glow that stays tight to the 32x32 tile
        const auraRadius = lCfg.raceMarkerLocalGlowRadius ?? 24;
        const auraAlpha = lCfg.raceMarkerLocalGlowAlpha ?? 0.24;
        if (auraRadius > 0 && auraAlpha > 0) {
            const g = ctx.createRadialGradient(cx, cy, 2, cx, cy, auraRadius);
            g.addColorStop(0, `rgba(0, 245, 255, ${auraAlpha * pulse})`);
            g.addColorStop(0.6, `rgba(255, 215, 0, ${auraAlpha * 0.4 * pulse})`);
            g.addColorStop(1, 'rgba(0, 245, 255, 0)');
            ctx.fillStyle = g;
            ctx.beginPath();
            ctx.arc(cx, cy, auraRadius, 0, Math.PI * 2);
            ctx.fill();
        }

        // Exact 32x32 tile housing with high-contrast gold & cyan border
        ctx.fillStyle = '#0b1320';
        ctx.strokeStyle = '#ffd700';
        ctx.lineWidth = 2.0;
        ctx.fillRect(p.x + 1, p.y + 1, p.w - 2, p.h - 2);
        ctx.strokeRect(p.x + 1, p.y + 1, p.w - 2, p.h - 2);

        ctx.strokeStyle = '#00f5ff';
        ctx.lineWidth = 1.2;
        ctx.strokeRect(p.x + 4, p.y + 4, Math.max(2, p.w - 8), Math.max(2, p.h - 8));

        // If checkpoint number tile (0x3B - 0x42), render crisp high-contrast number badge
        if (p.tileId >= 0x3B && p.tileId <= 0x42) {
            const cpNum = (p.tileId - 0x3A).toString();
            ctx.fillStyle = '#ffd700';
            ctx.font = 'bold 14px system-ui, sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(cpNum, cx, cy);
        } else {
            // Holder tile (0x43 - 0x4E): crisp internal indicator bar
            ctx.fillStyle = '#00f5ff';
            ctx.fillRect(cx - 6, cy - 2, 12, 4);
        }
        ctx.restore();
    }
}
