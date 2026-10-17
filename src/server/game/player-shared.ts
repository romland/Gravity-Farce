import { checkPolyIntersect } from '../core/math';
import type { LevelData, Point } from '../core/types';
import { SERVER_CONFIG } from '../core/config';

// Matches the exact 4-point dart geometry rendered in GameBootstrap.js drawShip:
// Nose at (+16, 0), Wingtips at (-16, ±11.2), Engine notch at (-8, 0).
export function getShipPolygon(x: number, y: number, angle: number, baseSize: number = 16): Point[][] {
    const scale = SERVER_CONFIG.shipScale || 1.0;
    const len = baseSize * scale;
    const halfW = baseSize * scale * 0.85; // 15% lateral squeeze
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const nose = { x: x + cos * len, y: y + sin * len };
    const lw = { x: x - cos * (len * 0.8) - sin * halfW, y: y - sin * (len * 0.8) + cos * halfW };
    const rw = { x: x - cos * (len * 0.8) + sin * halfW, y: y - sin * (len * 0.8) - cos * halfW };
    return [[nose, rw], [rw, lw], [lw, nose]];
}


/**
 * Tests exact intersection between the ship's 4-point dart polygon and a rectangular entity (turret, tank, flying enemy).
 */
export function checkShipBoxCollision(shipX: number, shipY: number, shipAngle: number, boxX: number, boxY: number, boxW: number, boxH: number): boolean {
    const scale = SERVER_CONFIG.shipScale || 1.0;
    const hw = boxW * 0.5;
    const hh = boxH * 0.5;
    // Fast broad-phase reject
    if (Math.abs(shipX - boxX) > hw + 18 * scale || Math.abs(shipY - boxY) > hh + 18 * scale) {
        return false;
    }
    if (Math.abs(shipX - boxX) <= hw && Math.abs(shipY - boxY) <= hh) {
        return true;
    }
    const shipLines = getShipPolygon(shipX, shipY, shipAngle, 16);
    const boxPoly: Point[] = [
        { x: boxX - hw, y: boxY - hh },
        { x: boxX + hw, y: boxY - hh },
        { x: boxX + hw, y: boxY + hh },
        { x: boxX - hw, y: boxY + hh },
        { x: boxX - hw, y: boxY - hh }
    ];
    return checkPolyIntersect(shipLines, boxPoly) !== null;
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
    let clearingPad = false;
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
            // If ascending (taking off) from the pad surface, grant clearance so wingtips don't clip the pad
            if (y <= pad.y - 10) {
                clearingPad = true;
                break;
            }
        }

        const padPoly = [
            {x: pad.x, y: pad.y}, {x: pad.x + pad.w, y: pad.y}, 
            {x: pad.x + pad.w, y: pad.y + pad.h}, {x: pad.x, y: pad.y + pad.h}, {x: pad.x, y: pad.y}
        ];

        if (!safelyLanded && !clearingPad && checkPolyIntersect(shipLines, padPoly)) return true;
    }
    if (safelyLanded || clearingPad) return false;

    // 3. Check Walls & Ceiling
    if (level.walls && level.walls.some(wall => checkPolyIntersect(shipLines, wall))) return true;
    if (checkPolyIntersect(shipLines, level.ceiling)) return true;

    return false;
}
