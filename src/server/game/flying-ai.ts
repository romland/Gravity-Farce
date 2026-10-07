import { Registry, type Entity } from '../core/ecs';
import type { Room } from '../Room';
import { killPlayer, spawnBullet } from './combat';

const TILE_SIZE = 32;

const CARDINAL_VECTORS = [
    { x: 1.0, y: 0.0 },  // Right
    { x: 0.0, y: 1.0 },  // Down
    { x: -1.0, y: 0.0 }, // Left
    { x: 0.0, y: -1.0 }  // Up
];

const WAVE_SPEED_MODIFIERS = [1.25, 1.35, 1.50, 1.65, 1.75, 1.65, 1.50, 1.35];

const CORNER_TABLES: Record<number, number[]> = {
    8:  [0,-1, 0,-1, 0,-1, 0,-1, 0,-1, 0,-1, 1,-1, 0,-1, 1,-1, 0,-1, 1,-1, 1,-1, 1,-1, 1,-1, 1,0, 1,-1, 1,0, 1,-1, 1,0, 1,0, 1,0, 1,0, 1,0, 1,0],
    9:  [1,0, 1,0, 1,0, 1,0, 1,0, 1,0, 1,1, 1,0, 1,1, 1,0, 1,1, 1,1, 1,1, 1,1, 0,1, 1,1, 0,1, 1,1, 0,1, 0,1, 0,1, 0,1, 0,1, 0,1],
    10: [0,1, 0,1, 0,1, 0,1, 0,1, 0,1, -1,1, 0,1, -1,1, 0,1, -1,1, -1,1, -1,1, -1,1, -1,0, -1,1, -1,0, -1,1, -1,0, -1,0, -1,0, -1,0, -1,0, -1,0],
    11: [-1,0, -1,0, -1,0, -1,0, -1,0, -1,0, -1,-1, -1,0, -1,-1, -1,0, -1,-1, -1,-1, -1,-1, -1,-1, 0,-1, -1,-1, 0,-1, -1,-1, 0,-1, 0,-1, 0,-1, 0,-1, 0,-1, 0,-1]
};

let globalWaveTimer = 0;

export function spawnFlyingEnemy(ecs: Registry, x: number, y: number, type: number): Entity {
    const e = ecs.create();
    ecs.transforms.set(e, { x, y, angle: 0 });
    ecs.flyingEnemies.set(e, {
        active: true,
        hp: 3,
        enemyType: type,
        scoreValue: type === 0xE7 ? 250 : 100,
        directionState: 0,
        maneuverStep: 0,
        fireTimer: 120 + Math.floor(Math.random() * 60),
        burstRemaining: 0
    });
    return e;
}

export function sysFlyingEnemies(ecs: Registry, room: Room) {
    if (!room.level || !room.level.rawMap) return;

    const waveIndex = Math.floor(globalWaveTimer / 8) % 8;
    globalWaveTimer = (globalWaveTimer + 1) % 64;

    for (const [e, enemy] of ecs.flyingEnemies.entries()) {
        if (!enemy.active) continue;
        const t = ecs.transforms.get(e)!;

        // 1. Probabilistic PRNG Projectile Firing ($00030E00)
        if (--enemy.fireTimer <= 0) {
            const angle = Math.random() * Math.PI * 2;
            const bulletSpeed = 1.5 + Math.random() * 1.0;
            const vx = Math.cos(angle) * bulletSpeed;
            const vy = Math.sin(angle) * bulletSpeed;

            spawnBullet(ecs, t.x + 16, t.y + 16, vx, vy, false, 'npc', 150);
            ecs.events.push({ type: 'sound', soundId: 10, x: t.x, y: t.y });

            if (enemy.burstRemaining > 0) {
                // Completed follow-up shot -> long cooldown
                enemy.burstRemaining = 0;
                enemy.fireTimer = 150 + Math.floor(Math.random() * 90);
            } else if (Math.random() < 0.35) {
                // PRNG match (~35% chance): Queue a rapid second shot in 8-12 frames
                enemy.burstRemaining = 1;
                enemy.fireTimer = 8 + Math.floor(Math.random() * 5);
            } else {
                // Single shot -> direct long cooldown
                enemy.fireTimer = 150 + Math.floor(Math.random() * 90);
            }
        }

        // 2. Waypoint Grid Check
        if (enemy.maneuverStep === 0) {
            const tileX = Math.floor(t.x / TILE_SIZE);
            const tileY = Math.floor(t.y / TILE_SIZE);
            const tileId = room.level.rawMap[tileY]?.[tileX];

            if (tileId !== undefined && tileId >= 0xF0 && tileId <= 0xFB) {
                enemy.directionState = tileId - 0xF0;
            }
        }

        // 3. Movement Wave / Cornering ($0003100A)
        if (enemy.directionState >= 8) {
            const table = CORNER_TABLES[enemy.directionState] || CORNER_TABLES[8];
            t.x += table[enemy.maneuverStep] * 0.75;
            t.y += table[enemy.maneuverStep + 1] * 0.75;

            enemy.maneuverStep += 2;
            if (enemy.maneuverStep >= 48) {
                enemy.maneuverStep = 0;
                enemy.directionState = (enemy.directionState - 8) % 4;
            }
        } else {
            const dir = CARDINAL_VECTORS[enemy.directionState % 4];
            const speed = WAVE_SPEED_MODIFIERS[waveIndex];

            t.x += dir.x * speed;
            t.y += dir.y * speed;
        }

        // 4. Player Impact Collision
        for (const [pe, p] of ecs.players.entries()) {
            if (p.isDead) continue;
            const pt = ecs.transforms.get(pe);
            if (pt && Math.hypot(pt.x - t.x, pt.y - t.y) < 18) {
                killPlayer(ecs, pe);
            }
        }
    }
}