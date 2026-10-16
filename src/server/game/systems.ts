import { Registry } from '../core/ecs';
import { spawnBullet } from './combat';
import { Server } from 'socket.io';
import { sysTanks } from './tank-ai';
import { sysFlyingEnemies } from './flying-ai';
import { sysBotAI } from './bot-dogfighting';
import type { Room } from '../Room';
import { SERVER_CONFIG } from '../core/config';

// Maybe in the future an option would be extracting weapons into a data-driven pattern and make a `game/weapons.ts` but ah...
export function sysWeapons(ecs: Registry) {
    for (const [e, mount] of ecs.weaponMounts.entries()) {
        const p = ecs.players.get(e);
        if (p.isDead) continue;
        const t = ecs.transforms.get(e)!;
        const v = ecs.velocities.get(e)!;

        if (mount.cooldown > 0) mount.cooldown--;
        
        let activeShoot = p.inputs.shoot || mount.shootLatch;
        
        if (activeShoot && !mount.prevShoot) {
            mount.cooldown = Math.min(mount.cooldown, 4);
        }
        
        if (activeShoot && mount.cooldown <= 0) {
            const offset = 14; 
            const bSpeed = p.type === 'classic' ? 4.0 : 2.2; 

            if (mount.activeModeId === 0xD6) { // Double Shot Mode (2 linear bullets per press)
                const bx = t.x + Math.cos(t.angle) * offset;
                const by = t.y + Math.sin(t.angle) * offset;
                const bvx = v.vx + Math.cos(t.angle) * bSpeed;
                const bvy = v.vy + Math.sin(t.angle) * bSpeed;
                
                // Fire two bullets in sequence along the same line, slightly offset in life/position
                spawnBullet(ecs, bx, by, bvx, bvy, true, p.id, 400);
                spawnBullet(ecs, bx - Math.cos(t.angle) * 10, by - Math.sin(t.angle) * 10, bvx, bvy, true, p.id, 400);
                
                mount.shotsFired += 2;
                mount.charges--;
            } else if (mount.activeModeId === 0xD6) {
                // PARALLEL Double Shot Mode
                // This is NOT used in game; does not exist in any level
                const perpX = -Math.sin(t.angle) * 6;
                const perpY = Math.cos(t.angle) * 6;
                const noseX = t.x + Math.cos(t.angle) * offset;
                const noseY = t.y + Math.sin(t.angle) * offset;
                const bulletVx = v.vx + Math.cos(t.angle) * bSpeed;
                const bulletVy = v.vy + Math.sin(t.angle) * bSpeed;

                spawnBullet(ecs, noseX + perpX, noseY + perpY, bulletVx, bulletVy, true, p.id);
                spawnBullet(ecs, noseX - perpX, noseY - perpY, bulletVx, bulletVy, true, p.id);
                mount.charges--;
                mount.shotsFired += 2;
            } else if (mount.activeModeId === 0xD7) { // Spread Weapon Mode (3-way fan)
                const spreadAngle = 0.25; // ~14 degrees offset
                for (let i = -1; i <= 1; i++) {
                    const curAngle = t.angle + (i * spreadAngle);
                    spawnBullet(
                            ecs,
                            t.x + Math.cos(curAngle) * offset,
                            t.y + Math.sin(curAngle) * offset,
                            v.vx + Math.cos(curAngle) * bSpeed,
                            v.vy + Math.sin(curAngle) * bSpeed,
                            true,
                            p.id
                    );
                    mount.shotsFired++;
                }
                mount.charges--;
            } else if (mount.activeModeId === 0xD8) { // Rear Shot Mode (Forward + 180° Rearward)
                const rearAngle = t.angle + Math.PI;

                // Front shot
                spawnBullet(
                    ecs,
                    t.x + Math.cos(t.angle) * offset,
                    t.y + Math.sin(t.angle) * offset,
                    v.vx + Math.cos(t.angle) * bSpeed,
                    v.vy + Math.sin(t.angle) * bSpeed,
                    true,
                    p.id
                );
                // Rear shot
                spawnBullet(
                    ecs,
                    t.x + Math.cos(rearAngle) * offset,
                    t.y + Math.sin(rearAngle) * offset,
                    v.vx + Math.cos(rearAngle) * bSpeed,
                    v.vy + Math.sin(rearAngle) * bSpeed,
                    true,
                    p.id
                );

                mount.shotsFired += 2;
                mount.charges--;                
            } else {
                spawnBullet(
                    ecs, 
                    t.x + Math.cos(t.angle) * offset, 
                    t.y + Math.sin(t.angle) * offset, 
                    v.vx + Math.cos(t.angle) * bSpeed, 
                    v.vy + Math.sin(t.angle) * bSpeed, 
                    true, 
                    p.id
                );
                mount.shotsFired++;
                if (mount.activeModeId !== 0xD5) mount.charges--;
             }
            
            // Auto-fire is deliberately slow. Fast firing requires manual pressing.
             if (mount.charges <= 0 && mount.activeModeId !== 0xD5) {
                 mount.activeModeId = 0xD5;
             }
            
             mount.cooldown = mount.baseCooldown;
        }
        
        mount.prevShoot = activeShoot; 
        mount.shootLatch = false;
    }
}

export function sysNetworkSync(ecs: Registry, room: Room, io: Server) {
    const VIEW_W = SERVER_CONFIG.viewWidth || 1600;
    const VIEW_H = SERVER_CONFIG.viewHeight || 900;
    const CULL_MARGIN = 400; 
    const syncFuelThisTick = (room.globalWaveTimer % 6 === 0);
    
    let totalMapCargo = 0;
    for (const c of ecs.cargos.values()) {
        if (c.active) totalMapCargo++;
    }
    let totalCarriedCargo = 0;
    for (const inv of ecs.cargoBays.values()) {
        totalCarriedCargo += inv.stack.length;
    }
    const totalCargoRemaining = totalMapCargo + totalCarriedCargo;
    
    const safeClientIds = (room && typeof room === 'object' && room.activeClientIds) ? room.activeClientIds : [];
    for (const clientId of safeClientIds) {
        let e = ecs.getPlayerEntity(clientId);
        let t = e !== undefined ? ecs.transforms.get(e) : null;

        if (t) {
            room.lastClientViews.set(clientId, { x: t.x, y: t.y });
        } else if (room.lastClientViews.has(clientId)) {
            const lastView = room.lastClientViews.get(clientId)!;
            t = { x: lastView.x, y: lastView.y, angle: 0 };
        } else {
            const firstPlayerEnt = Array.from(ecs.players.keys())[0];
            t = firstPlayerEnt !== undefined ? ecs.transforms.get(firstPlayerEnt)! : { x: 0, y: 0, angle: 0 };
        }

        const state = { 
            serverTimeMs: Math.round(room.globalWaveTimer * (1000 / SERVER_CONFIG.tickRate)),
            players: {} as any, 
            turrets: [] as any, 
            bullets: [] as any,
            tanks: [] as any,
            flying: [] as any,
            cargos: [] as any,
            powerups: [] as any,
            events: [] as any,
            cargosRemaining: totalCargoRemaining
        };
        
        for (const [oe, op] of ecs.players.entries()) {
            const ot = ecs.transforms.get(oe)!;
            const ov = ecs.velocities.get(oe)!;
            const oInv = ecs.cargoBays.get(oe);
            const oFuel = ecs.fuelTanks.get(oe);
            const oBot = ecs.bots.get(oe);
            
            const inView = Math.abs(ot.x - t.x) < VIEW_W / 2 + CULL_MARGIN && Math.abs(ot.y - t.y) < VIEW_H / 2 + CULL_MARGIN;
            if (inView || room.category === 'dogfight' || room.category === 'race' || op.id === clientId) {
                const curFuel = Math.floor(oFuel?.current || 0);
                const pPayload: any = {
                    x: Math.round(ot.x * 10) / 10,
                    y: Math.round(ot.y * 10) / 10,
                    vx: Math.round(ov.vx * 100) / 100,
                    vy: Math.round(ov.vy * 100) / 100,
                    angle: Math.round(ot.angle * 1000) / 1000,
                    angleStep: op.angleStep,
                    isDead: op.isDead,
                    isLanded: op.isLanded,
                    inputs: op.inputs,
                    score: op.score,
                    cargoStack: oInv?.stack || [],
                    race: op.race,
                    alias: op.alias,
                    lives: op.lives,
                    ping: op.ping,
                    team: op.team,
                    kills: op.kills || 0,
                    deaths: op.deaths || 0,
                    unforcedErrors: op.unforcedErrors || 0,
                    isBot: !!oBot
                };
                if (syncFuelThisTick || op.isLanded || curFuel <= 0 || room.globalWaveTimer < 5) {
                    pPayload.fuel = curFuel;
                    pPayload.fuelMax = oFuel?.max || 99999;
                }
                if (SERVER_CONFIG.debugMode && oBot) {
                    pPayload.botState = oBot.state;
                    if (oBot.path) pPayload.botPath = oBot.path.slice(0, 3);
                }
                state.players[op.id] = pPayload;
            }
        }
        for (const [te, turret] of ecs.turrets.entries()) {
            const tt = ecs.transforms.get(te)!;
            if (Math.abs(tt.x - t.x) < VIEW_W / 2 + CULL_MARGIN && Math.abs(tt.y - t.y) < VIEW_H / 2 + CULL_MARGIN) {
                state.turrets.push({ x: tt.x, y: tt.y, angle: tt.angle, orientUp: turret.orientUp, active: turret.active, type: turret.turretType, width: turret.width, height: turret.height });
            }
        }
        for (const [he, missile] of ecs.homingMissiles.entries()) {
            if (Math.abs(missile.x - t.x) < VIEW_W / 2 + CULL_MARGIN && Math.abs(missile.y - t.y) < VIEW_H / 2 + CULL_MARGIN) {
                state.bullets.push({ x: Math.round(missile.x * 10) / 10, y: Math.round(missile.y * 10) / 10, vx: Math.round(missile.vx * 100) / 100, vy: Math.round(missile.vy * 100) / 100, isPlayer: false });
            }
        }
        for (const [te, tank] of ecs.tanks.entries()) {
            const tt = ecs.transforms.get(te)!;
            if (Math.abs(tt.x - t.x) < VIEW_W / 2 + CULL_MARGIN && Math.abs(tt.y - t.y) < VIEW_H / 2 + CULL_MARGIN) {
                const tvx = tank.moveTimer > 0 ? tank.dirX : 0;
                state.tanks.push({ id: te, x: Math.round(tt.x * 10) / 10, y: Math.round(tt.y * 10) / 10, vx: tvx, vy: 0, active: tank.active, width: tank.width, height: tank.height, debugId: tank.debugId });
            }
        }
        for (const [fe, flying] of ecs.flyingEnemies.entries()) {
            const ft = ecs.transforms.get(fe)!;
            if (Math.abs(ft.x - t.x) < VIEW_W / 2 + CULL_MARGIN && Math.abs(ft.y - t.y) < VIEW_H / 2 + CULL_MARGIN) {
                state.flying.push({ id: fe, x: Math.round(ft.x * 10) / 10, y: Math.round(ft.y * 10) / 10, vx: Math.round((flying.lastDx || 0) * 100) / 100, vy: Math.round((flying.lastDy || 0) * 100) / 100, angle: Math.round(ft.angle * 100) / 100, active: flying.active, width: flying.width, height: flying.height, enemyType: flying.enemyType, debugId: flying.debugId });
            }
        }
        for (const [ce, cargo] of ecs.cargos.entries()) {
            if (!cargo.active) continue;
            const ct = ecs.transforms.get(ce)!;
            if (Math.abs(ct.x - t.x) < VIEW_W / 2 + CULL_MARGIN && Math.abs(ct.y - t.y) < VIEW_H / 2 + CULL_MARGIN) {
                state.cargos.push({ x: ct.x, y: ct.y, typeId: cargo.typeId, weight: cargo.weight });
            }
        }
        for (const [pue, powerup] of ecs.powerups.entries()) {
            const put = ecs.transforms.get(pue)!;
            if (Math.abs(put.x - t.x) < VIEW_W / 2 + CULL_MARGIN && Math.abs(put.y - t.y) < VIEW_H / 2 + CULL_MARGIN) {
                state.powerups.push({ x: put.x, y: put.y, typeId: powerup.typeId });
            }
        }
        for (const [be, b] of ecs.bullets.entries()) {
            const bt = ecs.transforms.get(be)!;
            const bv = ecs.velocities.get(be);
            if (Math.abs(bt.x - t.x) < VIEW_W / 2 + CULL_MARGIN && Math.abs(bt.y - t.y) < VIEW_H / 2 + CULL_MARGIN) {
                state.bullets.push({ x: Math.round(bt.x * 10) / 10, y: Math.round(bt.y * 10) / 10, vx: bv ? Math.round(bv.vx * 100) / 100 : 0, vy: bv ? Math.round(bv.vy * 100) / 100 : 0, isPlayer: b.isPlayer });
            }
        }
        
        for (const ev of ecs.events) {
            if (Math.abs(ev.x - t.x) < VIEW_W / 2 + CULL_MARGIN && Math.abs(ev.y - t.y) < VIEW_H / 2 + CULL_MARGIN) {
                state.events.push(ev);
            }
        }

        io.to(clientId).emit('state', state);
    }
}
