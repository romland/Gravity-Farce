import { Registry, type Entity, type Transform } from '../core/ecs';
import { checkPolyIntersect } from '../core/math';
import { lineIntersect } from '../core/math';
import type { Room } from '../Room';
import { getTurretSpecByTile } from './turret-defs';

export function spawnBullet(ecs: Registry, x: number, y: number, vx: number, vy: number, isPlayer: boolean, ownerId: string, life = 400) {
    const e = ecs.create();
    ecs.transforms.set(e, { x, y, angle: 0 });
    ecs.velocities.set(e, { vx, vy, angularVelocity: 0 });
    ecs.bullets.set(e, { life, isPlayer, ownerId });
    return e;
}

export function spawnTurret(ecs: Registry, x: number, y: number, turretType: number = 0xAF, orientUp: boolean = false, triggerId?: number) {
    const e = ecs.create();
    ecs.transforms.set(e, { x, y, angle: orientUp ? -Math.PI/2 : Math.PI/2 });
    const resolvedTriggerId = triggerId !== undefined ? triggerId : (turretType - 0xAD);
    ecs.turrets.set(e, { active: true, hp: 3, cooldown: 0, turretType, orientUp, triggerId: resolvedTriggerId });
    return e;
}

export function killPlayer(ecs: Registry, e: Entity) {
    const p = ecs.players.get(e);
    if (!p || p.isDead) return;
    p.isDead = true;
    p.isLanded = false;
    const v = ecs.velocities.get(e);
    if (v) { 
        v.vx = 0; 
        v.vy = 0; 
        v.angularVelocity = 0; 
    }
    
    p.inputs = { up: false, left: false, right: false, shoot: false };
    p.shootLatch = false; 
    p.prevShoot = false;
    
    setTimeout(() => { 
        p.respawnRequest = true; 
    }, 3000);
}

export function checkPvPCollisions(ecs: Registry, e: Entity, t: Transform, radius: number = 18): boolean {
    let crashed = false;
    for (const [oe, op] of ecs.players.entries()) {
        if (oe === e || op.isDead) continue;
        const ot = ecs.transforms.get(oe)!;
        if (Math.hypot(t.x - ot.x, t.y - ot.y) < radius) { 
            crashed = true; 
            killPlayer(ecs, oe); 
        }
    }
    return crashed;
}

export function sysBullets(ecs: Registry, room: Room) {
    for (const [e, b] of ecs.bullets.entries()) {
        const t = ecs.transforms.get(e)!;
        const v = ecs.velocities.get(e)!;
        
        const ox = t.x;
        const oy = t.y;
        
        t.x += v.vx;
        t.y += v.vy;
        b.life--;

        let hit = false;

        for (const [pe, p] of ecs.players.entries()) {
            const bLine = [[{x:ox, y:oy}, {x:t.x, y:t.y}]];
            if (checkPolyIntersect(bLine, room.level.floor) || checkPolyIntersect(bLine, room.level.ceiling)) {
                hit = true;
            }
            
            if (room.level.walls) {
                for (const wall of room.level.walls) {
                    if (checkPolyIntersect(bLine, wall)) { 
                        hit = true; 
                        break; 
                    }
                }
            }

            if (p.isDead) continue;
            
            const pt = ecs.transforms.get(pe)!;
            if (Math.hypot(t.x - pt.x, t.y - pt.y) < 16) {
                if (b.ownerId !== p.id || b.life < 390) {
                    hit = true;
                    killPlayer(ecs, pe);
                }
            }
        }

        if (b.isPlayer) {
            for (const [te, turret] of ecs.turrets.entries()) {
                if (!turret.active) continue;
                const tt = ecs.transforms.get(te)!;
                if (t.x > tt.x - 15 && t.x < tt.x + 15 && t.y > tt.y - 15 && t.y < tt.y + 15) {
                    hit = true;
                    turret.hp--;
                    if (turret.hp <= 0) {
                        turret.active = false;
                        ecs.events.push({ type: 'turret_explosion', x: tt.x, y: tt.y });
                    }
                }
            }
        }

        if (b.life <= 0 || hit) {
            if (hit) {
                ecs.events.push({ type: 'poof', x: t.x, y: t.y });
            }
            ecs.destroy(e);
        }
    }
}

export function sysTurrets(ecs: Registry, room: Room) {
    // 1. Collect all trigger tile IDs currently touched by alive players (0xBD - 0xCB)
    const activeTriggers = new Set<number>();

    if (room.level && room.level.rawMap) {
        for (const [pe, p] of ecs.players.entries()) {
            if (p.isDead) continue;
            const pt = ecs.transforms.get(pe);
            if (!pt) continue;

            const tileX = Math.floor(pt.x / 32);
            const tileY = Math.floor(pt.y / 32);
            const tileId = room.level.rawMap[tileY]?.[tileX];

            if (tileId !== undefined && tileId >= 0xBD && tileId <= 0xCB) {
                activeTriggers.add(tileId - 0xBC);
            }
        }
    }

    // 2. Process turret firing based on tile trigger state
    for (const [e, turret] of ecs.turrets.entries()) {
        if (!turret.active) continue;

        if (turret.cooldown > 0) {
            turret.cooldown--;
        }

        const targetTriggerId = turret.triggerId !== undefined ? turret.triggerId : (turret.turretType - 0xAD);
        const isTriggered = activeTriggers.has(targetTriggerId);

        if (isTriggered && turret.cooldown <= 0) {
            const t = ecs.transforms.get(e)!;
            const spec = getTurretSpecByTile(turret.turretType);
            const speed = 5.0;

            for (const vec of spec.vectors) {
                spawnBullet(
                    ecs,
                    t.x + spec.muzzleOffset.x,
                    t.y + spec.muzzleOffset.y,
                    vec.vx * speed,
                    vec.vy * speed,
                    false,
                    'npc',
                    90
                );
            }
            turret.cooldown = spec.cooldownMax;
        }
    }
}
