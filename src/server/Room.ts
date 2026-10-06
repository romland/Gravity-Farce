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
        level.entities.forEach(ent => {
            if (ent.type === 'turret') spawnTurret(this.ecs, ent.x, ent.y, ent.props?.orientUp || false);
        });
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
        let chosenX: number | null = null;
        let chosenY: number | null = null;

        const spawnEntities = this.level.entities.filter(e => e.type === 'spawn');
        let candidateSpots = spawnEntities.map(e => ({ x: e.x, y: e.y }));
        if (candidateSpots.length === 0) {
            candidateSpots = [{ x: 100, y: 100 }]; // Failsafe
        }

        for (let pt of candidateSpots) {
            let clear = true;
            for (const [e, p] of this.ecs.players.entries()) {
                if (p.id !== id && !p.isDead) {
                    const t = this.ecs.transforms.get(e)!;
                    if (Math.hypot(t.x - pt.x, t.y - pt.y) < 30) clear = false;
                }
            }
            if (clear) { chosenX = pt.x; chosenY = pt.y; break; }
        }

        if (chosenX !== null) {
            const existing = this.ecs.getPlayerEntity(id);
            if (existing !== undefined) this.ecs.destroy(existing);
            
            if (type === 'classic') spawnClassicPlayer(this.ecs, id, chosenX, chosenY!);
            else spawnModernPlayer(this.ecs, id, chosenX, chosenY!);

            const playerEntity = this.ecs.getPlayerEntity(id);
            if (playerEntity !== undefined) {
                const p = this.ecs.players.get(playerEntity);
                if (p) {
                    p.isLanded = true;
                    const v = this.ecs.velocities.get(playerEntity);
                    if (v) {
                        v.vx = 0;
                        v.vy = 0;
                        v.angularVelocity = 0;
                    }
                }
            }

        } else {
            setTimeout(() => this.trySpawnPlayer(id, type), 500);
        }
    }

    transitionPlayer(id: string) {
        this.transitionCb(id);
    }
}