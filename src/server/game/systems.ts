import { Registry } from '../core/ecs';
import { spawnBullet } from './combat';
import { Server } from 'socket.io';

export function sysWeapons(ecs: Registry) {
    for (const [e, p] of ecs.players.entries()) {
        if (p.isDead) continue;
        const t = ecs.transforms.get(e)!;
        const v = ecs.velocities.get(e)!;

        if (p.gunCooldown > 0) {
            p.gunCooldown--;
        }
        
        let activeShoot = p.inputs.shoot || p.shootLatch;
        
        if (activeShoot && !p.prevShoot) {
            // Exploit fix: Allow fast trigger finger, but cap maximum spawn rate 
            // so a modified client cannot spam 60 bullets a second.
            if (p.gunCooldown > 3) {
                p.gunCooldown = 3;
            }
        }
        
        if (activeShoot && p.gunCooldown <= 0) {
            const offset = 14; 
            const bSpeed = p.type === 'classic' ? 4.0 : 2.2; 
            
            spawnBullet(
                ecs, 
                t.x + Math.cos(t.angle) * offset, 
                t.y + Math.sin(t.angle) * offset, 
                v.vx + Math.cos(t.angle) * bSpeed, 
                v.vy + Math.sin(t.angle) * bSpeed, 
                true, 
                p.id
            );
            
            p.gunCooldown = p.type === 'classic' ? 10 : 15;
        }
        
        p.prevShoot = activeShoot; 
        p.shootLatch = false;
    }
}

export function sysNetworkSync(ecs: Registry, levelIndex: number, io: Server) {
    const VIEW_W = 1600;
    const VIEW_H = 900;
    const CULL_MARGIN = 400; 
    
    for (const [e, p] of ecs.players.entries()) {
        const t = ecs.transforms.get(e)!;
        const state = { 
            players: {} as any, 
            turrets: [] as any, 
            bullets: [] as any,
            events: [] as any
        };
        
        for (const [oe, op] of ecs.players.entries()) {
            const ot = ecs.transforms.get(oe)!;
            const ov = ecs.velocities.get(oe)!;
            
            if (Math.abs(ot.x - t.x) < VIEW_W / 2 + CULL_MARGIN && Math.abs(ot.y - t.y) < VIEW_H / 2 + CULL_MARGIN) {
                state.players[op.id] = { x: ot.x, y: ot.y, vx: ov.vx, vy: ov.vy, angle: ot.angle, angleStep: op.angleStep, isDead: op.isDead, isLanded: op.isLanded, inputs: op.inputs, score: op.score };
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
