import { Registry, type Entity } from '../core/ecs';
import { killPlayer, checkPvPCollisions } from './combat';
import { normalizeAngle } from '../core/math';
import type { Room } from '../Room';
import { getShipPolygon, checkEnvironmentCollisions } from './player-shared';

const GRAVITY = 0.015; const THRUST = 0.10;
const DRAG = 0.996; const MAX_VEL = 10.0;
const MAGNET_FORCE = THRUST * 0.5; // Scaled to 50% of engine power

export function spawnModernPlayer(ecs: Registry, id: string, x: number, y: number): Entity {
    const e = ecs.create();
    ecs.transforms.set(e, { x, y, angle: -Math.PI / 2 });
    ecs.velocities.set(e, { vx: 0, vy: 0, angularVelocity: 0 });
    ecs.players.set(e, {
        id,
        type: 'modern',
        isDead: false,
        inputs: { up: false, left: false, right: false, shoot: false },
        shootLatch: false,
        prevShoot: false,
        gunCooldown: 0,
        respawnRequest: false,
        angleAcc: 0,
        angleStep: 0,
        isLanded: false,
        score: 0
    });
    return e;
}

export function sysModernPlayers(ecs: Registry, room: Room) {
    for (const [e, p] of ecs.players.entries()) {
        if (p.type !== 'modern' || p.isDead) continue;
        const t = ecs.transforms.get(e)!;
        const v = ecs.velocities.get(e)!;

        if (p.isLanded) {
            v.vx = 0; 
            v.vy = 0; 
            v.angularVelocity = 0; 
            t.angle = -Math.PI / 2;
            if (p.inputs.up) {
                p.isLanded = false;
                v.vy = -1.2;
            } else {
                continue;
            }
        }

        if (p.inputs.left) {
            v.angularVelocity -= 0.004;
        }
        if (p.inputs.right) {
            v.angularVelocity += 0.004;
        }
        v.angularVelocity *= 0.93; 
        t.angle += v.angularVelocity;

        if (p.inputs.up) {
            v.vx += Math.cos(t.angle) * THRUST;
            v.vy += Math.sin(t.angle) * THRUST;
        }
        
        // Gravity Wells / Magnets (0xCC - 0xCF)
        if (room.level && room.level.rawMap) {
            const tileX = Math.floor(t.x / 32);
            const tileY = Math.floor(t.y / 32);
            const tileId = room.level.rawMap[tileY]?.[tileX];
            
            if (tileId !== undefined) {
                if (tileId === 0xCC) v.vx += MAGNET_FORCE; // Right (Dir 01)
                if (tileId === 0xCD) v.vy += MAGNET_FORCE; // Down  (Dir 01)
                if (tileId === 0xCE) v.vx -= MAGNET_FORCE; // Left  (Dir 00)
                if (tileId === 0xCF) v.vy -= MAGNET_FORCE; // Up    (Dir 00)
            }
        }

        v.vy += GRAVITY;
        v.vx *= DRAG; 
        v.vy *= DRAG;

        const speed = Math.hypot(v.vx, v.vy);
        if (speed > MAX_VEL) { 
            v.vx = (v.vx / speed) * MAX_VEL; 
            v.vy = (v.vy / speed) * MAX_VEL; 
        }

        t.x += v.vx; 
        t.y += v.vy;

        let advancing = false;
        
        const sl = getShipPolygon(t.x, t.y, t.angle, 16, 16);
        const diff = normalizeAngle(t.angle);
        const canLand = () => v.vy >= 0 && speed < 2.5 && Math.abs(diff) < 0.25;

        const crashed = checkEnvironmentCollisions(sl, t.x, t.y, room.level, canLand, (landY, isEndPad) => {
            p.isLanded = true;
            t.y = landY; 
            v.vy = 0; 
            v.vx = 0; 
            t.angle = -Math.PI / 2; // Snap perfectly upright
            v.angularVelocity = 0;

            if (isEndPad && !p.inputs.up) {
                advancing = true; 
                room.transitionPlayer(p.id); 
            }
        });

        if (crashed && !advancing) {
            killPlayer(ecs, e);
        }
    }
}
