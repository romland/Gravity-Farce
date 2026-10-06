import { Registry } from '../core/ecs';
import { spawnBullet } from './combat';
import { Server } from 'socket.io';

export function sysWeapons(ecs: Registry) {
    for (const [e, p] of ecs.players.entries()) {
        if (p.isDead) continue;
        const t = ecs.transforms.get(e)!;
        const v = ecs.velocities.get(e)!;

        if (p.gunCooldown > 0) p.gunCooldown--;
        let activeShoot = p.inputs.shoot || p.shootLatch;
        if (activeShoot && !p.prevShoot) p.gunCooldown = 0; // Arcade bypass
        
        if (activeShoot && p.gunCooldown <= 0) {
            // Slight bullet offset & speed based on facing angle
            const offset = 14; const bSpeed = p.type === 'classic' ? 5.0 : 3.0; 
            spawnBullet(ecs, t.x + Math.cos(t.angle)*offset, t.y + Math.sin(t.angle)*offset, 
                        v.vx + Math.cos(t.angle)*bSpeed, v.vy + Math.sin(t.angle)*bSpeed, true, p.id);
            p.gunCooldown = p.type === 'classic' ? 10 : 15;
        }
        p.prevShoot = activeShoot; p.shootLatch = false;
    }
}

export function sysNetworkSync(ecs: Registry, levelIndex: number, io: Server) {
    const state = { players: {} as any, turrets: [] as any, bullets: [] as any };
    
    for (const [e, p] of ecs.players.entries()) {
        const t = ecs.transforms.get(e)!;
        const v = ecs.velocities.get(e)!;
        state.players[p.id] = { x: t.x, y: t.y, vx: v.vx, vy: v.vy, angle: t.angle, angleStep: p.angleStep, isDead: p.isDead, isLanded: p.isLanded, inputs: p.inputs };
    }
    for (const [e, turret] of ecs.turrets.entries()) {
        const t = ecs.transforms.get(e)!;
        state.turrets.push({ x: t.x, y: t.y, angle: t.angle, orientUp: turret.orientUp, active: turret.active });
    }
    for (const [e, b] of ecs.bullets.entries()) {
        const t = ecs.transforms.get(e)!;
        state.bullets.push({ x: t.x, y: t.y, isPlayer: b.isPlayer });
    }

    io.to(`level_${levelIndex}`).emit('state', state);
}