import { Registry } from '../core/ecs';
import { spawnBullet } from './combat';
import { Server } from 'socket.io';
import { sysTanks } from './tank-ai';
import { sysFlyingEnemies } from './flying-ai';

export function sysWeapons(ecs: Registry) {
    for (const [e, p] of ecs.players.entries()) {
        if (p.isDead) continue;
        const t = ecs.transforms.get(e)!;
        const v = ecs.velocities.get(e)!;

        if (p.gunCooldown > 0) {
            p.gunCooldown--;
        }
        
        let activeShoot = p.inputs.shoot || p.shootLatch;
        
        // Allow fast manual clicking by resetting cooldown on new trigger pull,
        // but maintain a small minimum delay to prevent macro/cheat spam
        if (activeShoot && !p.prevShoot) {
            p.gunCooldown = Math.min(p.gunCooldown, 4);
        }
        
        if (activeShoot && p.gunCooldown <= 0) {
            const offset = 14; 
            const bSpeed = p.type === 'classic' ? 4.0 : 2.2; 

             if (p.doubleShotAmmo > 0) {
                 const perpX = -Math.sin(t.angle) * 6;
                 const perpY = Math.cos(t.angle) * 6;
                 const noseX = t.x + Math.cos(t.angle) * offset;
                 const noseY = t.y + Math.sin(t.angle) * offset;
                 const bulletVx = v.vx + Math.cos(t.angle) * bSpeed;
                 const bulletVy = v.vy + Math.sin(t.angle) * bSpeed;

                 spawnBullet(ecs, noseX + perpX, noseY + perpY, bulletVx, bulletVy, true, p.id);
                 spawnBullet(ecs, noseX - perpX, noseY - perpY, bulletVx, bulletVy, true, p.id);
                 p.doubleShotAmmo--;
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
             }
            
            // Auto-fire is deliberately slow. Fast firing requires manual pressing.
            p.gunCooldown = p.type === 'classic' ? 30 : 40;
        }
        
        p.prevShoot = activeShoot; 
        p.shootLatch = false;
    }
}

export function sysNetworkSync(ecs: Registry, levelIndex: number, io: Server) {
    const VIEW_W = 1600;
    const VIEW_H = 900;
    const CULL_MARGIN = 400; 
    
    const totalMapCargo = Array.from(ecs.cargos.values()).filter(c => c.active).length;
    const totalCargoRemaining = totalMapCargo + Array.from(ecs.players.values()).reduce((sum, p) => sum + p.cargoStack.length, 0);
    
    for (const [e, p] of ecs.players.entries()) {
        const t = ecs.transforms.get(e)!;
        const state = { 
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
            
            if (Math.abs(ot.x - t.x) < VIEW_W / 2 + CULL_MARGIN && Math.abs(ot.y - t.y) < VIEW_H / 2 + CULL_MARGIN) {
                 state.players[op.id] = { x: ot.x, y: ot.y, vx: ov.vx, vy: ov.vy, angle: ot.angle, angleStep: op.angleStep, isDead: op.isDead, isLanded: op.isLanded, inputs: op.inputs, score: op.score, cargoStack: op.cargoStack, fuel: op.fuel };
            }
        }
        for (const [te, turret] of ecs.turrets.entries()) {
            const tt = ecs.transforms.get(te)!;
            if (Math.abs(tt.x - t.x) < VIEW_W / 2 + CULL_MARGIN && Math.abs(tt.y - t.y) < VIEW_H / 2 + CULL_MARGIN) {
                state.turrets.push({ x: tt.x, y: tt.y, angle: tt.angle, orientUp: turret.orientUp, active: turret.active, type: turret.turretType });
            }
        }
        for (const [he, missile] of ecs.homingMissiles.entries()) {
            if (Math.abs(missile.x - t.x) < VIEW_W / 2 + CULL_MARGIN && Math.abs(missile.y - t.y) < VIEW_H / 2 + CULL_MARGIN) {
                state.bullets.push({ x: missile.x, y: missile.y, isPlayer: false }); // Rendered via bullet sync channel for scannability
            }
        }
        for (const [te, tank] of ecs.tanks.entries()) {
            const tt = ecs.transforms.get(te)!;
            if (Math.abs(tt.x - t.x) < VIEW_W / 2 + CULL_MARGIN && Math.abs(tt.y - t.y) < VIEW_H / 2 + CULL_MARGIN) {
                state.tanks.push({ x: tt.x, y: tt.y, active: tank.active, width: tank.width, height: tank.height, debugId: tank.debugId });
            }
        }
        for (const [fe, flying] of ecs.flyingEnemies.entries()) {
            const ft = ecs.transforms.get(fe)!;
            if (Math.abs(ft.x - t.x) < VIEW_W / 2 + CULL_MARGIN && Math.abs(ft.y - t.y) < VIEW_H / 2 + CULL_MARGIN) {
                state.flying.push({ x: ft.x, y: ft.y, angle: ft.angle, active: flying.active, width: flying.width, height: flying.height, enemyType: flying.enemyType, debugId: flying.debugId });
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
            if (Math.abs(bt.x - t.x) < VIEW_W / 2 + CULL_MARGIN && Math.abs(bt.y - t.y) < VIEW_H / 2 + CULL_MARGIN) {
                state.bullets.push({ x: bt.x, y: bt.y, isPlayer: b.isPlayer });
            }
        }
        
        for (const ev of ecs.events) {
            if (Math.abs(ev.x - t.x) < VIEW_W / 2 + CULL_MARGIN && Math.abs(ev.y - t.y) < VIEW_H / 2 + CULL_MARGIN) {
                state.events.push(ev);
            }
        }

        io.to(p.id).emit('state', state);
    }
}
