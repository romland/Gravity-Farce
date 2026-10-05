import { LevelData } from './types';

function createPRNG(seed: number) {
    return function() {
        let t = seed += 0x6D2B79F5;
        t = Math.imul(t ^ t >>> 15, t | 1);
        t ^= t + Math.imul(t ^ t >>> 7, t | 61);
        return ((t ^ t >>> 14) >>> 0) / 4294967296;
    }
}

const handcraftedLevels: LevelData[] = [
    {
        name: "SECTOR 01: THE DROP",
        ceiling: [{x:-200, y:100}, {x:500, y:100}, {x:900, y:300}, {x:1400, y:300}, {x:1800, y:100}, {x:2500, y:100}],
        floor: [{x:-200, y:600}, {x:300, y:600}, {x:700, y:800}, {x:1500, y:800}, {x:1900, y:600}, {x:2500, y:600}],
        startPad: { x: 100, y: 600, w: 100 },
        endPad: { x: 2100, y: 600, w: 100 },
        turrets: []
    }
];

export function getLevelData(index: number): LevelData {
    if (index < handcraftedLevels.length) return JSON.parse(JSON.stringify(handcraftedLevels[index]));

    const rng = createPRNG(index * 1337);
    const length = 3000 + (index - 1) * 800;
    const segments = Math.floor(length / 200);
    
    let ceiling = [], floor = [], turrets = [];
    let cy = 400, gap = 500;
    
    for (let i = 0; i <= segments; i++) {
        let x = i * 200;
        if (i > 1 && i < segments - 1) {
            cy += (rng() - 0.5) * 400; gap = 400 + rng() * 200;
        }
        let noiseCeil = (rng() - 0.5) * 100, noiseFloor = (rng() - 0.5) * 100;
        if (i <= 2 || i >= segments - 2) {
            noiseCeil = 0; noiseFloor = 0; gap = 600;
            if (i <= 2) cy = 400; 
        }
        ceiling.push({x, y: cy - gap/2 + noiseCeil});
        floor.push({x, y: cy + gap/2 + noiseFloor});

        if (i > 2 && i < segments - 2 && rng() < 0.4) {
            let isUp = rng() > 0.5;
            turrets.push({ x, y: isUp ? floor[i].y : ceiling[i].y, orientUp: isUp });
        }
    }
    ceiling.unshift({x: -500, y: ceiling[0].y}); floor.unshift({x: -500, y: floor[0].y});
    ceiling.push({x: length + 500, y: ceiling[ceiling.length-1].y}); floor.push({x: length + 500, y: floor[floor.length-1].y});

    return {
        name: `SECTOR ${String(index + 1).padStart(2, '0')}: UNCHARTED DEPTHS`,
        ceiling, floor, turrets,
        startPad: { x: 100, y: floor[1].y, w: 100 },
        endPad: { x: length - 300, y: floor[floor.length-2].y, w: 100 }
    };
}