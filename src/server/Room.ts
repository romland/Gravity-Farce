import { Server } from 'socket.io';
import type { LevelData } from './core/types';
import { Registry } from './core/ecs';
import { spawnTurret, sysTurrets, sysBullets } from './game/combat';
import { spawnModernPlayer, sysModernPlayers } from './game/player-modern';
import { spawnClassicPlayer, sysClassicPlayers } from './game/player-classic';
import { sysWeapons, sysNetworkSync } from './game/systems';

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
        sysWeapons(this.ecs);
        sysTurrets(this.ecs, this);
        sysBullets(this.ecs, this);

        sysNetworkSync(this.ecs, this.levelIndex, this.io);
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