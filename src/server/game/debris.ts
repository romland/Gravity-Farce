import { Registry } from '../core/ecs';
import { spawnBullet } from './combat';

export interface FragmentDef {
    dx: number;
    dy: number;
    vx: number;
    vy: number;
}

export const TANK_FRAGMENTS: FragmentDef[] = [
    { dx: 4.0,  dy: 2.0, vx: -0.866, vy: -0.500 },
    { dx: 6.0,  dy: 0.0, vx: -0.500, vy: -0.866 },
    { dx: 8.0,  dy: 0.0, vx:  0.000, vy: -1.000 },
    { dx: 10.0, dy: 0.0, vx:  0.500, vy: -0.866 },
    { dx: 11.9, dy: 2.0, vx:  0.866, vy: -0.500 },
];

export const FLYING_ENEMY_FRAGMENTS: FragmentDef[] = [
    { dx: 24.0, dy:  0.0, vx:  0.000, vy: -1.000 },
    { dx: 47.0, dy: 16.0, vx:  1.000, vy:  0.000 },
    { dx: 24.0, dy: 31.0, vx:  0.000, vy:  1.000 },
    { dx:  0.0, dy: 16.0, vx: -1.000, vy:  0.000 },
    { dx:  0.0, dy:  0.0, vx: -0.707, vy: -0.707 },
    { dx: 47.0, dy:  0.0, vx:  0.707, vy: -0.707 },
    { dx: 47.0, dy: 31.0, vx:  0.707, vy:  0.707 },
    { dx:  0.0, dy: 31.0, vx: -0.707, vy:  0.707 },
];

export function spawnExplosionFragments(ecs: Registry, x: number, y: number, type: 'tank' | 'flying') {
    const isTank = type === 'tank';
    const fragments = isTank ? TANK_FRAGMENTS : FLYING_ENEMY_FRAGMENTS;
    
    const amigaWidth = isTank ? 16 : 48;
    const amigaHeight = isTank ? 12 : 32;
    
    const amigaTopLeftX = x - amigaWidth;
    const amigaTopLeftY = y - amigaHeight;

    for (const f of fragments) {
        spawnBullet(ecs, amigaTopLeftX + (f.dx * 2), amigaTopLeftY + (f.dy * 2), f.vx * 2, f.vy * 2, false, 'npc', 100);
    }
}