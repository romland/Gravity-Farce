export class ShipRenderer {
    constructor() {
        this.svgString = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64">
  <defs>
    <linearGradient id="hull-light" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="#d0d5db" />
      <stop offset="60%" stop-color="#8e96a1" />
      <stop offset="100%" stop-color="#5a626b" />
    </linearGradient>
    <linearGradient id="hull-dark" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="#3d434a" />
      <stop offset="100%" stop-color="#1f2226" />
    </linearGradient>
    <linearGradient id="mech-dark" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="#222529" />
      <stop offset="100%" stop-color="#0a0c0e" />
    </linearGradient>
    <linearGradient id="heat-shield" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="#735f46" />
      <stop offset="100%" stop-color="#362a1c" />
    </linearGradient>
    <linearGradient id="glass" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="#2a333d" />
      <stop offset="50%" stop-color="#151a21" />
      <stop offset="100%" stop-color="#05080a" />
    </linearGradient>
  </defs>
  <g id="spaceship">
    <path d="M 32 6 L 10 44 L 10 54 L 14 54 L 14 46 L 22 42 L 22 50 L 26 52 L 38 52 L 42 50 L 42 42 L 50 46 L 50 54 L 54 54 L 54 44 Z" fill="url(#hull-light)" stroke="#1a1c20" stroke-width="0.5" />
    <path d="M 32 14 L 15 43 L 22 41 Z" fill="url(#hull-dark)" />
    <path d="M 32 14 L 49 43 L 42 41 Z" fill="url(#hull-dark)" />
    <path d="M 30 10 L 34 10 L 36 40 L 32 44 L 28 40 Z" fill="#444b52" stroke="#2a2e33" stroke-width="0.5" />
    <line x1="26" y1="28" x2="16" y2="35" stroke="#1c1f24" stroke-width="0.5" />
    <line x1="14" y1="46" x2="22" y2="42" stroke="#1c1f24" stroke-width="1.5" />
    <line x1="38" y1="28" x2="48" y2="35" stroke="#1c1f24" stroke-width="0.5" />
    <line x1="50" y1="46" x2="42" y2="42" stroke="#1c1f24" stroke-width="1.5" />
    <path d="M 22 42 L 42 42 L 42 50 L 38 52 L 26 52 L 22 50 Z" fill="url(#mech-dark)" />
    <rect x="24" y="44" width="6" height="4" fill="url(#heat-shield)" rx="0.5" />
    <rect x="34" y="44" width="6" height="4" fill="url(#heat-shield)" rx="0.5" />
    <line x1="24" y1="46" x2="30" y2="46" stroke="#111" stroke-width="0.5" />
    <line x1="34" y1="46" x2="40" y2="46" stroke="#111" stroke-width="0.5" />
    <polygon points="30,42 34,42 33,53 31,53" fill="#3d434a" stroke="#111" stroke-width="0.5" />
    <polygon points="25,52 30,52 29,55 26,55" fill="#080a0c" stroke="#333" stroke-width="0.5" />
    <polygon points="34,52 39,52 38,55 35,55" fill="#080a0c" stroke="#333" stroke-width="0.5" />
    <line x1="24" y1="51" x2="25" y2="56" stroke="#5a626b" stroke-width="1" stroke-linecap="round" />
    <line x1="40" y1="51" x2="39" y2="56" stroke="#5a626b" stroke-width="1" stroke-linecap="round" />
    <rect x="11" y="46" width="2" height="6" fill="#2a2e33" rx="0.5" stroke="#111" stroke-width="0.5" />
    <line x1="11" y1="48" x2="13" y2="48" stroke="#ffaa00" stroke-width="0.5" />
    <line x1="11" y1="50" x2="13" y2="50" stroke="#ffaa00" stroke-width="0.5" />
    <rect x="51" y="46" width="2" height="6" fill="#2a2e33" rx="0.5" stroke="#111" stroke-width="0.5" />
    <line x1="51" y1="48" x2="53" y2="48" stroke="#ffaa00" stroke-width="0.5" />
    <line x1="51" y1="50" x2="53" y2="50" stroke="#ffaa00" stroke-width="0.5" />
    <polygon points="32,20 28,30 30,36 34,36 36,30" fill="url(#glass)" stroke="#111" stroke-width="0.5" />
    <polygon points="32,21 29,30 32,32" fill="#ffffff" opacity="0.15" />
    <line x1="28" y1="30" x2="36" y2="30" stroke="#1a1c20" stroke-width="0.75" />
    <path d="M 32 6 L 10 44 L 10 54" fill="none" stroke="#ffffff" stroke-width="0.5" opacity="0.5" />
    <path d="M 14 46 L 22 42 L 42 42 L 50 46" fill="none" stroke="#ffffff" stroke-width="0.5" opacity="0.2" />
    <polygon points="21,25 22.5,26 20.5,29.5 19,28.5" fill="url(#mech-dark)" stroke="#1a1c20" stroke-width="0.5" />
    <line x1="22.5" y1="26" x2="20.5" y2="29.5" stroke="#ffffff" stroke-width="0.5" opacity="0.5" />
    <circle cx="21.3" cy="26.6" r="0.5" fill="#080a0c" stroke="#444b52" stroke-width="0.2" />
    <circle cx="20.2" cy="28.5" r="0.5" fill="#080a0c" stroke="#444b52" stroke-width="0.2" />
    <line x1="21" y1="25" x2="22.5" y2="26" stroke="#ffaa00" stroke-width="0.4" />
    <polygon points="43,25 41.5,26 43.5,29.5 45,28.5" fill="url(#mech-dark)" stroke="#1a1c20" stroke-width="0.5" />
    <line x1="41.5" y1="26" x2="43.5" y2="29.5" stroke="#ffffff" stroke-width="0.5" opacity="0.3" />
    <circle cx="42.7" cy="26.6" r="0.5" fill="#080a0c" stroke="#444b52" stroke-width="0.2" />
    <circle cx="43.8" cy="28.5" r="0.5" fill="#080a0c" stroke="#444b52" stroke-width="0.2" />
    <line x1="43" y1="25" x2="41.5" y2="26" stroke="#ffaa00" stroke-width="0.4" />
    <path d="M 10 47 L 8 48 L 8 51 L 10 52 Z" fill="url(#hull-light)" stroke="#1a1c20" stroke-width="0.5" />
    <path d="M 10 47 L 8 48 L 8 51 L 10 52" fill="none" stroke="#ffffff" stroke-width="0.5" opacity="0.5" />
    <line x1="8.2" y1="48.8" x2="9.5" y2="48.8" stroke="#080a0c" stroke-width="0.8" stroke-linecap="round" />
    <line x1="8.2" y1="50.2" x2="9.5" y2="50.2" stroke="#080a0c" stroke-width="0.8" stroke-linecap="round" />
    <line x1="8" y1="48" x2="10" y2="47" stroke="#ffaa00" stroke-width="0.4" />
    <path d="M 54 47 L 56 48 L 56 51 L 54 52 Z" fill="url(#hull-light)" stroke="#1a1c20" stroke-width="0.5" />
    <path d="M 54 47 L 56 48 L 56 51 L 54 52" fill="none" stroke="#ffffff" stroke-width="0.5" opacity="0.1" />
    <line x1="55.8" y1="48.8" x2="54.5" y2="48.8" stroke="#080a0c" stroke-width="0.8" stroke-linecap="round" />
    <line x1="55.8" y1="50.2" x2="54.5" y2="50.2" stroke="#080a0c" stroke-width="0.8" stroke-linecap="round" />
    <line x1="56" y1="48" x2="54" y2="47" stroke="#ffaa00" stroke-width="0.4" />
  </g>
</svg>`;
        this.cache = new Map();
    }

    getShipImage(team, isMe, isBot) {
        const key = `${team}_${isMe}_${isBot}`;
        if (this.cache.has(key)) return this.cache.get(key);

        const canvas = document.createElement('canvas');
        canvas.width = 64;
        canvas.height = 64;
        const ctx = canvas.getContext('2d');

        let hueRotate = 0;
        let saturate = 100;
        if (isMe) { hueRotate = 200; saturate = 150; }
        else if (team === 'E2') { hueRotate = 220; }
        else if (team === 'E3') { hueRotate = 0; saturate = 200; }
        else if (isBot) { hueRotate = 40; }

        const img = new Image();
        const blob = new Blob([this.svgString], { type: 'image/svg+xml' });
        const url = URL.createObjectURL(blob);
        img.onload = () => {
            ctx.filter = `hue-rotate(${hueRotate}deg) saturate(${saturate}%)`;
            ctx.translate(32, 32);
            ctx.rotate(Math.PI / 2);
            ctx.drawImage(img, -32, -32, 64, 64);
            URL.revokeObjectURL(url);
        };
        img.src = url;
        this.cache.set(key, canvas);
        return canvas;
    }

    drawShip(ctx, p, isMe, debugMode, showDebugLines, shipScale) {
        if (p.isDead) return;
        const shipImg = this.getShipImage(p.team, isMe, p.isBot);
        const timeSec = performance.now() * 0.001;

        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.angle);
        if (shipScale !== 1.0) ctx.scale(shipScale, shipScale);

        ctx.drawImage(shipImg, -21.5, -21.5, 43, 43);

        const isThrusting = p.inputs && (p.inputs.up || p.inputs.analogUp > 0) && (p.fuel === undefined || p.fuel > 0);
        if (isThrusting) {
            const tScale = Math.max(p.inputs.up ? 1.0 : 0.0, p.inputs.analogUp || 0.0);
            ctx.fillStyle = '#4facfe';
            const flameLen = 14 * tScale + Math.random() * 6 * tScale;
            
            ctx.beginPath(); ctx.moveTo(-14.5, -3.5); ctx.lineTo(-14.5 - flameLen, -2.25); ctx.lineTo(-14.5, -1.0); ctx.fill();
            ctx.beginPath(); ctx.moveTo(-14.5, 1.0); ctx.lineTo(-14.5 - flameLen, 2.25); ctx.lineTo(-14.5, 3.5); ctx.fill();
        }

        if (!p.isLanded && p.inputs && (p.inputs.left !== p.inputs.right)) {
            const rcsLen = 4 + Math.random() * 4;
            ctx.fillStyle = 'rgba(130, 225, 255, 0.85)';
            if (p.inputs.left) {
                ctx.beginPath(); ctx.moveTo(-7.5, 14.5); ctx.lineTo(-9.5, 14.5); ctx.lineTo(-8.5, 14.5 + rcsLen); ctx.fill();
            } else if (p.inputs.right) {
                ctx.beginPath(); ctx.moveTo(-7.5, -14.5); ctx.lineTo(-9.5, -14.5); ctx.lineTo(-8.5, -14.5 - rcsLen); ctx.fill();
            }
        }

        if ((timeSec * 2) % 1 > 0.5) {
            ctx.fillStyle = '#ff1133'; ctx.beginPath(); ctx.arc(-11, -11, 1.5, 0, Math.PI * 2); ctx.fill();
            ctx.fillStyle = '#11ff55'; ctx.beginPath(); ctx.arc(-11, 11, 1.5, 0, Math.PI * 2); ctx.fill();
        }
        ctx.restore();

        if (debugMode && showDebugLines) {
            const w = 16 * shipScale;
            const cos = Math.cos(p.angle), sin = Math.sin(p.angle);
            ctx.strokeStyle = 'rgba(255, 0, 255, 0.8)';
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.moveTo(p.x + cos * w, p.y + sin * w);
            ctx.lineTo(p.x - cos * (w * 0.8) + sin * w, p.y - sin * (w * 0.8) - cos * w);
            ctx.lineTo(p.x - cos * (w * 0.8) - sin * w, p.y - sin * (w * 0.8) + cos * w);
            ctx.closePath();
            ctx.stroke();
        }

        if (!isMe && p.alias) {
            ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
            ctx.font = '10px Aldrich, monospace';
            ctx.textAlign = 'center';
            ctx.fillText(p.alias, p.x, p.y + 26);
        }
    }
}