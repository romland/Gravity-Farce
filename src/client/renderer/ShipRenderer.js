import { clientProfiler } from '../perf/ClientProfiler.js';
import { RENDER_CONFIG, rollChance } from './RenderConfig.js';

export class ShipRenderer {
    constructor() {
        this.plumeState = new Map();
        this.paths = {
            main: new Path2D("M 32 6 L 10 44 L 10 54 L 14 54 L 14 46 L 22 42 L 22 50 L 26 52 L 38 52 L 42 50 L 42 42 L 50 46 L 50 54 L 54 54 L 54 44 Z"),
            wingL: new Path2D("M 32 14 L 15 43 L 22 41 Z"),
            wingR: new Path2D("M 32 14 L 49 43 L 42 41 Z"),
            spine: new Path2D("M 30 10 L 34 10 L 36 40 L 32 44 L 28 40 Z"),
            ass: new Path2D("M 22 42 L 42 42 L 42 50 L 38 52 L 26 52 L 22 50 Z"),
            stinger: new Path2D("M 30 42 L 34 42 L 33 53 L 31 53 Z"),
            nozzleL: new Path2D("M 25 52 L 30 52 L 29 55 L 26 55 Z"),
            nozzleR: new Path2D("M 34 52 L 39 52 L 38 55 L 35 55 Z"),
            glass: new Path2D("M 32 20 L 28 30 L 30 36 L 34 36 L 36 30 Z"),
            glassRefl: new Path2D("M 32 21 L 29 30 L 32 32 Z")
        };
    }

    drawShip(ctx, p, isMe, debugMode, showDebugLines, shipScale, spawnParticlesFn) {
        if (p.isDead) return;

        const timeSec = performance.now() * 0.001;

        const endSetup = clientProfiler.begin('Pass.Ship.Setup');
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.angle);
        if (shipScale !== 1.0) ctx.scale(shipScale, shipScale);
        endSetup();

        // --- NATIVE VECTOR SVG RENDERING (No raster aliasing on rotation) ---
        const endVectors = clientProfiler.begin('Pass.Ship.Vectors');
        ctx.save();
        ctx.scale(1, 0.85);       // 15% lateral squeeze (Y-axis in this local rotated space)
        ctx.scale(0.671875, 0.671875); // Scale up (43/64) to compensate for SVG transparent padding
        ctx.rotate(Math.PI / 2);  // Spin from UP to RIGHT
        ctx.translate(-32, -32);  // Anchor at (0,0)

        const teamColor = isMe ? '#d0d5db' : (p.team === 'E2' ? '#a0c5e8' : '#e8a0a0');
        const darkColor = isMe ? '#3d434a' : (p.team === 'E2' ? '#2d3b4a' : '#4a2d2d');

        ctx.fillStyle = teamColor;
        ctx.strokeStyle = '#1a1c20';
        ctx.lineWidth = 1;
        ctx.fill(this.paths.main);
        ctx.stroke(this.paths.main);

        ctx.fillStyle = darkColor;
        ctx.fill(this.paths.wingL);
        ctx.fill(this.paths.wingR);

        ctx.fillStyle = '#444b52';
        ctx.fill(this.paths.spine);
        ctx.stroke(this.paths.spine);

        ctx.fillStyle = '#222529';
        ctx.fill(this.paths.ass);

        ctx.fillStyle = '#735f46';
        ctx.fillRect(24, 44, 6, 4);
        ctx.fillRect(34, 44, 6, 4);

        ctx.fillStyle = '#3d434a';
        ctx.fill(this.paths.stinger);
        ctx.stroke(this.paths.stinger);

        ctx.fillStyle = '#080a0c';
        ctx.fill(this.paths.nozzleL);
        ctx.fill(this.paths.nozzleR);

        ctx.fillStyle = '#2a2e33';
        ctx.fillRect(11, 46, 2, 6);
        ctx.fillRect(51, 46, 2, 6);

        ctx.fillStyle = '#151a21';
        ctx.fill(this.paths.glass);
        ctx.stroke(this.paths.glass);

        ctx.fillStyle = 'rgba(255,255,255,0.15)';
        ctx.fill(this.paths.glassRefl);

        ctx.restore();
        endVectors();

        // --- PHYSICS-DRIVEN DUAL-ENGINE PLUME & RCS ANIMATIONS ---
        const shipKey = p.id || p.alias || 'me';
        let st = this.plumeState.get(shipKey);
        if (!st) {
            st = { spool: 0, lastAngle: p.angle || 0, lastTs: timeSec };
            this.plumeState.set(shipKey, st);
        }
        const dt = Math.min(0.05, Math.max(0.001, timeSec - st.lastTs));
        const dt60 = dt * 60.0;
        st.lastTs = timeSec;

        let dAngle = (p.angle || 0) - st.lastAngle;
        while (dAngle > Math.PI) dAngle -= Math.PI * 2;
        while (dAngle < -Math.PI) dAngle += Math.PI * 2;
        const angVel = dAngle / Math.max(0.1, dt60);
        st.lastAngle = p.angle || 0;

        const rawInput = (p.inputs && (p.inputs.up || p.inputs.analogUp > 0) && (p.fuel === undefined || p.fuel > 0))
            ? Math.max(p.inputs.up ? 1.0 : 0.0, p.inputs.analogUp || 0.0)
            : 0.0;

        if (rawInput > 0) {
            st.spool = Math.min(1.0, st.spool + 0.16 * dt60) * rawInput;
        } else {
            st.spool = Math.max(0.0, st.spool - 0.28 * dt60);
        }

        if (st.spool > 0.04) {
            const endFlames = clientProfiler.begin('Pass.Ship.Flames');
            const vx = p.vx || 0;
            const vy = p.vy || 0;
            const speed = Math.hypot(vx, vy);
            const fwdX = Math.cos(p.angle);
            const fwdY = Math.sin(p.angle);
            // +speed when flying forward at high speed, -speed when retro-braking against momentum
            const forwardAlign = (vx * fwdX + vy * fwdY) / 7.5;

            // Retro-braking compresses & flares the plume; high forward speed stretches it into a needle cone
            const stretchFactor = Math.max(0.58, Math.min(1.55, 1.0 + forwardAlign * 0.42));
            const flareFactor = Math.max(0.72, Math.min(1.45, 1.0 - forwardAlign * 0.35 + (1.0 - st.spool) * 0.25));
            const turnBendY = Math.max(-5.5, Math.min(5.5, -angVel * 26.0));

            const flameLen = (6 + 15 * st.spool + Math.sin(timeSec * 55) * 2.8) * stretchFactor;
            const halfSpread = 1.25 * flareFactor;

            ctx.fillStyle = '#4facfe';
            ctx.beginPath();
            ctx.moveTo(-14.5, -2.25 - halfSpread);
            ctx.lineTo(-14.5 - flameLen, -2.25 + turnBendY);
            ctx.lineTo(-14.5, -2.25 + halfSpread);
            ctx.moveTo(-14.5, 2.25 - halfSpread);
            ctx.lineTo(-14.5 - flameLen, 2.25 + turnBendY);
            ctx.lineTo(-14.5, 2.25 + halfSpread);
            ctx.fill();

            // White-hot inner Mach shock core
            ctx.fillStyle = '#e0faff';
            const coreLen = flameLen * 0.52;
            ctx.beginPath();
            ctx.moveTo(-14.5, -2.25 - halfSpread * 0.5);
            ctx.lineTo(-14.5 - coreLen, -2.25 + turnBendY * 0.45);
            ctx.lineTo(-14.5, -2.25 + halfSpread * 0.5);
            ctx.moveTo(-14.5, 2.25 - halfSpread * 0.5);
            ctx.lineTo(-14.5 - coreLen, 2.25 + turnBendY * 0.45);
            ctx.lineTo(-14.5, 2.25 + halfSpread * 0.5);
            ctx.fill();

            // Cheap short-lived exhaust particles (1-2 seconds max)
            if (spawnParticlesFn && RENDER_CONFIG.details?.thrusterParticlesEnabled !== false && !p.isLanded && rollChance(0.55 * st.spool, dt60)) {
                const nozzleWorldX = p.x - fwdX * 16 * shipScale;
                const nozzleWorldY = p.y - fwdY * 16 * shipScale;
                const pVx = vx * 0.25 - fwdX * (1.8 + Math.random() * 1.2) + (Math.random() - 0.5) * 0.5;
                const pVy = vy * 0.25 - fwdY * (1.8 + Math.random() * 1.2) + (Math.random() - 0.5) * 0.5;
                const col = Math.random() > 0.35 ? 'rgba(79, 172, 254, 0.65)' : 'rgba(200, 245, 255, 0.75)';
                spawnParticlesFn(nozzleWorldX, nozzleWorldY, pVx, pVy, col, 1, 32);
            }
            endFlames();
        }

        if (!p.isLanded && p.inputs && (p.inputs.left !== p.inputs.right)) {
            const endRCS = clientProfiler.begin('Pass.Ship.RCS');
            const rcsLen = 4 + Math.random() * 4;
            ctx.fillStyle = 'rgba(130, 225, 255, 0.85)';
            if (p.inputs.left) {
                ctx.beginPath(); ctx.moveTo(-7.5, 12.3); ctx.lineTo(-9.5, 12.3); ctx.lineTo(-8.5, 12.3 + rcsLen); ctx.fill();
            } else if (p.inputs.right) {
                ctx.beginPath(); ctx.moveTo(-7.5, -12.3); ctx.lineTo(-9.5, -12.3); ctx.lineTo(-8.5, -12.3 - rcsLen); ctx.fill();
            }
            endRCS();
        }

        if ((timeSec * 2) % 1 > 0.5) {
            const endLights = clientProfiler.begin('Pass.Ship.Lights');
            ctx.fillStyle = '#ff1133'; ctx.beginPath(); ctx.arc(-11, -11, 1.5, 0, Math.PI * 2); ctx.fill();
            ctx.fillStyle = '#11ff55'; ctx.beginPath(); ctx.arc(-11, 11, 1.5, 0, Math.PI * 2); ctx.fill();
            endLights();
        }

        // --- DIAGNOSTICS & DEBUG ---
        if (debugMode && showDebugLines) {
            const endDebug = clientProfiler.begin('Pass.Ship.Debug');
            const len = 16;
            const halfW = 16 * 0.85;
            ctx.strokeStyle = 'rgba(255, 0, 255, 0.8)';
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.moveTo(len, 0);
            ctx.lineTo(-len * 0.8, -halfW);
            ctx.lineTo(-len * 0.8, halfW);
            ctx.closePath();
            ctx.stroke();
            endDebug();
        }

        ctx.restore();

        if (!isMe && p.alias) {
            const endText = clientProfiler.begin('Pass.Ship.Text');
            ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
            ctx.font = '10px Aldrich, monospace';
            ctx.textAlign = 'center';
            ctx.fillText(p.alias, p.x, p.y + 26);
            endText();
        }
    }
}
