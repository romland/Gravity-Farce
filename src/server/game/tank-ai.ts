import { Registry, type Entity } from '../core/ecs';
import type { Room } from '../Room';
import { killPlayer, bumpPlayer } from './combat';
import { spawnBullet } from './combat';
import { scaleAmigaPerFrameDelta, scaleAmigaFrameTimer } from '../core/math';
import { checkShipBoxCollision } from './player-shared';

// Derived from 0x0003181A: Amiga 8px tile scaled 4x to 32px.
// At 50Hz PAL, tank moves 32px over 32 frames, evaluated every 60 ticks.
const TILE_SIZE = 32;
const TANK_SPEED = scaleAmigaPerFrameDelta(1.0 * (60 / 50));
const MOVEMENT_FRAMES = Math.round(scaleAmigaFrameTimer(32 * (50 / 60)));
const AI_EVAL_INTERVAL_TICKS = Math.max(1, Math.round(scaleAmigaFrameTimer(50)));

export function spawnTank(ecs: Registry, x: number, y: number, debugId: number): Entity {
    // Tanks sit ON the ground. Amiga size is 16x12 (64x48 scaled).
    // Amiga coordinates use Left-anchors.
    // 'x' is the 32x32 tile center. Left edge of tile is (x - 16).
    // Center of the 64px tank is left edge + 32 -> (x + 16).
    const width = 64;
    const height = 48;
    const startCenterX = x + 16;
    const startCenterY = (y + 16) - (height / 2);

    const e = ecs.create();
    ecs.transforms.set(e, { x: startCenterX, y: startCenterY, angle: 0 });
    ecs.tanks.set(e, {
        active: true,
        hp: 1,
        debugId,
        moveTimer: 0,
        dirX: 1, // Default start direction
        dirY: 0,
        scoreValue: 50,
        width,
        height,
        damageHistory: {}
    });
    return e;
}

export function sysTanks(ecs: Registry, room: Room) {
    if (!room.level || !room.level.rawMap) return;

    // Synchronization ($0003181A)
    // The original engine evaluated pathing exactly once every 32 frames.
    // Movement took 16 frames, creating a guaranteed 16-frame pause at every tile.
    const evaluateAI = room.globalWaveTimer % AI_EVAL_INTERVAL_TICKS === 0;

    for (const [e, tank] of ecs.tanks.entries()) {
        if (!tank.active) continue;
        const t = ecs.transforms.get(e)!;

        if (tank.moveTimer > 0) {
            t.x += tank.dirX * TANK_SPEED;
            t.y += tank.dirY * TANK_SPEED;
            tank.moveTimer--;
        } 
        else {
            // Grid evaluation strictly uses the Left edge (lsr.w #3).
            const amigaLeftX = t.x - (tank.width / 2);
            
            const tileX = Math.floor(amigaLeftX / TILE_SIZE);
            const tileY = Math.floor(t.y / TILE_SIZE);
            
            // Snap the Left edge to the exact tile boundary, then restore center
            t.x = (tileX * TILE_SIZE) + (tank.width / 2);
            t.y = (tileY * TILE_SIZE) + TILE_SIZE - (tank.height / 2);
            
            if (evaluateAI) {
                // $0003181C is seeded via add.w 0xdff006 (VHPOSR) every frame, creating pseudo-RNG.
                const checkRight = room.prng() < 0.5;
                
                if (checkRight) {
                    if (isPathNode(room.level.rawMap, tileX + 1, tileY)) {
                        tank.dirX = 1;
                        tank.moveTimer = MOVEMENT_FRAMES;
                    } else {
                        tank.dirX = 0;
                    }
                } else {
                    if (isPathNode(room.level.rawMap, tileX - 1, tileY)) {
                        tank.dirX = -1;
                        tank.moveTimer = MOVEMENT_FRAMES;
                    } else {
                        tank.dirX = 0;
                    }
                }
            }
        }

        checkTankPlayerCollisions(ecs, room, t.x, t.y, tank.width, tank.height);
        
        // "Sprinkler" Firing Trigger & Trajectory
        // The Amiga evaluates a chaotic global byte ($0003181E) built from player/scroll coords.
        // It fires only when this byte == 0 (chance of 1/256 per frame).
        if (room.prng() < 0.0039) {
            // The firing angle is calculated by taking another chaotic byte ($0003181D),
            // shifting right by 3 (range 0-31), and adding 36.
            // In a 72-index circle, indices 36 to 67 form an arc from Left (36), to Up (54), to Up-Right (67).
            const amigaIndex = 36 + Math.floor(room.prng() * 32);
            const angle = (amigaIndex / 72) * (Math.PI * 2);
            
            // Fixed-point magnitude #0x03E8 (1000) scaled to modern view (2.0)
            spawnBullet(ecs, t.x, t.y - (tank.height / 2), Math.cos(angle) * 2.0, Math.sin(angle) * 2.0, false, 'npc', 120);
            ecs.events.push({ type: 'sound', soundId: 9, x: t.x, y: t.y });
        }
    }
}

function isPathNode(map: number[][], x: number, y: number): boolean {
    const tile = map[y]?.[x];
    return tile === 0x32 || tile === 0x33;
}

function checkTankPlayerCollisions(ecs: Registry, room: Room, tx: number, ty: number, tWidth: number, tHeight: number) {
    for (const [pe, p] of ecs.players.entries()) {
        if (p.isDead || p.advancing || room.dogfightCompleted || p.race?.state === 2) {
            continue;
        }

        const pt = ecs.transforms.get(pe);

        if (pt && checkShipBoxCollision(pt.x, pt.y, pt.angle, tx, ty, tWidth, tHeight)) {
            if (room.category === 'race' && !room.isLethalRacing) {
                bumpPlayer(ecs, room, pe, tx, ty, 6.0);
            } else {
                killPlayer(ecs, pe, room);
            }
        }
    }
}
