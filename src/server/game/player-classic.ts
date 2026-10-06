import { Registry, type Entity } from '../core/ecs';
import { killPlayer, checkPvPCollisions } from './combat';
import type { Room } from '../Room';
import { getShipPolygon, checkEnvironmentCollisions } from './player-shared';

const ROTATION_SPEED = 1000; 
const GRAVITY = 0.010;
const THRUST_IMPULSE = 0.070; 
const DRAG = 0.997;
const MAX_SPEED = 7.5; 
const MAX_SAFE_LANDING_VY = 1.4;

export function spawnClassicPlayer(ecs: Registry, id: string, x: number, y: number): Entity {
    const e = ecs.create();
    ecs.transforms.set(e, { x, y, angle: -Math.PI / 2 });
    ecs.velocities.set(e, { vx: 0, vy: 0, angularVelocity: 0 });
    ecs.players.set(e, {
        id,
        type: 'classic',
        isDead: false,
        inputs: { up: false, left: false, right: false, shoot: false },
        shootLatch: false,
        prevShoot: false,
        gunCooldown: 0,
        respawnRequest: false,
        angleAcc: 54000,
        angleStep: 27,
        isLanded: false
    });
    return e;
}

export function sysClassicPlayers(ecs: Registry, room: Room) {
    for (const [e, p] of ecs.players.entries()) {
        if (p.type !== 'classic' || p.isDead) continue;
        const t = ecs.transforms.get(e)!;
        const v = ecs.velocities.get(e)!;

        if (p.isLanded) {
            v.vx = 0; 
            v.vy = 0; 
            p.angleAcc = 54000; 
            p.angleStep = 27; 
            t.angle = -Math.PI / 2;
            
            if (p.inputs.up) {
                p.isLanded = false;
                v.vy = -1.2;
            } else {
                continue;
            }
        }

        if (p.inputs.left) {
            p.angleAcc = (p.angleAcc - ROTATION_SPEED + 72000) % 72000;
        }
        if (p.inputs.right) {
            p.angleAcc = (p.angleAcc + ROTATION_SPEED) % 72000;
        }

        p.angleStep = Math.floor(p.angleAcc / 2000) % 36;
        t.angle = (p.angleStep * (Math.PI * 2)) / 36;

        if (p.inputs.up) {
            v.vx += Math.cos(t.angle) * THRUST_IMPULSE;
            v.vy += Math.sin(t.angle) * THRUST_IMPULSE;
        }

        v.vx *= DRAG; 
        v.vy *= DRAG; 
        v.vy += GRAVITY;
        
        const speed = Math.hypot(v.vx, v.vy);
        if (speed > MAX_SPEED) { 
            v.vx = (v.vx / speed) * MAX_SPEED; 
            v.vy = (v.vy / speed) * MAX_SPEED; 
        }
        
        t.x += v.vx; 
        t.y += v.vy;

        let advancing = false;
        const sl = getShipPolygon(t.x, t.y, t.angle, 14, 14);

        const isAngleUpright = Math.abs(p.angleStep - 27) <= 2;
        const canLand = () => v.vy >= 0 && v.vy <= MAX_SAFE_LANDING_VY && isAngleUpright;

        const land = (targetY: number) => { 
            p.isLanded = true; 
            t.y = targetY; 
            v.vy = 0; 
            v.vx = 0; 
            p.angleAcc = 54000; 
            p.angleStep = 27; 
            t.angle = -Math.PI / 2; 
        };

        const crashed = checkEnvironmentCollisions(sl, t.x, t.y, room.level, canLand, (landY, isEndPad) => {
            land(landY);
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
