export class ShipRenderer {
    constructor() {
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

    drawShip(ctx, p, isMe, debugMode, showDebugLines, shipScale) {
        if (p.isDead) return;

        const timeSec = performance.now() * 0.001;

        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.angle);
        if (shipScale !== 1.0) ctx.scale(shipScale, shipScale);

        // --- NATIVE VECTOR SVG RENDERING (No raster aliasing on rotation) ---
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

        // --- CUSTOMIZED DUAL-ENGINE FLAME & RCS ANIMATIONS ---
        if (p.inputs && (p.inputs.up || p.inputs.analogUp > 0) && (p.fuel === undefined || p.fuel > 0)) {
            const scale = Math.max(p.inputs.up ? 1.0 : 0.0, p.inputs.analogUp || 0.0);
            ctx.fillStyle = '#4facfe';
            const flameLen = 14 * scale + Math.random() * 6 * scale;
            
            ctx.beginPath(); ctx.moveTo(-14.5, -3.5); ctx.lineTo(-14.5 - flameLen, -2.25); ctx.lineTo(-14.5, -1.0); ctx.fill();
            ctx.beginPath(); ctx.moveTo(-14.5, 1.0); ctx.lineTo(-14.5 - flameLen, 2.25); ctx.lineTo(-14.5, 3.5); ctx.fill();
        }

        if (!p.isLanded && p.inputs && (p.inputs.left !== p.inputs.right)) {
            const rcsLen = 4 + Math.random() * 4;
            ctx.fillStyle = 'rgba(130, 225, 255, 0.85)';
            if (p.inputs.left) {
                ctx.beginPath(); ctx.moveTo(-7.5, 12.3); ctx.lineTo(-9.5, 12.3); ctx.lineTo(-8.5, 12.3 + rcsLen); ctx.fill();
            } else if (p.inputs.right) {
                ctx.beginPath(); ctx.moveTo(-7.5, -12.3); ctx.lineTo(-9.5, -12.3); ctx.lineTo(-8.5, -12.3 - rcsLen); ctx.fill();
            }
        }

        if ((timeSec * 2) % 1 > 0.5) {
            ctx.fillStyle = '#ff1133'; ctx.beginPath(); ctx.arc(-11, -11, 1.5, 0, Math.PI * 2); ctx.fill();
            ctx.fillStyle = '#11ff55'; ctx.beginPath(); ctx.arc(-11, 11, 1.5, 0, Math.PI * 2); ctx.fill();
        }

        // --- DIAGNOSTICS & DEBUG ---
        if (debugMode && showDebugLines) {
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
        }

        ctx.restore();

        if (!isMe && p.alias) {
            ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
            ctx.font = '10px Aldrich, monospace';
            ctx.textAlign = 'center';
            ctx.fillText(p.alias, p.x, p.y + 26);
        }
    }
}
