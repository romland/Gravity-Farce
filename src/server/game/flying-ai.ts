import { Registry, type Entity } from '../core/ecs';
import type { Room } from '../Room';
import { killPlayer, spawnBullet, bumpPlayer } from './combat';
import { getPathManager } from './flying-paths';
import { SERVER_CONFIG } from '../core/config';
import { checkShipBoxCollision } from './player-shared';

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
    0xE4: { hp: 8,  scoreValue: 100, canShoot: true,  spawnsDebris: false, width: 192, height: 128, bulletSpeed: 1.2, rotates: false },
    0xE5: { hp: -1, scoreValue: 200, canShoot: false, spawnsDebris: false, width: 192, height: 128, bulletSpeed: 0.0, rotates: false }, 
    0xE6: { hp: 6,  scoreValue: 100, canShoot: false, spawnsDebris: true,  width: 192, height: 128, bulletSpeed: 0.0, rotates: false },
    0xE7: { hp: 3,  scoreValue: 150, canShoot: true,  spawnsDebris: true,  width: 192, height: 128, bulletSpeed: 1.2, rotates: false },
    0xE8: { hp: 5,  scoreValue: 250, canShoot: false, spawnsDebris: true,  width: 192, height: 128, bulletSpeed: 0.0, rotates: false },
    0xE9: { hp: 12, scoreValue: 90,  canShoot: false, spawnsDebris: true,  width: 192, height: 128, bulletSpeed: 0.0, rotates: false },
    0xEA: { hp: 12, scoreValue: 100, canShoot: false, spawnsDebris: true,  width: 192, height: 128, bulletSpeed: 0.0, rotates: false },
    0xEB: { hp: -1, scoreValue: 100, canShoot: false, spawnsDebris: false, width: 192, height: 128, bulletSpeed: 0.0, rotates: false }, 
    0xEC: { hp: 6,  scoreValue: 75,  canShoot: false, spawnsDebris: true,  width: 192, height: 128, bulletSpeed: 0.0, rotates: false },
    0xED: { hp: 6,  scoreValue: 200, canShoot: false, spawnsDebris: true,  width: 192, height: 128, bulletSpeed: 0.0, rotates: false },
    0xEE: { hp: 9,  scoreValue: 100, canShoot: false, spawnsDebris: true,  width: 192, height: 128, bulletSpeed: 0.0, rotates: false },
    0xEF: { hp: 25, scoreValue: 80,  canShoot: false, spawnsDebris: true,  width: 192, height: 128, bulletSpeed: 0.0, rotates: false }
};

export function spawnFlyingEnemy(ecs: Registry, x: number, y: number, type: number, debugId: number, prng: () => number = Math.random): Entity {
    const specs = FLYING_ENEMY_TEMPLATES[type] || FLYING_ENEMY_TEMPLATES[0xE4];

    // Level loader passes x,y as the center of the 32x32 spawn tile.
    // The Amiga spawned them with the top-left of the enemy at the top-left of the tile.
    const startCenterX = (x - 16) + (specs.width / 2);
    const startCenterY = (y - 16) + (specs.height / 2);

    const e = ecs.create();
    ecs.transforms.set(e, { x: startCenterX, y: startCenterY, angle: 0 });
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
        fireTimer: 120 + Math.floor(prng() * 60),
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
    const AMIGA_SPEED = 50 / SERVER_CONFIG.tickRate;

    for (const [e, enemy] of ecs.flyingEnemies.entries()) {
        if (!enemy.active) continue;
        const t = ecs.transforms.get(e)!;
        const prevX = t.x;
        const prevY = t.y;
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
                const floatIndex = enemy.pointIndex || 0;
                const currentIndex = Math.floor(floatIndex);
                const pt1 = segment.points[currentIndex];
                if (!pt1) {
                    if (segment.nextIds.length > 0) {
                        const pickIdx = (room.globalWaveTimer % segment.nextIds.length);
                        const nextLink = segment.nextIds[pickIdx];
                        const [nSeg, nPt] = nextLink.split(':');
                        enemy.segmentId = nSeg;
                        // Preserve the fractional overflow so speed remains perfectly consistent across segment jumps
                        enemy.pointIndex = parseInt(nPt || '0', 10) + (floatIndex - currentIndex);
                        continue; // Process jump on next tick
                    }
                } else {
                    const nextIndex = Math.min(currentIndex + 1, segment.points.length - 1);
                    const pt2 = segment.points[nextIndex];
                    const fraction = floatIndex - currentIndex;
                    const lerpX = pt1.x + (pt2.x - pt1.x) * fraction;
                    const lerpY = pt1.y + (pt2.y - pt1.y) * fraction;

                    if (specs.rotates) {
                        // Look ahead a few frames to smooth out stair-stepping angles
                        const lookAhead = segment.points[Math.min(currentIndex + 4, segment.points.length - 1)];
                        if (lookAhead) {
                            const dy = (lookAhead.y + (enemy.height / 2)) - t.y;
                            const dx = (lookAhead.x + (enemy.width / 2)) - t.x;
                            if (Math.hypot(dx, dy) > 0.1) {
                                const targetAngle = Math.atan2(dy, dx);
                                let diff = targetAngle - t.angle;
                                while (diff > Math.PI) diff -= Math.PI * 2;
                                while (diff < -Math.PI) diff += Math.PI * 2;
                                t.angle += diff * 0.15;
                            }
                        }
                    }

                    t.x = lerpX + (enemy.width / 2);
                    t.y = lerpY + (enemy.height / 2);
                    enemy.lastDx = t.x - prevX;
                    enemy.lastDy = t.y - prevY;
                    enemy.pointIndex = floatIndex + AMIGA_SPEED;
                }
            }
        }

        // 1. Firing Loop (Bit 1 / 0x02 Capability Check)
        if (enemy.canShoot && --enemy.fireTimer <= 0) {
            const angle = room.prng() * Math.PI * 2;
            const bulletSpeed = specs.bulletSpeed * 2.0; // Scaled to modern TILE_SIZE
            const vx = Math.cos(angle) * bulletSpeed;
            const vy = Math.sin(angle) * bulletSpeed;

            spawnBullet(ecs, t.x, t.y, vx, vy, false, 'npc', 150);
            ecs.events.push({ type: 'sound', soundId: 10, x: t.x, y: t.y });

            if (enemy.burstRemaining > 0) {
                enemy.burstRemaining = 0;
                enemy.fireTimer = 150 + Math.floor(room.prng() * 90);
            } else if (room.prng() < 0.35) {
                enemy.burstRemaining = 1;
                enemy.fireTimer = 8 + Math.floor(room.prng() * 5);
            } else {
                enemy.fireTimer = 150 + Math.floor(room.prng() * 90);
            }
        }

        // 4. Collision Check
        for (const [pe, p] of ecs.players.entries()) {
            if (p.isDead || p.advancing || room.dogfightCompleted || p.race?.state === 2) continue;
            const pt = ecs.transforms.get(pe);
            if (pt && checkShipBoxCollision(pt.x, pt.y, pt.angle, t.x, t.y, enemy.width, enemy.height)) {
                if (room.category === 'race' && !room.isLethalRacing) {
                    bumpPlayer(ecs, room, pe, t.x, t.y, 6.0);
                } else {
                    killPlayer(ecs, pe, room);
                }
            }
        }

    }
}
