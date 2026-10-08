import { Registry, type Entity } from '../core/ecs';
import type { Room } from '../Room';
import { killPlayer, spawnBullet } from './combat';

const TILE_SIZE = 32;

// Set to an array of enemy debugIds to isolate logs, or null to log all waypoint hits
const DEBUG_TARGET_IDS: number[] | null = null;//[];//[ 6, 8 ];

export interface FlyingEnemySpecs {
    hp: number;         // -1 (0xFFFF) = Indestructible sentinel value in org 68k
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
    11: { x: -0.707, y: -0.707 },// FB: Up-Left
    12: { x: 0.0, y: 1.0 },     // FC: Down
    13: { x: -1.0, y: 0.0 },    // FD: Left
    14: { x: 0.0, y: -1.0 },    // FE: Up
    15: { x: 1.0, y: 0.0 }      // FF: Right
};

// Authentic Amiga cornering arc trajectories for states 8-15 ($00031242 table approximation)
function getCorneringVector(state: number, step: number): { x: number, y: number } {
    // States 8-11: Diagonal reflectors (F8-FB)
    // States 12-15: Curve transition nodes (FC-FF)
    switch (state) {
        case 8:  case 14: return { x: 0.707, y: -0.707 }; // Up-Right arc
        case 9:  case 15: return { x: 0.707, y:  0.707 }; // Down-Right arc
        case 10: case 12: return { x: -0.707, y: 0.707 }; // Down-Left arc
        case 11: case 13: return { x: -0.707, y: -0.707 };// Up-Left arc
        default: {
            const base = DIRECTION_VECTORS[state];
            if (base) return base;
            return { x: 1.0, y: 0.0 };
        }
    }
}

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
        startX: x,
        startY: y,
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

            if (tileId !== undefined && tileId >= 0xF0 && tileId <= 0xFF) {
                if (tileId >= 0xF4 && tileId <= 0xF7) {
                    // Ignore swarm sync nodes F4-F7 for now
                } else {
                    let newState = tileId - 0xF0;
                    if (newState !== enemy.directionState) {
                        const centerX = tileX * TILE_SIZE + TILE_SIZE / 2;
                        const centerY = tileY * TILE_SIZE + TILE_SIZE / 2;
                        const currentDir = DIRECTION_VECTORS[enemy.directionState] || DIRECTION_VECTORS[0];
                        const dotProduct = (centerX - t.x) * currentDir.x + (centerY - t.y) * currentDir.y;

                        // Only change direction once the enemy has reached/passed the exact center of the waypoint tile
                        if (dotProduct <= 0) {
                            if (DEBUG_TARGET_IDS === null || DEBUG_TARGET_IDS.includes(enemy.debugId)) {
                                const startCol = Math.floor(enemy.startX / TILE_SIZE);
                                const startRow = Math.floor(enemy.startY / TILE_SIZE);
                                console.log(`[${new Date().toISOString()}] [DEBUG] FlyingEnemy Waypoint Hit! ID: ${enemy.debugId} | Type: 0x${enemy.enemyType.toString(16).toUpperCase()} | Waypoint: 0x${tileId.toString(16).toUpperCase()} | State: ${enemy.directionState} -> ${newState} | Pos: ${centerX.toFixed(1)},${centerY.toFixed(1)} | Started at: [Col ${startCol}, Row ${startRow}] | Data: ${JSON.stringify(enemy)}`);
                            }
                            enemy.directionState = newState;
                            enemy.maneuverStep = 2; // Start 24-frame blindfold
                            t.x = centerX; // Snap to exact center to clear floating-point drift
                            t.y = centerY;
                        }
                    }
                }
            }
        } else {
            enemy.maneuverStep += 2;
            if (enemy.maneuverStep >= 48) {
                enemy.maneuverStep = 0;
            }
        }

        // 3. Movement Integration
        const dir = getCorneringVector(enemy.directionState, enemy.maneuverStep);
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