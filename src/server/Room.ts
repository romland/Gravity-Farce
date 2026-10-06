import { Server } from 'socket.io';
import type { LevelData } from './types';
import { Registry } from './ecs';
import { spawnTurret, sysTurrets, sysBullets } from './combat';
import { spawnModernPlayer, sysModernPlayers } from './player-modern';
import { spawnClassicPlayer, sysClassicPlayers } from './player-classic';

export class Room {
    public ecs = new Registry();

    constructor(public levelIndex: number, public level: LevelData, private io: Server, private transitionCb: (id: string) => void) {
        level.turrets.forEach(t => spawnTurret(this.ecs, t.x, t.y, t.orientUp));
    }

    tick() {
        if (this.ecs.players.size === 0) return;

        for (const [e, p] of this.ecs.players.entries()) {
            if (p.respawnRequest) { p.respawnRequest = false; this.trySpawnPlayer(p.id, p.type); }
        }

        sysModernPlayers(this.ecs, this);
        sysClassicPlayers(this.ecs, this);
        sysTurrets(this.ecs, this);
        sysBullets(this.ecs, this);

        const state = { players: {} as any, turrets: [] as any, bullets: [] as any };
        
        for (const [e, p] of this.ecs.players.entries()) {
            const t = this.ecs.transforms.get(e)!;
            const v = this.ecs.velocities.get(e)!;
            state.players[p.id] = { x: t.x, y: t.y, vx: v.vx, vy: v.vy, angle: t.angle, angleStep: p.angleStep, isDead: p.isDead, isLanded: p.isLanded, inputs: p.inputs };
        }
        for (const [e, turret] of this.ecs.turrets.entries()) {
            const t = this.ecs.transforms.get(e)!;
            state.turrets.push({ x: t.x, y: t.y, angle: t.angle, orientUp: turret.orientUp, active: turret.active });
        }
        for (const [e, b] of this.ecs.bullets.entries()) {
            const t = this.ecs.transforms.get(e)!;
            state.bullets.push({ x: t.x, y: t.y, isPlayer: b.isPlayer });
        }

        this.io.to(`level_${this.levelIndex}`).emit('state', state);
    }

    addPlayer(id: string, type: 'classic' | 'modern') {
        this.trySpawnPlayer(id, type);
    }

    removePlayer(id: string) {
        const e = this.ecs.getPlayerEntity(id);
        if (e !== undefined) this.ecs.destroy(e);
    }

    trySpawnPlayer(id: string, type: 'classic' | 'modern') {
        const spawnY = this.level.startPad.y - 20;
        const padW = this.level.startPad.w;
        const spots = [this.level.startPad.x + 25, this.level.startPad.x + padW - 25, this.level.startPad.x + padW / 2];
        
        let chosenX: number | null = null;
        for (let x of spots) {
            let clear = true;
            for (const [e, p] of this.ecs.players.entries()) {
                if (p.id !== id && !p.isDead) {
                    const t = this.ecs.transforms.get(e)!;
                    if (Math.hypot(t.x - x, t.y - spawnY) < 30) clear = false;
                }
            }
            if (clear) { chosenX = x; break; }
        }

        if (chosenX !== null) {
            const existing = this.ecs.getPlayerEntity(id);
            if (existing !== undefined) this.ecs.destroy(existing);
            
            if (type === 'classic') spawnClassicPlayer(this.ecs, id, chosenX, spawnY);
            else spawnModernPlayer(this.ecs, id, chosenX, spawnY);
        } else {
            setTimeout(() => this.trySpawnPlayer(id, type), 500);
        }
    }

    transitionPlayer(id: string) {
        this.transitionCb(id);
    }
}