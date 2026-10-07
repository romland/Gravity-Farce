import { Registry, type Entity } from '../core/ecs';
import type { Room } from '../Room';
import { killPlayer } from './combat';
import { spawnBullet } from './combat';

const TANK_SPEED = 1.0; // Pixels per frame
const TILE_SIZE = 32;
const MOVEMENT_FRAMES = TILE_SIZE / TANK_SPEED; // E.g., 16 frames to traverse one 32px tile

export function spawnTank(ecs: Registry, x: number, y: number, debugId: number): Entity {
    const e = ecs.create();
    ecs.transforms.set(e, { x, y, angle: 0 });
    ecs.tanks.set(e, {
        active: true,
        hp: 1,
        debugId,
        moveTimer: 0,
        dirX: 1, // Default start direction
        dirY: 0,
        scoreValue: 50,
        width: 32,
        height: 24
    });
    return e;
}

export function sysTanks(ecs: Registry, room: Room) {
    if (!room.level || !room.level.rawMap) return;

    for (const [e, tank] of ecs.tanks.entries()) {
        if (!tank.active) continue;
        const t = ecs.transforms.get(e)!;

        // Amiga Math: If timer > 0, we are mid-transit to the next tile. Move and decrement.
        if (tank.moveTimer > 0) {
            t.x += tank.dirX * TANK_SPEED;
            t.y += tank.dirY * TANK_SPEED;
            tank.moveTimer--;
        } 
        // Timer is 0: We have arrived cleanly at a tile center. Decide next direction.
        else {
            const tileX = Math.floor(t.x / TILE_SIZE);
            const tileY = Math.floor(t.y / TILE_SIZE);
            
            const nextNode = findNextPathNode(room.level.rawMap, tileX, tileY, tank.dirX, tank.dirY);
            
            if (nextNode) {
                tank.dirX = nextNode.dx;
                tank.dirY = nextNode.dy;
                tank.moveTimer = MOVEMENT_FRAMES;
            } else {
                // End of path or trapped. Reverse direction entirely.
                tank.dirX *= -1;
                tank.dirY *= -1;
                tank.moveTimer = MOVEMENT_FRAMES;
            }
        }

        // Authoritative Anti-Cheat: Server decides if a tank runs over a player
        checkTankPlayerCollisions(ecs, t.x, t.y);
        
        // TODO: REVERSE ENGINEER AUTHENTIC TANK SHOOTING RNG FROM 68K ASSEMBLY.
        // Placeholder implementation until we find the real trigger mechanism.
        if (Math.random() < 0.005) {
            // Spawns bullet at center-top of tank, traveling straight up (-5.0 velocity)
            spawnBullet(ecs, t.x, t.y - 12, 0, -5.0, false, 'npc', 120);
            ecs.events.push({ type: 'sound', soundId: 9, x: t.x, y: t.y });
        }
    }
}

function findNextPathNode(map: number[][], cx: number, cy: number, currentDx: number, currentDy: number): { dx: number, dy: number } | null {
    // Prefer continuing straight
    if (isPathNode(map, cx + currentDx, cy + currentDy)) {
        return { dx: currentDx, dy: currentDy };
    }
    
    // Otherwise, check perpendicular turns
    const options = [
        { dx: 1, dy: 0 }, { dx: -1, dy: 0 },
        { dx: 0, dy: 1 }, { dx: 0, dy: -1 }
    ];

    for (const opt of options) {
        // Don't immediately reverse unless it's a dead end
        if (opt.dx === -currentDx && opt.dy === -currentDy) continue;
        
        if (isPathNode(map, cx + opt.dx, cy + opt.dy)) {
            return opt;
        }
    }
    return null;
}

function isPathNode(map: number[][], x: number, y: number): boolean {
    const tile = map[y]?.[x];
    // 0x32 through 0x3A are tank path nodes in the tile dictionary
    return tile !== undefined && tile >= 0x32 && tile <= 0x3A;
}

function checkTankPlayerCollisions(ecs: Registry, tx: number, ty: number) {
    for (const [pe, p] of ecs.players.entries()) {
        if (p.isDead) continue;
        const pt = ecs.transforms.get(pe);
        if (pt && Math.hypot(pt.x - tx, pt.y - ty) < 16) {
            killPlayer(ecs, pe);
        }
    }
}