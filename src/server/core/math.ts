import type { Point, LevelData } from './types';
import { SERVER_CONFIG } from './config';

// Original Amiga Gravity Force runs at a strict 50Hz PAL vertical blank interrupt.
export const AMIGA_PAL_HZ = 50;

/**
 * Scales a per-frame Amiga PAL (50Hz) addition (thrust, gravity, velocity, fuel drain)
 * to the authoritative server tick rate (e.g. 60Hz or 90Hz) so per-second accumulation is identical.
 */
export function scaleAmigaPerFrameDelta(amigaVal: number, tickRate: number = SERVER_CONFIG.tickRate): number {
    return (amigaVal * AMIGA_PAL_HZ) / Math.max(1, tickRate);
}

/**
 * Scales an Amiga PAL (50Hz) frame count timer (weapon cooldowns, AI intervals)
 * to the authoritative server tick rate so real-time duration is identical.
 */
export function scaleAmigaFrameTimer(amigaFrames: number, tickRate: number = SERVER_CONFIG.tickRate): number {
    return (amigaFrames * Math.max(1, tickRate)) / AMIGA_PAL_HZ;
}

/**
 * Scales an Amiga PAL (50Hz) per-frame multiplicative drag factor (e.g. 0.990 from $00037FA2)
 * exponentially so velocity retention per second is identical across any server tick rate.
 */
export function scaleAmigaDrag(amigaDragPerFrame: number, tickRate: number = SERVER_CONFIG.tickRate): number {
    return Math.pow(amigaDragPerFrame, AMIGA_PAL_HZ / Math.max(1, tickRate));
}

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

export function raycastEnvironment(p1: Point, p2: Point, level: LevelData): Point | null {
    let closest: Point | null = null;
    let minDist = Infinity;
    const checkLines = (lines: Point[][]) => {
        for (const line of lines) {
            for(let i=0; i<line.length-1; i++) {
                const hit = lineIntersect(p1.x, p1.y, p2.x, p2.y, line[i].x, line[i].y, line[i+1].x, line[i+1].y);
                if (hit) {
                    const d = Math.hypot(hit.x - p1.x, hit.y - p1.y);
                    if (d < minDist) { minDist = d; closest = hit; }
                }
            }
        }
    };
    if (level.floor) checkLines([level.floor]);
    if (level.ceiling) checkLines([level.ceiling]);
    if (level.walls) checkLines(level.walls);
    return closest;
}

export function createPRNG(seed: number): () => number {
    return function() {
        let t = seed += 0x6D2B79F5;
        t = Math.imul(t ^ t >>> 15, t | 1);
        t ^= t + Math.imul(t ^ t >>> 7, t | 61);
        return ((t ^ t >>> 14) >>> 0) / 4294967296;
    }
}