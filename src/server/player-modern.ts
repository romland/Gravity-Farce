import { Registry, type Entity } from './ecs';
import { killPlayer, spawnBullet } from './combat';
import { lineIntersect, normalizeAngle } from './math';
import type { Room } from './Room';

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

        if (p.gunCooldown > 0) p.gunCooldown--;
        let activeShoot = p.inputs.shoot || p.shootLatch;
        if (activeShoot && !p.prevShoot) p.gunCooldown = 0; // Arcade bypass
        if (activeShoot && p.gunCooldown <= 0) {
            spawnBullet(ecs, t.x + Math.cos(t.angle)*16, t.y + Math.sin(t.angle)*16, v.vx + Math.cos(t.angle)*3, v.vy + Math.sin(t.angle)*3, true, p.id);
            p.gunCooldown = 15;
        }
        p.prevShoot = activeShoot; p.shootLatch = false;

        let crashed = false; let advancing = false;
        const cos = Math.cos(t.angle), sin = Math.sin(t.angle), w = 16, h = 16;
        const nose = { x: t.x + cos * w, y: t.y + sin * h };
        const lw = { x: t.x - cos * w - sin * (w*0.7), y: t.y - sin * h + cos * (w*0.7) };
        const rw = { x: t.x - cos * w + sin * (w*0.7), y: t.y - sin * h - cos * (w*0.7) };
        const eng = { x: t.x - cos * (w*0.5), y: t.y - sin * (h*0.5) };
        const sl = [[nose, rw], [rw, eng], [eng, lw], [lw, nose]];

        for (let i = 0; i < room.level.floor.length - 1; i++) {
            const p1 = room.level.floor[i]; const p2 = room.level.floor[i+1];
            const isFlat = Math.abs(p1.y - p2.y) < 1.0;
            for (let line of sl) {
                if (lineIntersect(line[0].x, line[0].y, line[1].x, line[1].y, p1.x, p1.y, p2.x, p2.y)) {
                    let diff = normalizeAngle(t.angle);
                    if (isFlat && speed < 2.5 && Math.abs(diff) < 0.25) {
                        if (v.vy >= 0) { t.y = p1.y - 12; v.vy = 0; v.vx = 0; t.angle += diff * 0.25; v.angularVelocity = 0; }
                    } else { crashed = true; }
                }
            }
        }
        
        for (let i = 0; i < room.level.ceiling.length - 1; i++) {
            for (let line of sl) {
                if (lineIntersect(line[0].x, line[0].y, line[1].x, line[1].y, room.level.ceiling[i].x, room.level.ceiling[i].y, room.level.ceiling[i+1].x, room.level.ceiling[i+1].y)) crashed = true;
            }
        }
        for (const [oe, op] of ecs.players.entries()) {
            if (oe === e || op.isDead) continue;
            const ot = ecs.transforms.get(oe)!;
            if (Math.hypot(t.x - ot.x, t.y - ot.y) < 20) { crashed = true; killPlayer(ecs, oe); }
        }

        const checkPad = (pad: any, isEndPad: boolean) => {
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