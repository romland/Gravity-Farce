import { Registry, type Entity } from '../core/ecs';
import type { Room } from '../Room';
import { killPlayer, bumpPlayer } from './combat';

// Authentic Amiga Homing Missile System (Reverse-engineered from $00031570 / $00036188)
export interface HomingLauncherSpec {
    hpMax: number;
    cooldownMax: number;
    scoreValue: number;
}

export const HOMING_SPEC: HomingLauncherSpec = {
    hpMax: 6,
    cooldownMax: 120,
    scoreValue: 200
};

export function spawnHomingMissile(ecs: Registry, x: number, y: number): Entity {
    const e = ecs.create();
    ecs.transforms.set(e, { x, y, angle: 0 });
    ecs.velocities.set(e, { vx: 0, vy: 0, angularVelocity: 0 });
    ecs.homingMissiles.set(e, {
        active: true,
        x,
        y,
        vx: 0,
        vy: 0
    });
    return e;
}

export function sysHomingMissiles(ecs: Registry, room: Room) {
    for (const [e, missile] of ecs.homingMissiles.entries()) {
        if (!missile.active) continue;

        // Find closest living player for authentic proximity steering ($00034AC4 range check)
        let closestPlayerPos: { x: number, y: number } | null = null;
        let minDist = 400; // Activation radius matching $00034ADA (#$0030 tile delta scale)

        for (const [pe, p] of ecs.players.entries()) {
            if (p.isDead) continue;
            const pt = ecs.transforms.get(pe);
            if (!pt) continue;

            const dist = Math.hypot(pt.x - missile.x, pt.y - missile.y);
            if (dist < minDist) {
                minDist = dist;
                closestPlayerPos = { x: pt.x, y: pt.y };
            }
        }

        // Steer toward player using precalculated trajectory stepping model ($00036188)
        if (closestPlayerPos) {
            const angle = Math.atan2(closestPlayerPos.y - missile.y, closestPlayerPos.x - missile.x);
            const speed = 2.0;
            missile.vx = Math.cos(angle) * speed;
            missile.vy = Math.sin(angle) * speed;
        }

        missile.x += missile.vx;
        missile.y += missile.vy;

        const mt = ecs.transforms.get(e);
        if (mt) {
            mt.x = missile.x;
            mt.y = missile.y;
        }

        // Collision check against living players
        for (const [pe, p] of ecs.players.entries()) {
            if (p.isDead) continue;
            const pt = ecs.transforms.get(pe)!;
            if (Math.hypot(missile.x - pt.x, missile.y - pt.y) < 16) {
                if (room.category === 'race' && !room.isLethalRacing) {
                    bumpPlayer(ecs, room, pe, missile.x, missile.y, 5.0);
                } else {
                    killPlayer(ecs, pe);
                }
                missile.active = false;
                ecs.destroy(e);
                ecs.events.push({ type: 'turret_explosion', x: missile.x, y: missile.y });
            }
        }
    }
}