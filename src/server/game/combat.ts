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
    ecs.transforms.set(e, { x, y, angle: 0 }); // Angle 0 ensures rendering matches true Upward physics 
    const resolvedTriggerId = triggerId !== undefined ? triggerId : (turretType - 0xAD);
    const spec = getTurretSpecByTile(turretType);
    const tileX = Math.floor(x / 32);
    const tileY = Math.floor(y / 32);
    ecs.turrets.set(e, {
        active: true,
        hp: spec.hpMax,
        hpMax: spec.hpMax,
        cooldown: 0,
        turretType,
        orientUp,
        triggerId: resolvedTriggerId,
        tileX,
        tileY,
        width: spec.width,
        height: spec.height,
        damageHistory: {}
    });
    return e;
}

export function bumpPlayer(ecs: Registry, room: Room, pe: Entity, sourceX: number, sourceY: number, force: number = 5.0) {
    const t = ecs.transforms.get(pe);
    const v = ecs.velocities.get(pe);
    if (!t || !v) return;

    const dx = t.x - sourceX;
    const dy = t.y - sourceY;
    const dist = Math.hypot(dx, dy) || 1;
    
    const finalForce = force * room.raceBumpModifier;
    v.vx += (dx / dist) * finalForce;
    v.vy += (dy / dist) * finalForce;

    ecs.events.push({ type: 'poof', x: t.x, y: t.y });
    ecs.events.push({ type: 'sound', soundId: 10, x: t.x, y: t.y }); // Bonk sound
}

function destroyTurretTile(room: Room, tileX: number, tileY: number) {
    if (room.level && room.level.rawMap && room.level.rawMap[tileY] && room.level.rawMap[tileY][tileX] !== undefined) {
        room.level.rawMap[tileY][tileX] = 0x00;
        room.broadcastTileUpdate(tileX, tileY, 0x00);
    }
}

function checkShipTurretCollisions(ecs: Registry, room: Room) {
    for (const [e, p] of ecs.players.entries()) {
        if (p.isDead) continue;
        const pt = ecs.transforms.get(e);
        if (!pt) continue;
        for (const [te, turret] of ecs.turrets.entries()) {
            if (!turret.active) continue;
            const tt = ecs.transforms.get(te)!;
            if (Math.abs(pt.x - tt.x) <= (turret.width / 2 + 14) && Math.abs(pt.y - tt.y) <= (turret.height / 2 + 14)) {
                if (room.category === 'race' && !room.isLethalRacing) {
                    bumpPlayer(ecs, room, e, tt.x, tt.y, 7.0); // Heavy repulsion from solid turret
                } else {
                    killPlayer(ecs, e, room);
                    turret.hp = 0;
                    turret.active = false;
                    ecs.events.push({ type: 'turret_explosion', x: tt.x, y: tt.y });
                    destroyTurretTile(room, turret.tileX, turret.tileY);
                }
            }
        }
    }
}

export function killPlayer(ecs: Registry, e: Entity, room?: Room) {
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
    
    if (room) {
        const t = ecs.transforms.get(e);
        room.tracker.logEvent(p.id, { type: 'death', x: t?.x || 0, y: t?.y || 0 });
    }

    p.inputs = { up: false, left: false, right: false, shoot: false };
    const w = ecs.weaponMounts.get(e);
    if (w) {
        w.shootLatch = false;
        w.prevShoot = false;
    }
    
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
            killPlayer(ecs, oe); // Note: Could pass room here eventually, but PvP usually won't proc in most SP scenarios
        }
    }
    return crashed;
}

function getContributors(ecs: Registry, damageHistory: Record<string, number>): Record<string, number> {
    const result: Record<string, number> = {};
    for (const [id, hits] of Object.entries(damageHistory)) {
        const pe = ecs.getPlayerEntity(id);
        const alias = pe !== undefined ? ecs.players.get(pe)!.alias : id.substring(0, 3);
        result[alias] = (result[alias] || 0) + hits;
    }
    return result;
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
        let hitX = t.x; let hitY = t.y;

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
                    if (room.category === 'race' && !room.isLethalRacing) {
                        bumpPlayer(ecs, room, pe, t.x, t.y, 4.0); // Lighter bullet bonk
                    } else {
                        killPlayer(ecs, pe, room);
                    }
                }
            }
        }

        if (b.isPlayer) {
            for (const [te, turret] of ecs.turrets.entries()) {
                if (!turret.active) continue;
                const tt = ecs.transforms.get(te)!;
                const spec = getTurretSpecByTile(turret.turretType);
                if (Math.abs(t.x - tt.x) <= spec.width / 2 && Math.abs(t.y - tt.y) <= spec.height / 2) {
                    hit = true;
                    turret.damageHistory[b.ownerId] = (turret.damageHistory[b.ownerId] || 0) + 1;
                    turret.hp--;
                    if (turret.hp <= 0) {
                        turret.active = false;
                        room.tracker.logEvent(b.ownerId, { type: 'enemy_killed', enemyCategory: 'turret', enemyTypeId: turret.turretType, contributors: getContributors(ecs, turret.damageHistory) });
                        ecs.events.push({ type: 'turret_explosion', x: tt.x, y: tt.y });
                        destroyTurretTile(room, turret.tileX, turret.tileY);

                    const shooterEntity = ecs.getPlayerEntity(b.ownerId);
                    if (shooterEntity !== undefined) {
                        const shooter = ecs.players.get(shooterEntity);
                        if (shooter) shooter.score += getTurretSpecByTile(turret.turretType).scoreValue;
                    }
                    }
                    break;
                }
            }
            
            if (!hit) {
                for (const [te, tank] of ecs.tanks.entries()) {
                    if (!tank.active) continue;
                    const tt = ecs.transforms.get(te)!;
                    // Amiga Tank Hitbox: 16x12 (X: ±8, Y: ±6)
                    if (Math.abs(t.x - tt.x) <= tank.width / 2 && Math.abs(t.y - tt.y) <= tank.height / 2) {
                        hit = true;
                        tank.damageHistory[b.ownerId] = (tank.damageHistory[b.ownerId] || 0) + 1;
                        tank.hp--;
                        if (tank.hp <= 0) {
                            tank.active = false;
                            room.tracker.logEvent(b.ownerId, { type: 'enemy_killed', enemyCategory: 'tank', enemyTypeId: 0, contributors: getContributors(ecs, tank.damageHistory) });
                            ecs.events.push({ type: 'large_explosion', x: tt.x, y: tt.y });
                            
                            const shooterEntity = ecs.getPlayerEntity(b.ownerId);
                            if (shooterEntity !== undefined) {
                                const shooter = ecs.players.get(shooterEntity);
                                if (shooter) shooter.score += 100; // Hardcoded #$00000064 in 000360BC
                            }
                        }
                        break;
                    }
                }
                
                if (!hit) {
                    for (const [fe, flying] of ecs.flyingEnemies.entries()) {
                        if (!flying.active) continue;
                        const ft = ecs.transforms.get(fe)!;
                        if (Math.abs(t.x - ft.x) <= flying.width / 2 && Math.abs(t.y - ft.y) <= flying.height / 2) {
                            hit = true;
                            
                            // Ensure indestructible (-1 HP) enemies are not deleted by underflow
                            if (flying.hp !== -1) {
                            flying.damageHistory[b.ownerId] = (flying.damageHistory[b.ownerId] || 0) + 1;
                                flying.hp--;
                                if (flying.hp <= 0) {
                                    flying.active = false;
                                room.tracker.logEvent(b.ownerId, { type: 'enemy_killed', enemyCategory: 'flying', enemyTypeId: flying.enemyType, contributors: getContributors(ecs, flying.damageHistory) });
                                    ecs.events.push({ type: 'large_explosion', x: ft.x, y: ft.y });
                                    const shooterEntity = ecs.getPlayerEntity(b.ownerId);
                                    if (shooterEntity !== undefined) {
                                        const shooter = ecs.players.get(shooterEntity);
                                        if (shooter) shooter.score += flying.scoreValue;
                                    }
                                }
                            }
                            break;
                        }
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
    checkShipTurretCollisions(ecs, room);
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
                    // IMPNOTE: The original Amiga GF engine uses a 16x16 tile grid.
                    // Our modernized engine uses TILE_SIZE = 32. Since muzzle offsets are
                    // raw byte extracts relative to a 16x16 tile center, we must scale them by 2
                    // to ensure the bullets spawn exactly at the upscaled visual barrel locations.
                    t.x + (spec.muzzleOffset.x * 2),
                    t.y + (spec.muzzleOffset.y * 2),
                    vec.vx * speed,
                    vec.vy * speed,
                    false,
                    'npc',
                    90
                );
            }
            ecs.events.push({ type: 'sound', soundId: spec.soundId, x: t.x, y: t.y });
            turret.cooldown = spec.cooldownMax;
        }
    }
}
