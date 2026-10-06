import { Registry, type Entity } from '../core/ecs';
import { killPlayer, checkPvPCollisions } from './combat';
import { checkPolyIntersect, normalizeAngle } from '../core/math';
import type { Room } from '../Room';

const GRAVITY = 0.012; const THRUST = 0.08;
const DRAG = 0.996; const MAX_VEL = 8.0;

export function spawnModernPlayer(ecs: Registry, id: string, x: number, y: number): Entity {
    const e = ecs.create();
    ecs.transforms.set(e, { x, y, angle: -Math.PI / 2 });
    ecs.velocities.set(e, { vx: 0, vy: 0, angularVelocity: 0 });
    ecs.players.set(e, {
        id, type: 'modern', isDead: false,
        inputs: { up: false, left: false, right: false, shoot: false },
        shootLatch: false, prevShoot: false, gunCooldown: 0, respawnRequest: false,
        angleAcc: 0, angleStep: 0, isLanded: false
    });
    return e;
}

export function sysModernPlayers(ecs: Registry, room: Room) {
    for (const [e, p] of ecs.players.entries()) {
        if (p.type !== 'modern' || p.isDead) continue;
        const t = ecs.transforms.get(e)!;
        const v = ecs.velocities.get(e)!;

        if (p.inputs.left) v.angularVelocity -= 0.004;
        if (p.inputs.right) v.angularVelocity += 0.004;
        v.angularVelocity *= 0.93; t.angle += v.angularVelocity;

        if (p.inputs.up) {
            v.vx += Math.cos(t.angle) * THRUST;
            v.vy += Math.sin(t.angle) * THRUST;
        }

        v.vy += GRAVITY;
        v.vx *= DRAG; v.vy *= DRAG;

        const speed = Math.hypot(v.vx, v.vy);
        if (speed > MAX_VEL) { v.vx = (v.vx / speed) * MAX_VEL; v.vy = (v.vy / speed) * MAX_VEL; }

        t.x += v.vx; t.y += v.vy;

        let crashed = false; let advancing = false;
        const cos = Math.cos(t.angle), sin = Math.sin(t.angle), w = 16, h = 16;
        const nose = { x: t.x + cos * w, y: t.y + sin * h };
        const lw = { x: t.x - cos * w - sin * (w*0.7), y: t.y - sin * h + cos * (w*0.7) };
        const rw = { x: t.x - cos * w + sin * (w*0.7), y: t.y - sin * h - cos * (w*0.7) };
        const eng = { x: t.x - cos * (w*0.5), y: t.y - sin * (h*0.5) };
        const sl = [[nose, rw], [rw, eng], [eng, lw], [lw, nose]];

        const floorHit = checkPolyIntersect(sl, room.level.floor);
        if (floorHit) {
            let diff = normalizeAngle(t.angle);
            if (floorHit.isFlat && speed < 2.5 && Math.abs(diff) < 0.25) {
                if (v.vy >= 0) { t.y = floorHit.p1.y - 12; v.vy = 0; v.vx = 0; t.angle += diff * 0.25; v.angularVelocity = 0; }
            } else crashed = true;
        }
        

        const checkPad = (pad: any, isEndPad: boolean) => {
        if (checkPolyIntersect(sl, room.level.ceiling)) crashed = true;
        if (checkPvPCollisions(ecs, e, t, 20)) crashed = true;
            if (t.x > pad.x - 10 && t.x < pad.x + pad.w + 10 && t.y > pad.y - 30 && t.y < pad.y + 10) {
                let diff = normalizeAngle(t.angle);
                if (speed < 2.5 && Math.abs(diff) < 0.25) {
                    crashed = false;
                    if (v.vy >= 0 && t.y >= pad.y - 12) {
                        t.y = pad.y - 12; v.vy = 0; v.vx = 0; t.angle += diff * 0.25; v.angularVelocity = 0;
                        if (isEndPad && !p.inputs.up) { advancing = true; room.transitionPlayer(p.id); }
                    }
                } else if (t.y > pad.y) crashed = true;
            }
        };
        checkPad(room.level.startPad, false); checkPad(room.level.endPad, true);

        if (crashed && !advancing) killPlayer(ecs, e);
    }
}