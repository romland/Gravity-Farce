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

export function isNearSolidTile(rawMap: number[][] | undefined, x: number, y: number, radiusTiles: number = 1): boolean {
    if (!rawMap) return true;
    const cx = Math.floor(x / 32);
    const cy = Math.floor(y / 32);
    const h = rawMap.length;
    const w = h > 0 ? rawMap[0].length : 0;
    for (let dy = -radiusTiles; dy <= radiusTiles; dy++) {
        const ry = cy + dy;
        if (ry < 0 || ry >= h) return true;
        const row = rawMap[ry];
        for (let dx = -radiusTiles; dx <= radiusTiles; dx++) {
            const rx = cx + dx;
            if (rx < 0 || rx >= w) return true;
            const tid = row[rx];
            if (tid !== 0x00 && tid !== 0x20 && tid !== 0x32 && tid !== 0x33 && tid < 0x90) {
                return true;
            }
        }
    }
    return false;
}

export function checkShipWallsCollisionSpatially(shipLines: Point[][], shipX: number, shipY: number, walls: Point[][]): boolean {
    const r = 28 * (SERVER_CONFIG.shipScale || 1.0);
    const minX = shipX - r, maxX = shipX + r;
    const minY = shipY - r, maxY = shipY + r;
    for (let w = 0; w < walls.length; w++) {
        const wall = walls[w];
        for (let i = 0; i < wall.length - 1; i++) {
            const p1 = wall[i];
            const p2 = wall[i + 1];
            if ((p1.x < minX && p2.x < minX) || (p1.x > maxX && p2.x > maxX) ||
                (p1.y < minY && p2.y < minY) || (p1.y > maxY && p2.y > maxY)) {
                continue;
            }
            if (checkPolyIntersect(shipLines, [p1, p2])) return true;
        }
    }
    return false;
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

    // 3. Check Walls & Ceiling (Broad-phase tile reject avoids testing 5,000+ smoothed vertices in open air)
    if (level.walls && isNearSolidTile(level.rawMap, x, y, 1) && checkShipWallsCollisionSpatially(shipLines, x, y, level.walls)) return true;
    if (checkPolyIntersect(shipLines, level.ceiling)) return true;

    return false;
}
