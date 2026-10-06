import type { Point } from '../core/types';

export interface Vector2D {
    vx: number;
    vy: number;
}

export interface TurretSpec {
    typeId: number;
    hpMax: number;
    cooldownMax: number;
    muzzleOffset: Point;
    soundId: number;
    vectors: Vector2D[];
}

// Fixed-point direction vector tables ($000359FA–$00035AEA)
const VEC_3WAY_UP: Vector2D[] = [
    { vx: -0.707, vy: -0.707 },
    { vx: 0.0,    vy: -1.0 },
    { vx: 0.707,  vy: -0.707 }
];

const VEC_4WAY_UP: Vector2D[] = [
    { vx: -1.061, vy: -1.061 },
    { vx: -0.389, vy: -1.449 },
    { vx: 0.389,  vy: -1.449 },
    { vx: 1.061,  vy: -1.061 }
];

const VEC_STRAIGHT_UP: Vector2D[] = [
    { vx: 0.0, vy: -1.0 }
];

const VEC_STRAIGHT_DOWN: Vector2D[] = [
    { vx: 0.0, vy: 1.0 }
];

const VEC_STRAIGHT_EAST: Vector2D[] = [
    { vx: 1.0, vy: 0.0 }
];

const VEC_STRAIGHT_WEST: Vector2D[] = [
    { vx: -1.0, vy: 0.0 }
];

const VEC_ANGLED_LEFT: Vector2D[] = [
    { vx: -0.866, vy: -0.5 },
    { vx: -0.5,   vy: -0.866 }
];

const VEC_WIDE_FAN: Vector2D[] = [
    { vx: -0.923, vy: -0.382 },
    { vx: -0.382, vy: -0.923 },
    { vx: 0.382,  vy: -0.923 },
    { vx: 0.923,  vy: -0.382 }
];

const VEC_5WAY_FAN: Vector2D[] = [
    { vx: -1.0,   vy: 0.0 },
    { vx: -0.707, vy: -0.707 },
    { vx: 0.0,    vy: -1.0 },
    { vx: 0.707,  vy: -0.707 },
    { vx: 1.0,    vy: 0.0 }
];

const VEC_3WAY_DOWN: Vector2D[] = [
    { vx: -0.707, vy: 0.707 },
    { vx: 0.0,    vy: 1.0 },
    { vx: 0.707,  vy: 0.707 }
];

// Complete 15-Type Specification Table ($00035B16)
export const TURRET_SPECS_BY_TILE: Record<number, TurretSpec> = {
    0xAE: { typeId: 1,  hpMax: 4, cooldownMax: 80, muzzleOffset: { x: 1,  y: 3 }, soundId: 8,  vectors: VEC_3WAY_UP },
    0xAF: { typeId: 2,  hpMax: 4, cooldownMax: 80, muzzleOffset: { x: 1,  y: 3 }, soundId: 8,  vectors: VEC_3WAY_UP },
    0xB0: { typeId: 3,  hpMax: 5, cooldownMax: 80, muzzleOffset: { x: 1,  y: 3 }, soundId: 10, vectors: VEC_4WAY_UP },
    0xB1: { typeId: 4,  hpMax: 5, cooldownMax: 80, muzzleOffset: { x: 1,  y: 3 }, soundId: 10, vectors: VEC_4WAY_UP },
    0xB2: { typeId: 5,  hpMax: 5, cooldownMax: 40, muzzleOffset: { x: 2,  y: 0 }, soundId: 9,  vectors: VEC_STRAIGHT_UP },
    0xB3: { typeId: 6,  hpMax: 5, cooldownMax: 40, muzzleOffset: { x: 2,  y: 0 }, soundId: 9,  vectors: VEC_STRAIGHT_UP },
    0xB4: { typeId: 7,  hpMax: 8, cooldownMax: 70, muzzleOffset: { x: -1, y: 2 }, soundId: 11, vectors: VEC_ANGLED_LEFT },
    0xB5: { typeId: 8,  hpMax: 8, cooldownMax: 70, muzzleOffset: { x: -1, y: 2 }, soundId: 11, vectors: VEC_ANGLED_LEFT },
    0xB6: { typeId: 9,  hpMax: 5, cooldownMax: 40, muzzleOffset: { x: 2,  y: 7 }, soundId: 9,  vectors: VEC_STRAIGHT_DOWN },
    0xB7: { typeId: 10, hpMax: 5, cooldownMax: 40, muzzleOffset: { x: 6,  y: 3 }, soundId: 9,  vectors: VEC_STRAIGHT_EAST },
    0xB8: { typeId: 11, hpMax: 5, cooldownMax: 40, muzzleOffset: { x: -1, y: 3 }, soundId: 9,  vectors: VEC_STRAIGHT_WEST },
    0xB9: { typeId: 12, hpMax: 8, cooldownMax: 80, muzzleOffset: { x: -1, y: 0 }, soundId: 10, vectors: VEC_WIDE_FAN },
    0xBA: { typeId: 13, hpMax: 9, cooldownMax: 40, muzzleOffset: { x: 1,  y: 2 }, soundId: 12, vectors: VEC_5WAY_FAN },
    0xBB: { typeId: 14, hpMax: 9, cooldownMax: 80, muzzleOffset: { x: 1,  y: 3 }, soundId: 9,  vectors: VEC_3WAY_DOWN },
    0xBC: { typeId: 15, hpMax: 9, cooldownMax: 80, muzzleOffset: { x: 1,  y: 3 }, soundId: 9,  vectors: VEC_3WAY_DOWN }
};

export const TILE_TO_TURRET_TYPE: Record<number, number> = {
    0xAE: 4,  // 4-Way Cone Variant
    0xAF: 1,  // 3-Way Cone Up
    0xB0: 3,  // 4-Way Cone Up
    0xB1: 5,  // Straight Up Variant
    0xB2: 5,  // Straight Up
    0xB3: 9,  // Straight Down
    0xB4: 9,  // Straight Down Variant
    0xB5: 8,  // Angled / Diagonal Stream
    0xB7: 10, // Straight East
    0xB8: 11, // Straight West
    0xB9: 8,  // Angled Variant
    0xBA: 13  // 5-Way Fan
};

export function getTriggerIdForTurretTile(turretTileId: number): number {
    return turretTileId - 0xAD;
}

export function getTurretSpecByTile(tileId: number): TurretSpec {
    return TURRET_SPECS_BY_TILE[tileId] || TURRET_SPECS_BY_TILE[0xAF];
}