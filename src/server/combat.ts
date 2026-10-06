import { Registry, type Entity } from './ecs';
import { lineIntersect } from './math';
import type { Room } from './Room';

export function spawnBullet(ecs: Registry, x: number, y: number, vx: number, vy: number, isPlayer: boolean, ownerId: string, life = 400) {
    const e = ecs.create();
    ecs.transforms.set(e, { x, y, angle: 0 });
    ecs.velocities.set(e, { vx, vy, angularVelocity: 0 });
    ecs.bullets.set(e, { life, isPlayer, ownerId });
    return e;
}

export function spawnTurret(ecs: Registry, x: number, y: number, orientUp: boolean) {
    const e = ecs.create();
    ecs.transforms.set(e, { x, y, angle: orientUp ? -Math.PI/2 : Math.PI/2 });
    ecs.turrets.set(e, { active: true, hp: 3, cooldown: 0, orientUp });
    return e;
}

export function killPlayer(ecs: Registry, e: Entity) {
    const p = ecs.players.get(e);
    if (!p || p.isDead) return;
    p.isDead = true;
    p.isLanded = false;
    const v = ecs.velocities.get(e);
    if (v) { v.vx = 0; v.vy = 0; v.angularVelocity = 0; }
    p.inputs = { up: false, left: false, right: false, shoot: false };
    p.shootLatch = false; p.prevShoot = false;
    setTimeout(() => { p.respawnRequest = true; }, 3000);
}

export function sysBullets(ecs: Registry, room: Room) {
    for (const [e, b] of ecs.bullets.entries()) {
        const t = ecs.transforms.get(e)!;
        const v = ecs.velocities.get(e)!;
        
        const ox = t.x; const oy = t.y;
        t.x += v.vx; t.y += v.vy; b.life--;

        let hit = false;
        const checkWalls = (walls: {x:number, y:number}[]) => {
            for (let j = 0; j < walls.length - 1; j++) {
                if (lineIntersect(ox, oy, t.x, t.y, walls[j].x, walls[j].y, walls[j+1].x, walls[j+1].y)) hit = true;
            }
        };
        checkWalls(room.level.floor); checkWalls(room.level.ceiling);

        for (const [pe, p] of ecs.players.entries()) {
            if (p.isDead) continue;
            const pt = ecs.transforms.get(pe)!;
            if (Math.hypot(t.x - pt.x, t.y - pt.y) < 16) {
                if (b.ownerId !== p.id || b.life < 390) { hit = true; killPlayer(ecs, pe); }
            }
        }

        if (b.isPlayer) {
            for (const [te, turret] of ecs.turrets.entries()) {
                if (!turret.active) continue;
                const tt = ecs.transforms.get(te)!;
                if (t.x > tt.x - 15 && t.x < tt.x + 15 && t.y > tt.y - 15 && t.y < tt.y + 15) {
                    hit = true; turret.hp--; if (turret.hp <= 0) turret.active = false;
                }
            }
        }

        if (b.life <= 0 || hit) ecs.destroy(e);
    }
}

export function sysTurrets(ecs: Registry, room: Room) {
    for (const [e, turret] of ecs.turrets.entries()) {
        if (!turret.active) continue;
        const t = ecs.transforms.get(e)!;

        let targetId: string | null = null;
        let minDist = 800;
        let targetPos = { x: 0, y: 0 };

        for (const [pe, p] of ecs.players.entries()) {
            if (p.isDead) continue;
            const pt = ecs.transforms.get(pe)!;
            let d = Math.hypot(pt.x - t.x, pt.y - t.y);
            if (d < minDist) { minDist = d; targetId = p.id; targetPos = { x: pt.x, y: pt.y }; }
        }

        if (targetId) {
            let diff = Math.atan2(targetPos.y - t.y, targetPos.x - t.x) - t.angle;
            while (diff < -Math.PI) diff += Math.PI * 2; while (diff > Math.PI) diff -= Math.PI * 2;
            t.angle += Math.sign(diff) * 0.02;

            if (turret.cooldown > 0) turret.cooldown--;
            if (turret.cooldown <= 0 && Math.abs(diff) < 0.5) {
                spawnBullet(ecs, t.x + Math.cos(t.angle)*20, t.y + Math.sin(t.angle)*20, Math.cos(t.angle)*6, Math.sin(t.angle)*6, false, 'npc', 90);
                turret.cooldown = 90;
            }
        }
    }
}