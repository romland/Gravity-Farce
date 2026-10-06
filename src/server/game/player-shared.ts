import { checkPolyIntersect } from '../core/math';
import type { LevelData, Point } from '../core/types';

export function getShipPolygon(x: number, y: number, angle: number, w: number, h: number): Point[][] {
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const nose = { x: x + cos * w, y: y + sin * h };
    const lw = { x: x - cos * w - sin * (w * 0.7), y: y - sin * h + cos * (w * 0.7) };
    const rw = { x: x - cos * w + sin * (w * 0.7), y: y - sin * h - cos * (w * 0.7) };
    const eng = { x: x - cos * (w * 0.5), y: y - sin * (h * 0.5) };
    return [[nose, rw], [rw, eng], [eng, lw], [lw, nose]];
}

export function checkEnvironmentCollisions(
    shipLines: Point[][],
    x: number,
    y: number,
    level: LevelData,
    canLandPredicate: () => boolean,
    onLand: (landY: number, isEndPad: boolean) => void
): boolean { // Returns true if crashed
    // 1. Check Floor
    const floorHit = checkPolyIntersect(shipLines, level.floor);
    if (floorHit) {
        if (floorHit.isFlat && canLandPredicate()) {
            onLand(floorHit.p1.y - 12, false);
            return false;
        }
        return true;
    }

    // 2. Check Pads
    let safelyLanded = false;
    const pads = level.entities.filter(e => e.type === 'pad');
    for (const pad of pads) {
        if (!pad.w || !pad.h) continue;

        const isOverPad = x >= pad.x - 10 && x <= pad.x + pad.w + 10;
        if (isOverPad && y >= pad.y - 18 && y <= pad.y + 4) {
            if (canLandPredicate()) {
                onLand(pad.y - 14, !!pad.props?.isEndPad);
                safelyLanded = true;
                break;
            }
        }

        const padPoly = [
            {x: pad.x, y: pad.y}, {x: pad.x + pad.w, y: pad.y}, 
            {x: pad.x + pad.w, y: pad.y + pad.h}, {x: pad.x, y: pad.y + pad.h}, {x: pad.x, y: pad.y}
        ];

        if (!safelyLanded && checkPolyIntersect(shipLines, padPoly)) return true;
    }
    if (safelyLanded) return false;

    // 3. Check Walls & Ceiling
    if (level.walls && level.walls.some(wall => checkPolyIntersect(shipLines, wall))) return true;
    if (checkPolyIntersect(shipLines, level.ceiling)) return true;

    return false;
}