import { Registry, type Entity } from '../core/ecs';
import type { Room } from '../Room';
import { killPlayer } from './combat';

const TILE_SIZE = 32;

// The standard vectors from $000313C2
const VECTORS = [
    { vx: 1.0, vy: 0.0 },   // State 0: Right
    { vx: 0.0, vy: 1.0 },   // State 1: Down
    { vx: -1.0, vy: 0.0 },  // State 2: Left
    { vx: 0.0, vy: -1.0 }   // State 3: Up
];

export function spawnFlyingEnemy(ecs: Registry, x: number, y: number, type: number): Entity {
    const e = ecs.create();
    ecs.transforms.set(e, { x, y, angle: 0 });
    
    ecs.flyingEnemies.set(e, {
        active: true,
        hp: 3,
        enemyType: type,
        scoreValue: type === 0xE7 ? 250 : 100,
        speedScalar: 2.0, 
        directionState: 0, 
        maneuverStep: 0    // Matches Amiga +$1A
    });
    return e;
}

export function sysFlyingEnemies(ecs: Registry, room: Room) {
    if (!room.level || !room.level.rawMap) return;

    for (const [e, enemy] of ecs.flyingEnemies.entries()) {
        if (!enemy.active) continue;
        const t = ecs.transforms.get(e)!;

        // 1. Waypoint Overlap Check (Only if maneuver step is 0)
        if (enemy.maneuverStep === 0) {
            const tileX = Math.floor(t.x / TILE_SIZE);
            const tileY = Math.floor(t.y / TILE_SIZE);
            const tileId = room.level.rawMap[tileY]?.[tileX];

            if (tileId !== undefined && tileId >= 0xF0 && tileId <= 0xFB) {
                const waypointId = tileId - 0xF0;
                // Amiga directly writes Waypoint ID to Trajectory State
                enemy.directionState = waypointId;
            }
        }

        // 2. Integration
        if (enemy.directionState >= 8) {
            // State 8-11: 24-Frame Micro-Maneuver ($000311FC)
            enemy.maneuverStep += 2;
            if (enemy.maneuverStep >= 48) {
                enemy.maneuverStep = 0; // Maneuver complete, regains map vision next frame
            }
            
            // Placeholder logic: Maintain approximate path momentum until table is dumped
            const vec = VECTORS[enemy.directionState % 4];
            t.x += vec.vx * (enemy.speedScalar * 0.5);
            t.y += vec.vy * (enemy.speedScalar * 0.5);
        } else {
            // Standard Cardinal Movement
            const vec = VECTORS[enemy.directionState % 4];
            t.x += vec.vx * enemy.speedScalar;
            t.y += vec.vy * enemy.speedScalar;
            t.angle = Math.atan2(vec.vy, vec.vx);
        }
        
        // 3. Player Collision
        for (const [pe, p] of ecs.players.entries()) {
            if (p.isDead) continue;
            const pt = ecs.transforms.get(pe);
            if (pt && Math.hypot(pt.x - t.x, pt.y - t.y) < 18) {
                killPlayer(ecs, pe);
            }
        }
    }
}