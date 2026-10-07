import type { Point } from '../core/types';

export interface Vector2D {
    vx: number;
    vy: number;
}

export interface TurretSpec {
    typeId: number;
    hpMax: number;
    cooldownMax: number;
    scoreValue: number;
    /**
     * IMPNOTE: This represents pure byte extracts from the 68k binary, meaning it is a
     * relative signed pixel distance from the center of a 16x16 Amiga tile.
     * Because the modern engine renders at TILE_SIZE = 32, systems MUST multiply this by 2
     * during bullet spawning. Do not scale or alter the raw data here!
     */
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

const VEC_8WAY_ARC: Vector2D[] = [
    { vx: -1.0,   vy: 0.0 },
    { vx: -0.901, vy: -0.434 },
    { vx: -0.623, vy: -0.782 },
    { vx: -0.223, vy: -0.975 },
    { vx: 0.223,  vy: -0.975 },
    { vx: 0.623,  vy: -0.782 },
    { vx: 0.901,  vy: -0.434 },
    { vx: 1.0,    vy: 0.0 }
];

const VEC_7WAY_FAN: Vector2D[] = [
    { vx: -1.880, vy: 0.684 },
    { vx: -1.000, vy: 0.0 },
    { vx: -1.414, vy: -1.414 },
    { vx: 0.0,    vy: -1.000 },
    { vx: 1.414,  vy: -1.414 },
    { vx: 1.000,  vy: 0.0 },
    { vx: 1.880,  vy: 0.684 }
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
    0xAE: { typeId: 1,  hpMax: 4, cooldownMax: 80, scoreValue: 150, muzzleOffset: { x: 1,  y: 3 }, soundId: 8,  vectors: VEC_3WAY_UP },
    0xAF: { typeId: 2,  hpMax: 4, cooldownMax: 80, scoreValue: 150, muzzleOffset: { x: 1,  y: 3 }, soundId: 8,  vectors: VEC_3WAY_UP },
    0xB0: { typeId: 3,  hpMax: 5, cooldownMax: 80, scoreValue: 120, muzzleOffset: { x: 1,  y: 3 }, soundId: 10, vectors: VEC_4WAY_UP },
    0xB1: { typeId: 4,  hpMax: 5, cooldownMax: 80, scoreValue: 120, muzzleOffset: { x: 1,  y: 3 }, soundId: 10, vectors: VEC_4WAY_UP },
    0xB2: { typeId: 5,  hpMax: 5, cooldownMax: 40, scoreValue: 150, muzzleOffset: { x: 2,  y: 0 }, soundId: 9,  vectors: VEC_STRAIGHT_UP },
    0xB3: { typeId: 6,  hpMax: 5, cooldownMax: 40, scoreValue: 150, muzzleOffset: { x: 2,  y: 0 }, soundId: 9,  vectors: VEC_STRAIGHT_UP },
    0xB4: { typeId: 7,  hpMax: 8, cooldownMax: 70, scoreValue: 100, muzzleOffset: { x: -1, y: 2 }, soundId: 11, vectors: VEC_8WAY_ARC },
    0xB5: { typeId: 8,  hpMax: 8, cooldownMax: 70, scoreValue: 100, muzzleOffset: { x: -1, y: 2 }, soundId: 11, vectors: VEC_8WAY_ARC },
    0xB6: { typeId: 9,  hpMax: 5, cooldownMax: 40, scoreValue: 150, muzzleOffset: { x: 2,  y: 7 }, soundId: 9,  vectors: VEC_STRAIGHT_DOWN },
    0xB7: { typeId: 10, hpMax: 5, cooldownMax: 40, scoreValue: 150, muzzleOffset: { x: 6,  y: 3 }, soundId: 9,  vectors: VEC_STRAIGHT_EAST },
    0xB8: { typeId: 11, hpMax: 5, cooldownMax: 40, scoreValue: 150, muzzleOffset: { x: -1, y: 3 }, soundId: 9,  vectors: VEC_STRAIGHT_WEST },
    0xB9: { typeId: 12, hpMax: 8, cooldownMax: 80, scoreValue: 150, muzzleOffset: { x: -1, y: 0 }, soundId: 10, vectors: VEC_7WAY_FAN },
    0xBA: { typeId: 13, hpMax: 9, cooldownMax: 40, scoreValue: 150, muzzleOffset: { x: 1,  y: 2 }, soundId: 12, vectors: VEC_5WAY_FAN },
    0xBB: { typeId: 14, hpMax: 9, cooldownMax: 80, scoreValue: 150, muzzleOffset: { x: 1,  y: 3 }, soundId: 9,  vectors: VEC_3WAY_UP },
    0xBC: { typeId: 15, hpMax: 9, cooldownMax: 80, scoreValue: 150, muzzleOffset: { x: 1,  y: 3 }, soundId: 9,  vectors: VEC_3WAY_UP }
};

export function getTriggerIdForTurretTile(turretTileId: number): number {
    return turretTileId - 0xAD;
}

export function getTurretSpecByTile(tileId: number): TurretSpec {
    return TURRET_SPECS_BY_TILE[tileId] || TURRET_SPECS_BY_TILE[0xAF];
}