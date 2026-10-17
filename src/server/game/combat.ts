import { Registry, type Entity, type Transform } from '../core/ecs';
import { checkPolyIntersect } from '../core/math';
import { lineIntersect } from '../core/math';
import type { Room } from '../Room';
import { getTurretSpecByTile } from './turret-defs';
import { spawnExplosionFragments } from './debris';
import { TILE_DICTIONARY } from '../core/tiles';
import { recordDB, getActivePhysicsHash } from '../core/records';
import { tagPlayerDamage, attributeDogfightDeath } from './dogfight';
import { checkShipBoxCollision, isNearSolidTile } from './player-shared';
import { SERVER_CONFIG } from '../core/config';

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
            if (checkShipBoxCollision(pt.x, pt.y, pt.angle, tt.x, tt.y, turret.width, turret.height)) {
                if (room.category === 'race' && !room.isLethalRacing) {
                    bumpPlayer(ecs, room, e, tt.x, tt.y, 7.0); // Heavy repulsion from solid turret
                } else {
                    // Verified at 0x0002FB36 & 0x0002E2BA: Static turrets are part of the background bitplane ($056000).
                    // Crashing into a turret destroys the player, leaving the turret and map intact.
                    killPlayer(ecs, e, room);
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
        if (room.category === 'dogfight') {
            attributeDogfightDeath(ecs, e, room);
        }
    }

    p.inputs = { up: false, left: false, right: false, shoot: false };
    const w = ecs.weaponMounts.get(e);
    if (w) {
        w.shootLatch = false;
        w.prevShoot = false;
    }
    
    p.lives--;

    if (p.lives <= 0) {
        p.lives = 0;
        // TODO 15: Arcade records (score) only count on mission levels (0-49), never racing or dogfights
        if (room && room.category === 'mission' && p.score > 0 && !ecs.bots.has(e) && !room.isReplayMode) {
            const mode = room.getRoomMode();
            const startLvl = p.streakStartLevel ?? room.levelIndex;
            // Enforce maxEntriesPerPlayer = 1 so a pilot only occupies a single slot on the 5-Lives Streak leaderboard
            const rScore = recordDB.submitRecord('arcade_score', 0, mode, room.getPhysicsHash(), 'desc_asc', {
                playerId: p.uuid,
                alias: p.alias,
                value: p.score,
                secondaryValue: Math.round((room.globalWaveTimer - p.joinedAtTick) * (1000 / 60)),
                metadata: { replayId: room.tracker.uuid, botCount: room.getBotCount(), startLevel: startLvl, endLevel: room.levelIndex }
            }, 100, Boolean(p.isBotPilot), 1);
            if (rScore.rank !== -1) room.tracker.logHighscore(p.id, 'arcade_score', p.score, rScore.isNewPb);
            if (rScore.rank === 1) {
                room.broadcastGlobalAnnouncement(`${p.alias} SET #1 ARCADE SCORE: ${p.score}!`);
            }
        }
        
        if (room && !ecs.bots.has(e) && !room.isReplayMode) {
            room.emitToPlayer(p.id, 'game_over', { score: p.score, levelName: room.level.name });
            room.checkAllPlayersOutOfLives();
        }
    } else {
        setTimeout(() => { p.respawnRequest = true; }, 3000);
    }
}

export function checkPvPCollisions(ecs: Registry, e: Entity, t: Transform, radius: number = 18, room?: Room): boolean {
    let crashed = false;
    const me = ecs.players.get(e);
    const amIBot = ecs.bots.has(e);
    for (const [oe, op] of ecs.players.entries()) {
        if (oe === e || op.isDead) continue;
        if (amIBot && ecs.bots.has(oe)) continue;
        const ot = ecs.transforms.get(oe)!;
        if (Math.hypot(t.x - ot.x, t.y - ot.y) < radius) { 
            if (room && me) {
                tagPlayerDamage(ecs, e, op.id, room.globalWaveTimer);
                tagPlayerDamage(ecs, oe, me.id, room.globalWaveTimer);
            }
            crashed = true; 
            killPlayer(ecs, oe, room);
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

        // Verified at 0x000348EA & 0x0003498C: Bullets do not decay over a fixed lifespan timer.
        // They travel infinitely until hitting a solid terrain bitplane pixel or leaving map bounds.
        const outOfBounds = t.x < 0 || t.y < 0 || t.x >= room.level.width || t.y >= room.level.height;

        let hit = false;
        let hitX = t.x; let hitY = t.y;

        const bLine = [[{x:ox, y:oy}, {x:t.x, y:t.y}]];
        if (checkPolyIntersect(bLine, room.level.floor) || checkPolyIntersect(bLine, room.level.ceiling)) {
            hit = true;
        }

        // Fallback: If bullet spawned directly inside a solid block (e.g. rear-shot while landed)
        if (!hit && room.level.rawMap) {
            const tx = Math.floor(t.x / 32);
            const ty = Math.floor(t.y / 32);
            const tId = room.level.rawMap[ty]?.[tx];
            if (tId !== undefined && (TILE_DICTIONARY[tId]?.solid || TILE_DICTIONARY[tId]?.pad)) {
                hit = true;
            }
        }

        // Broad-phase tile check + segment AABB cull: avoids 5,000+ lineIntersect calls per bullet in open air!
        if (!hit && room.level.walls && isNearSolidTile(room.level.rawMap, t.x, t.y, 1)) {
            const minBx = Math.min(ox, t.x) - 2;
            const maxBx = Math.max(ox, t.x) + 2;
            const minBy = Math.min(oy, t.y) - 2;
            const maxBy = Math.max(oy, t.y) + 2;
            for (let w = 0; w < room.level.walls.length && !hit; w++) {
                const wall = room.level.walls[w];
                for (let i = 0; i < wall.length - 1; i++) {
                    const p1 = wall[i];
                    const p2 = wall[i + 1];
                    if ((p1.x < minBx && p2.x < minBx) || (p1.x > maxBx && p2.x > maxBx) ||
                        (p1.y < minBy && p2.y < minBy) || (p1.y > maxBy && p2.y > maxBy)) {
                        continue;
                    }
                    if (lineIntersect(ox, oy, t.x, t.y, p1.x, p1.y, p2.x, p2.y)) {
                        hit = true;
                        break;
                    }
                }
            }
        }

        if (!hit) for (const [pe, p] of ecs.players.entries()) {
            if (p.isDead) continue;
            
            const pt = ecs.transforms.get(pe)!;
            const hitRadius = 14 * (SERVER_CONFIG.shipScale || 1.0);
            if (Math.hypot(t.x - pt.x, t.y - pt.y) < hitRadius) {
                if (b.ownerId !== p.id) {
                    if (b.isPlayer && room.category === 'dogfight') {
                        const shooterEnt = ecs.getPlayerEntity(b.ownerId);
                        const shooter = shooterEnt !== undefined ? ecs.players.get(shooterEnt) : undefined;
                        if (shooter && shooter.team && p.team && shooter.team === p.team && shooter.id !== p.id) {
                            // Friendly-fire protection on the same team in dogfights
                            continue;
                        }
                        tagPlayerDamage(ecs, pe, b.ownerId, room.globalWaveTimer);
                    }
                    hit = true;
                    if (room.category === 'race' && !room.isLethalRacing) {
                        bumpPlayer(ecs, room, pe, t.x, t.y, 4.0); // Lighter bullet bonk
                    } else {
                        killPlayer(ecs, pe, room);
                    }
                }
            }
        }

        if (!hit && b.isPlayer) {
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
                        if (shooter && !shooter.isDead) shooter.score += getTurretSpecByTile(turret.turretType).scoreValue;
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
                            // 0x000368B6 (Tank Death Routine): Spawns persistent wreckage/debris entity at dead tank's X/Y ($36CAC/$36CB0, state $06)
                            ecs.events.push({ type: 'tank_debris', x: tt.x, y: tt.y });
                            spawnExplosionFragments(ecs, tt.x, tt.y, 'tank');
                            
                            const shooterEntity = ecs.getPlayerEntity(b.ownerId);
                            if (shooterEntity !== undefined) {
                                const shooter = ecs.players.get(shooterEntity);
                                if (shooter && !shooter.isDead) shooter.score += 100; // Hardcoded #$00000064 in 000360BC
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
                                    if (flying.spawnsDebris) {
                                        spawnExplosionFragments(ecs, ft.x, ft.y, 'flying');
                                    }
                                    const shooterEntity = ecs.getPlayerEntity(b.ownerId);
                                    if (shooterEntity !== undefined) {
                                        const shooter = ecs.players.get(shooterEntity);
                                        if (shooter && !shooter.isDead) shooter.score += flying.scoreValue;
                                    }
                                }
                            }
                            break;
                        }
                    }
                }
            }
        }

        if (outOfBounds || hit) {
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
