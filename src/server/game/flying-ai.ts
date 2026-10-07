import { Registry, type Entity } from '../core/ecs';
import type { Room } from '../Room';
import { killPlayer, spawnBullet } from './combat';

const TILE_SIZE = 32;

// Set to an array of enemy debugIds to isolate logs, or null to log all waypoint hits
const DEBUG_TARGET_IDS: number[] | null = [ 6, 8 ];

export interface FlyingEnemySpecs {
    hp: number;         // -1 (0xFFFF) = Indestructible sentinel value in 68k binary
    speedScalar: number;
    scoreValue: number;
    canShoot: boolean;  // Word 4 Bit 1 (0x02) Weapon Flag
    width: number;
    height: number;
}

// Memory-verified template structs mapped directly from RAM $00031570 (Tile E3 is Index 0)
const FLYING_ENEMY_TEMPLATES: Record<number, FlyingEnemySpecs> = {
    0xE4: { hp: 8,  speedScalar: 1.0, scoreValue: 100, canShoot: true,  width: 96, height: 64 },
    0xE5: { hp: -1, speedScalar: 1.0, scoreValue: 200, canShoot: false, width: 96, height: 64 }, 
    0xE6: { hp: 6,  speedScalar: 1.0, scoreValue: 100, canShoot: false, width: 96, height: 64 },
    0xE7: { hp: 3,  speedScalar: 1.0, scoreValue: 150, canShoot: true,  width: 96, height: 64 },
    0xE8: { hp: 5,  speedScalar: 1.0, scoreValue: 250, canShoot: false, width: 96, height: 64 },
    0xE9: { hp: 12, speedScalar: 1.0, scoreValue: 90,  canShoot: false, width: 96, height: 64 },
    0xEA: { hp: 12, speedScalar: 1.0, scoreValue: 100, canShoot: false, width: 96, height: 64 },
    0xEB: { hp: -1, speedScalar: 1.0, scoreValue: 100, canShoot: false, width: 96, height: 64 }, 
    0xEC: { hp: 6,  speedScalar: 1.0, scoreValue: 75,  canShoot: false, width: 96, height: 64 },
    0xED: { hp: 6,  speedScalar: 1.0, scoreValue: 200, canShoot: false, width: 96, height: 64 },
    0xEE: { hp: 9,  speedScalar: 1.0, scoreValue: 100, canShoot: false, width: 96, height: 64 },
    0xEF: { hp: 25, speedScalar: 1.0, scoreValue: 80,  canShoot: false, width: 96, height: 64 }
};

const DIRECTION_VECTORS: Record<number, {x: number, y: number}> = {
    0: { x: 1.0, y: 0.0 },   // F0: Right
    1: { x: 0.0, y: 1.0 },   // F1: Down
    2: { x: -1.0, y: 0.0 },  // F2: Left
    3: { x: 0.0, y: -1.0 },  // F3: Up
    8: { x: 0.707, y: -0.707 }, // F8: Up-Right
    9: { x: 0.707, y: 0.707 },  // F9: Down-Right
    10: { x: -0.707, y: 0.707 },// FA: Down-Left
    11: { x: -0.707, y: -0.707 }// FB: Up-Left
};

const WAVE_SPEED_MODIFIERS = [1.25, 1.35, 1.50, 1.65, 1.75, 1.65, 1.50, 1.35];

let globalWaveTimer = 0;

export function spawnFlyingEnemy(ecs: Registry, x: number, y: number, type: number, debugId: number): Entity {
    const specs = FLYING_ENEMY_TEMPLATES[type] || FLYING_ENEMY_TEMPLATES[0xE4];

    const e = ecs.create();
    ecs.transforms.set(e, { x, y, angle: 0 });
    ecs.flyingEnemies.set(e, {
        active: true,
        hp: specs.hp,
        debugId,
        enemyType: type,
        scoreValue: specs.scoreValue,
        speedScalar: specs.speedScalar,
        canShoot: specs.canShoot,
        width: specs.width,
        height: specs.height,
        directionState: 0,
        maneuverStep: 0,
        lastWaypointX: -1,
        lastWaypointY: -1,
        fireTimer: 120 + Math.floor(Math.random() * 60),
        burstRemaining: 0
    });

    // Note: This may log twice in rapid succession on initial connect due to the
    // client's dev-reload mechanism automatically requesting a level reset/jump.
    if (DEBUG_TARGET_IDS === null || DEBUG_TARGET_IDS.includes(debugId)) {
        // console.log(`[${new Date().toISOString()}] [DEBUG] FlyingEnemy Spawned! ID: ${debugId} | Type: 0x${type.toString(16).toUpperCase()} | Pos: ${x.toFixed(1)},${y.toFixed(1)}`);
        const tileX = Math.floor(x / TILE_SIZE);
        const tileY = Math.floor(y / TILE_SIZE);
        console.log(`[${new Date().toISOString()}] [DEBUG] FlyingEnemy Spawned! ID: ${debugId} | Type: 0x${type.toString(16).toUpperCase()} | Pos: ${x.toFixed(1)},${y.toFixed(1)} | Started at: [Col ${tileX}, Row ${tileY}]`);
    }    
    return e;
}

export function sysFlyingEnemies(ecs: Registry, room: Room) {
    if (!room.level || !room.level.rawMap) return;

    const waveIndex = Math.floor(globalWaveTimer / 8) % 8;
    globalWaveTimer = (globalWaveTimer + 1) % 64;

    for (const [e, enemy] of ecs.flyingEnemies.entries()) {
        if (!enemy.active) continue;
        const t = ecs.transforms.get(e)!;

        // 1. Firing Loop (Bit 1 / 0x02 Capability Check)
        if (enemy.canShoot && --enemy.fireTimer <= 0) {
            const angle = Math.random() * Math.PI * 2;
            const bulletSpeed = 1.5 + Math.random() * 1.0;
            const vx = Math.cos(angle) * bulletSpeed;
            const vy = Math.sin(angle) * bulletSpeed;

            spawnBullet(ecs, t.x + 16, t.y + 16, vx, vy, false, 'npc', 150);
            ecs.events.push({ type: 'sound', soundId: 10, x: t.x, y: t.y });

            if (enemy.burstRemaining > 0) {
                enemy.burstRemaining = 0;
                enemy.fireTimer = 150 + Math.floor(Math.random() * 90);
            } else if (Math.random() < 0.35) {
                enemy.burstRemaining = 1;
                enemy.fireTimer = 8 + Math.floor(Math.random() * 5);
            } else {
                enemy.fireTimer = 150 + Math.floor(Math.random() * 90);
            }
        }

        // 2. Waypoint Grid Check
        if (enemy.maneuverStep === 0) {
            const tileX = Math.floor(t.x / TILE_SIZE);
            const tileY = Math.floor(t.y / TILE_SIZE);
            const tileId = room.level.rawMap[tileY]?.[tileX];

            if (tileId !== undefined && tileId >= 0xF0 && tileId <= 0xFB) {
                let newState = enemy.directionState;
                if (tileId >= 0xF0 && tileId <= 0xF3) newState = tileId - 0xF0;
                else if (tileId === 0xF9) newState = 9;  // Down-Right
                else if (tileId === 0xFA) newState = 10; // Down-Left
                else if (tileId === 0xFB) newState = 11; // Up-Left
                else if (tileId === 0xF8) newState = 8;  // Up-Right
                
                if (newState !== enemy.directionState) {
                    if (DEBUG_TARGET_IDS === null || DEBUG_TARGET_IDS.includes(enemy.debugId)) {
                        // console.log(`[${new Date().toISOString()}] [DEBUG] FlyingEnemy Waypoint Hit! ID: ${enemy.debugId} | Type: 0x${enemy.enemyType.toString(16).toUpperCase()} | Waypoint: 0x${tileId.toString(16).toUpperCase()} | State: ${enemy.directionState} -> ${newState} | Pos: ${t.x.toFixed(1)},${t.y.toFixed(1)} | Data: ${JSON.stringify(enemy)}`);
                        console.log(`[${new Date().toISOString()}] [DEBUG] FlyingEnemy Waypoint Hit! ID: ${enemy.debugId} | Type: 0x${enemy.enemyType.toString(16).toUpperCase()} | Waypoint: 0x${tileId.toString(16).toUpperCase()} | State: ${enemy.directionState} -> ${newState} | Pos: ${t.x.toFixed(1)},${t.y.toFixed(1)} | Started at: [Col ${tileX}, Row ${tileY}] | Data: ${JSON.stringify(enemy)}`);
                    }
                    enemy.directionState = newState;
                    enemy.maneuverStep = 2; // Start 24-frame blindfold
                    // t.x = tileX * TILE_SIZE + TILE_SIZE / 2;
                    // t.y = tileY * TILE_SIZE + TILE_SIZE / 2;
                }
            }
        } else {
            enemy.maneuverStep += 2;
            if (enemy.maneuverStep >= 48) {
                enemy.maneuverStep = 0;
            }
        }

        // 3. Movement Integration
        const dir = DIRECTION_VECTORS[enemy.directionState] || DIRECTION_VECTORS[0];
        const moveSpeed = WAVE_SPEED_MODIFIERS[waveIndex]; // Unmodified native speed

        t.x += dir.x * moveSpeed;
        t.y += dir.y * moveSpeed;

        // 4. Collision Check
        for (const [pe, p] of ecs.players.entries()) {
            if (p.isDead) continue;
            const pt = ecs.transforms.get(pe);
            if (pt && Math.hypot(pt.x - t.x, pt.y - t.y) < 18) {
                killPlayer(ecs, pe);
            }
        }
    }
}