export interface Vector2D {
    vx: number;
    vy: number;
}

export interface TurretSpec {
    typeId: number;
    cooldownMax: number;
    muzzleOffset: Vector2D;
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
export const TURRET_SPECS_BY_ID: Record<number, TurretSpec> = {
    1:  { typeId: 1,  cooldownMax: 80, muzzleOffset: { x: 1,  y: 3 }, soundId: 8,  vectors: VEC_3WAY_UP },
    2:  { typeId: 2,  cooldownMax: 80, muzzleOffset: { x: 1,  y: 3 }, soundId: 8,  vectors: VEC_3WAY_UP },
    3:  { typeId: 3,  cooldownMax: 80, muzzleOffset: { x: 1,  y: 3 }, soundId: 10, vectors: VEC_4WAY_UP },
    4:  { typeId: 4,  cooldownMax: 80, muzzleOffset: { x: 1,  y: 3 }, soundId: 10, vectors: VEC_4WAY_UP },
    5:  { typeId: 5,  cooldownMax: 40, muzzleOffset: { x: 2,  y: 0 }, soundId: 9,  vectors: VEC_STRAIGHT_UP },
    6:  { typeId: 6,  cooldownMax: 40, muzzleOffset: { x: 2,  y: 0 }, soundId: 9,  vectors: VEC_STRAIGHT_UP },
    7:  { typeId: 7,  cooldownMax: 70, muzzleOffset: { x: -1, y: 2 }, soundId: 11, vectors: VEC_ANGLED_LEFT },
    8:  { typeId: 8,  cooldownMax: 70, muzzleOffset: { x: -1, y: 2 }, soundId: 11, vectors: VEC_ANGLED_LEFT },
    9:  { typeId: 9,  cooldownMax: 40, muzzleOffset: { x: 2,  y: 7 }, soundId: 9,  vectors: VEC_STRAIGHT_DOWN },
    10: { typeId: 10, cooldownMax: 40, muzzleOffset: { x: 6,  y: 3 }, soundId: 9,  vectors: VEC_STRAIGHT_EAST },
    11: { typeId: 11, cooldownMax: 40, muzzleOffset: { x: -1, y: 3 }, soundId: 9,  vectors: VEC_STRAIGHT_WEST },
    12: { typeId: 12, cooldownMax: 80, muzzleOffset: { x: -1, y: 0 }, soundId: 10, vectors: VEC_WIDE_FAN },
    13: { typeId: 13, cooldownMax: 40, muzzleOffset: { x: 1,  y: 2 }, soundId: 12, vectors: VEC_5WAY_FAN },
    14: { typeId: 14, cooldownMax: 80, muzzleOffset: { x: 1,  y: 3 }, soundId: 9,  vectors: VEC_3WAY_DOWN },
    15: { typeId: 15, cooldownMax: 80, muzzleOffset: { x: 1,  y: 3 }, soundId: 9,  vectors: VEC_3WAY_DOWN }
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
    const typeId = TILE_TO_TURRET_TYPE[tileId] || 1;
    return TURRET_SPECS_BY_ID[typeId];
}