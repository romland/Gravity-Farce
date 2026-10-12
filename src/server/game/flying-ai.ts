import { Registry, type Entity } from '../core/ecs';
import type { Room } from '../Room';
import { killPlayer, spawnBullet, bumpPlayer } from './combat';
import { getPathManager } from './flying-paths';

const TILE_SIZE = 32;

// Set to an array of enemy debugIds to isolate logs, or null to log all waypoint hits
const DEBUG_TARGET_IDS: number[] | null = [];//[];//[ 6, 8 ];

export interface FlyingEnemySpecs {
    hp: number;         // -1 (0xFFFF) = Indestructible sentinel value in org 68k
    scoreValue: number;
    canShoot: boolean;  // Word 4 Bit 1 (0x02) Weapon Flag
    spawnsDebris: boolean;
    width: number;
    height: number;
    bulletSpeed: number;
    rotates: boolean;
}

// Memory-verified template structs mapped directly from RAM $00031570
// Enemy traversal speed is globally fixed to 1 unit/frame. 'bulletSpeed' is decoded from the BCD array at offset +$0A.
const FLYING_ENEMY_TEMPLATES: Record<number, FlyingEnemySpecs> = {
    0xE4: { hp: 8,  scoreValue: 100, canShoot: true,  spawnsDebris: false, width: 96, height: 64, bulletSpeed: 1.2, rotates: false },
    0xE5: { hp: -1, scoreValue: 200, canShoot: false, spawnsDebris: false, width: 96, height: 64, bulletSpeed: 0.0, rotates: false }, 
    0xE6: { hp: 6,  scoreValue: 100, canShoot: false, spawnsDebris: true,  width: 96, height: 64, bulletSpeed: 0.0, rotates: false },
    0xE7: { hp: 3,  scoreValue: 150, canShoot: true,  spawnsDebris: true,  width: 96, height: 64, bulletSpeed: 1.2, rotates: false },
    0xE8: { hp: 5,  scoreValue: 250, canShoot: false, spawnsDebris: true,  width: 96, height: 64, bulletSpeed: 0.0, rotates: false },
    0xE9: { hp: 12, scoreValue: 90,  canShoot: false, spawnsDebris: true,  width: 96, height: 64, bulletSpeed: 0.0, rotates: false },
    0xEA: { hp: 12, scoreValue: 100, canShoot: false, spawnsDebris: true,  width: 96, height: 64, bulletSpeed: 0.0, rotates: false },
    0xEB: { hp: -1, scoreValue: 100, canShoot: false, spawnsDebris: false, width: 96, height: 64, bulletSpeed: 0.0, rotates: false }, 
    0xEC: { hp: 6,  scoreValue: 75,  canShoot: false, spawnsDebris: true,  width: 96, height: 64, bulletSpeed: 0.0, rotates: false },
    0xED: { hp: 6,  scoreValue: 200, canShoot: false, spawnsDebris: true,  width: 96, height: 64, bulletSpeed: 0.0, rotates: false },
    0xEE: { hp: 9,  scoreValue: 100, canShoot: false, spawnsDebris: true,  width: 96, height: 64, bulletSpeed: 0.0, rotates: false },
    0xEF: { hp: 25, scoreValue: 80,  canShoot: false, spawnsDebris: true,  width: 96, height: 64, bulletSpeed: 0.0, rotates: false }
};

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
        canShoot: specs.canShoot,
        spawnsDebris: specs.spawnsDebris,
        width: specs.width,
        height: specs.height,
        startX: x,
        startY: y,
        fireTimer: 120 + Math.floor(Math.random() * 60),
        burstRemaining: 0,
        damageHistory: {}
    });

    // Note: This may log twice in rapid succession on initial connect due to the
    // client's dev-reload mechanism automatically requesting a level reset/jump.
    if (DEBUG_TARGET_IDS === null || DEBUG_TARGET_IDS.includes(debugId)) {
        const tileX = Math.floor(x / TILE_SIZE);
        const tileY = Math.floor(y / TILE_SIZE);
        console.log(`[${new Date().toISOString()}] [DEBUG] FlyingEnemy Spawned! ID: ${debugId} | Type: 0x${type.toString(16).toUpperCase()} | Pos: ${x.toFixed(1)},${y.toFixed(1)} | Started at: [Col ${tileX}, Row ${tileY}]`);
    }    
    return e;
}

export function sysFlyingEnemies(ecs: Registry, room: Room) {
    if (!room.level || !room.level.rawMap) return;

    const pathManager = getPathManager(room.levelIndex, room.level.rawMap);

    for (const [e, enemy] of ecs.flyingEnemies.entries()) {
        if (!enemy.active) continue;
        const t = ecs.transforms.get(e)!;
        const specs = FLYING_ENEMY_TEMPLATES[enemy.enemyType];

        if (!enemy.segmentId) {
            const tileX = Math.floor(enemy.startX / TILE_SIZE);
            const tileY = Math.floor(enemy.startY / TILE_SIZE);
            const startSeg = pathManager.startMap.get(`${tileX},${tileY}`);
            if (startSeg) {
                enemy.segmentId = startSeg;
                enemy.pointIndex = 0;
            }
        }

        if (enemy.segmentId) {
            const segment = pathManager.segments.get(enemy.segmentId);
            if (segment && segment.points.length > 0) {
                // Amiga engine natively moves flying enemies at 1 absolute unit per frame.
                // Scaled to 60hz interpolation:
                let remainingMove = 3.1; //1.0 * 3.333; 

                while (remainingMove > 0) {
                    const nextPt = segment.points[enemy.pointIndex || 0];
                    if (!nextPt) {
                        if (segment.nextIds.length > 0) {
                            const pickIdx = (room.globalWaveTimer % segment.nextIds.length);
                            const nextLink = segment.nextIds[pickIdx];
                            const [nSeg, nPt] = nextLink.split(':');
                            enemy.segmentId = nSeg;
                            enemy.pointIndex = parseInt(nPt || '0', 10);
                            break;
                        } else {
                            break; 
                        }
                    }

                    const dx = nextPt.x - t.x;
                    const dy = nextPt.y - t.y;
                    const dist = Math.hypot(dx, dy);

                    if (specs.rotates && dist > 0.1) {
                        const targetAngle = Math.atan2(dy, dx);
                        let diff = targetAngle - t.angle;
                        while (diff > Math.PI) diff -= Math.PI * 2;
                        while (diff < -Math.PI) diff += Math.PI * 2;
                        t.angle += diff * 0.15; // Smooth rotation to hide pixel stair-stepping
                    }

                    if (dist <= remainingMove) {
                        t.x = nextPt.x;
                        t.y = nextPt.y;
                        remainingMove -= dist;
                        enemy.pointIndex = (enemy.pointIndex || 0) + 1;
                    } else {
                        t.x += (dx / dist) * remainingMove;
                        t.y += (dy / dist) * remainingMove;
                        remainingMove = 0;
                    }
                }
            }
        }

        // 1. Firing Loop (Bit 1 / 0x02 Capability Check)
        if (enemy.canShoot && --enemy.fireTimer <= 0) {
            const angle = Math.random() * Math.PI * 2;
            const bulletSpeed = specs.bulletSpeed * 2.0; // Scaled to modern TILE_SIZE
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

        // 4. Collision Check
        for (const [pe, p] of ecs.players.entries()) {
            if (p.isDead) continue;
            const pt = ecs.transforms.get(pe);
            if (pt && Math.abs(pt.x - t.x) <= (enemy.width / 2 + 14) && Math.abs(pt.y - t.y) <= (enemy.height / 2 + 14)) {
                if (room.category === 'race' && !room.isLethalRacing) {
                    bumpPlayer(ecs, room, pe, t.x, t.y, 6.0);
                } else {
                    killPlayer(ecs, pe, room);
                }
            }
        }

    }
}
