import type { Entity, Registry } from '../core/ecs';

export interface EntityVisualFxComponent {
    profileId: string;
    seed: number;
}

/**
 * Generates a deterministic 16-bit integer seed (1..65535) from level index,
 * spawn coordinates, and entity type so all clients & replays render identical
 * PRNG colors, speeds, and corner selections without bandwidth overhead.
 */
export function computeEntityFxSeed(levelIndex: number, x: number, y: number, typeId: number, salt: number = 0): number {
    let h = Math.imul(levelIndex + 1, 374761393);
    h = (h ^ Math.imul(Math.round(x), 668265263)) | 0;
    h = (h ^ Math.imul(Math.round(y), 2147483647)) | 0;
    h = (h ^ Math.imul(typeId + 17, 1274126177)) | 0;
    h = (h ^ Math.imul(salt + 31, 1597334677)) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    const u16 = ((h ^ (h >>> 16)) >>> 0) & 0xFFFF;
    return u16 === 0 ? 1 : u16;
}

export function attachEntityFx(
    ecs: Registry,
    e: Entity,
    profileId: string,
    levelIndex: number,
    x: number,
    y: number,
    typeId: number,
    salt: number = 0
) {
    const seed = computeEntityFxSeed(levelIndex, x, y, typeId, salt);
    ecs.visualEffects.set(e, { profileId, seed });
}