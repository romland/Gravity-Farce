import type { Point } from './types';

export function lineIntersect(x1: number, y1: number, x2: number, y2: number, x3: number, y3: number, x4: number, y4: number): Point | null {
    const den = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
    if (den === 0) return null;
    const t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / den;
    const u = -((x1 - x2) * (y1 - y3) - (y1 - y2) * (x1 - x3)) / den;
    if (t > 0 && t < 1 && u > 0 && u < 1) return { x: x1 + t * (x2 - x1), y: y1 + t * (y2 - y1) };
    return null;
}

export function checkPolyIntersect(lines: Point[][], poly: Point[]): { isFlat: boolean, p1: Point, p2: Point } | null {
    for (let i = 0; i < poly.length - 1; i++) {
        const p1 = poly[i]; const p2 = poly[i+1];
        for (let j = 0; j < lines.length; j++) {
            if (lineIntersect(lines[j][0].x, lines[j][0].y, lines[j][1].x, lines[j][1].y, p1.x, p1.y, p2.x, p2.y)) {
                return { isFlat: Math.abs(p1.y - p2.y) < 1.0, p1, p2 };
            }
        }
    }
    return null;
}

export function normalizeAngle(angle: number): number {
    let diff = -Math.PI / 2 - angle;
    while (diff < -Math.PI) diff += Math.PI * 2;
    while (diff > Math.PI) diff -= Math.PI * 2;
    return diff;
}
