import { Registry, type Entity } from './ecs';
import { killPlayer, spawnBullet } from './combat';
import { lineIntersect } from './math';
import type { Room } from './Room';

const ROTATION_SPEED = 500; const GRAVITY = 0.008;
const THRUST_IMPULSE = 0.065; const DRAG = 0.997;
const MAX_SPEED = 4.0; const MAX_SAFE_LANDING_VY = 1.4;

export function spawnClassicPlayer(ecs: Registry, id: string, x: number, y: number): Entity {
    const e = ecs.create();
    ecs.transforms.set(e, { x, y, angle: -Math.PI / 2 });
    ecs.velocities.set(e, { vx: 0, vy: 0, angularVelocity: 0 });
    ecs.players.set(e, {
        id, type: 'classic', isDead: false,
        inputs: { up: false, left: false, right: false, shoot: false },
        shootLatch: false, prevShoot: false, gunCooldown: 0, respawnRequest: false,
        angleAcc: 54000, angleStep: 27, isLanded: false
    });
    return e;
}

export function sysClassicPlayers(ecs: Registry, room: Room) {
    for (const [e, p] of ecs.players.entries()) {
        if (p.type !== 'classic' || p.isDead) continue;
        const t = ecs.transforms.get(e)!;
        const v = ecs.velocities.get(e)!;

        if (p.isLanded) {
            v.vx = 0; v.vy = 0; p.angleAcc = 54000; p.angleStep = 27; t.angle = -Math.PI / 2;
            if (p.inputs.up) p.isLanded = false; 
            else { handleWeapons(ecs, e, t, v, p); continue; }
        }

        if (p.inputs.left) p.angleAcc = (p.angleAcc - ROTATION_SPEED + 72000) % 72000;
        if (p.inputs.right) p.angleAcc = (p.angleAcc + ROTATION_SPEED) % 72000;

        p.angleStep = Math.floor(p.angleAcc / 2000) % 36;
        t.angle = (p.angleStep * (Math.PI * 2)) / 36;

        if (p.inputs.up) {
            v.vx += Math.cos(t.angle) * THRUST_IMPULSE;
            v.vy += Math.sin(t.angle) * THRUST_IMPULSE;
        }

        v.vx *= DRAG; v.vy *= DRAG; v.vy += GRAVITY;
        const speed = Math.hypot(v.vx, v.vy);
        if (speed > MAX_SPEED) { v.vx = (v.vx / speed) * MAX_SPEED; v.vy = (v.vy / speed) * MAX_SPEED; }
        t.x += v.vx; t.y += v.vy;

        handleWeapons(ecs, e, t, v, p);

        let crashed = false; let advancing = false;
        const cos = Math.cos(t.angle), sin = Math.sin(t.angle), w = 14, h = 14;
        const nose = { x: t.x + cos * w, y: t.y + sin * h };
        const lw = { x: t.x - cos * w - sin * (w * 0.7), y: t.y - sin * h + cos * (w * 0.7) };
        const rw = { x: t.x - cos * w + sin * (w * 0.7), y: t.y - sin * h - cos * (w * 0.7) };
        const eng = { x: t.x - cos * (w * 0.5), y: t.y - sin * (h * 0.5) };
        const sl = [[nose, rw], [rw, eng], [eng, lw], [lw, nose]];

        const isAngleUpright = Math.abs(p.angleStep - 27) <= 2;
        const land = (targetY: number) => { p.isLanded = true; t.y = targetY; v.vy = 0; v.vx = 0; p.angleAcc = 54000; p.angleStep = 27; t.angle = -Math.PI / 2; };

        for (let i = 0; i < room.level.floor.length - 1; i++) {
            const p1 = room.level.floor[i]; const p2 = room.level.floor[i + 1];
            const isFlat = Math.abs(p1.y - p2.y) < 1.0;
            for (let line of sl) {
                if (lineIntersect(line[0].x, line[0].y, line[1].x, line[1].y, p1.x, p1.y, p2.x, p2.y)) {
                    if (isFlat && v.vy <= MAX_SAFE_LANDING_VY && isAngleUpright) {
                        if (v.vy >= 0 && t.y >= p1.y - 12) land(p1.y - 12);
                    } else crashed = true;
                }
            }
        }

        for (let i = 0; i < room.level.ceiling.length - 1; i++) {
            for (let line of sl) {
                if (lineIntersect(line[0].x, line[0].y, line[1].x, line[1].y, room.level.ceiling[i].x, room.level.ceiling[i].y, room.level.ceiling[i + 1].x, room.level.ceiling[i + 1].y)) crashed = true;
            }
        }

        for (const [oe, op] of ecs.players.entries()) {
            if (oe === e || op.isDead) continue;
            const ot = ecs.transforms.get(oe)!;
            if (Math.hypot(t.x - ot.x, t.y - ot.y) < 18) { crashed = true; killPlayer(ecs, oe); }
        }

        const checkPad = (pad: any, isEndPad: boolean) => {
            if (t.x > pad.x - 10 && t.x < pad.x + pad.w + 10 && t.y > pad.y - 30 && t.y < pad.y + 10) {
                if (v.vy <= MAX_SAFE_LANDING_VY && isAngleUpright) {
                    crashed = false;
                    if (v.vy >= 0 && t.y >= pad.y - 12) {
                        land(pad.y - 12);
                        if (isEndPad && !p.inputs.up) { advancing = true; room.transitionPlayer(p.id); }
                    }
                } else if (t.y > pad.y) crashed = true;
            }
        };
        checkPad(room.level.startPad, false); checkPad(room.level.endPad, true);

        if (crashed && !advancing) killPlayer(ecs, e);
    }

    function handleWeapons(ecs: Registry, e: Entity, t: any, v: any, p: any) {
        if (p.gunCooldown > 0) p.gunCooldown--;
        let activeShoot = p.inputs.shoot || p.shootLatch;
        if (activeShoot && !p.prevShoot) p.gunCooldown = 0; // Arcade bypass
        if (activeShoot && p.gunCooldown <= 0) {
            spawnBullet(ecs, t.x + Math.cos(t.angle)*14, t.y + Math.sin(t.angle)*14, v.vx + Math.cos(t.angle)*5.0, v.vy + Math.sin(t.angle)*5.0, true, p.id);
            p.gunCooldown = 10;
        }
        p.prevShoot = activeShoot; p.shootLatch = false;
    }
}