import { Server } from 'socket.io';
import type { LevelData } from './core/types';
import { Registry } from './core/ecs';
import { spawnTurret, sysTurrets, sysBullets } from './game/combat';
import { spawnModernPlayer, sysModernPlayers } from './game/player-modern';
import { spawnClassicPlayer, sysClassicPlayers } from './game/player-classic';
import { sysWeapons, sysNetworkSync } from './game/systems';
import { spawnTank, sysTanks } from './game/tank-ai';
import { spawnFlyingEnemy, sysFlyingEnemies } from './game/flying-ai';
import { spawnCargo, sysCargo } from './game/cargo';
import { spawnPowerup, sysPowerups } from './game/powerups';

export class Room {
    public ecs = new Registry();
    private initialRawMap?: number[][];
    public initialCargoCount = 0;
    private debugEnemyCounter = 0;

    constructor(public levelIndex: number, public level: LevelData, private io: Server, private transitionCb: (id: string) => void) {
        if (level.rawMap) {
            this.initialRawMap = JSON.parse(JSON.stringify(level.rawMap));
        }
        this.spawnEntities();
    }

    tick(isPaused: boolean = false) {
        if (this.ecs.players.size === 0) return;

        if (!isPaused) {
            for (const [e, p] of this.ecs.players.entries()) {
                if (p.respawnRequest) { p.respawnRequest = false; this.trySpawnPlayer(p.id, p.type); }
            }

            sysModernPlayers(this.ecs, this);
            sysClassicPlayers(this.ecs, this);
            sysWeapons(this.ecs);
            sysTurrets(this.ecs, this);
            sysTanks(this.ecs, this);
            sysFlyingEnemies(this.ecs, this);
             sysCargo(this.ecs, this);
             sysPowerups(this.ecs, this);
            sysBullets(this.ecs, this);
        }

        sysNetworkSync(this.ecs, this.levelIndex, this.io);
        
        this.ecs.events = [];
    }

    private spawnEntities() {
        this.debugEnemyCounter = 0;
        this.initialCargoCount = this.level.entities.filter(e => e.type === 'cargo').length;

        this.level.entities.forEach(ent => {
            if (ent.type === 'turret') {
                spawnTurret(this.ecs, ent.x, ent.y, ent.props?.turretType || 0xAF, ent.props?.orientUp || false);
            }
            if (ent.type === 'path_node' && ent.props?.index === 0) {
                // We spawn one tank at the start of a path sequence (node 0)
                // To increase density, we could spawn on multiple node indices later
                this.debugEnemyCounter++;
                spawnTank(this.ecs, ent.x, ent.y, this.debugEnemyCounter);
            }
            if (ent.type === 'flying_enemy') {
                this.debugEnemyCounter++;
                spawnFlyingEnemy(this.ecs, ent.x, ent.y, ent.props?.enemyType || 0xEC, this.debugEnemyCounter);
            }
             if (ent.type === 'cargo') {
                 spawnCargo(this.ecs, ent.x, ent.y, ent.props?.typeId || 0xD1);
             }
             if (ent.type === 'powerup') {
                 spawnPowerup(this.ecs, ent.x, ent.y, ent.props?.typeId || 0xD6);
             }
        });
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

        const spawnEntities = this.level.entities
            .filter(e => e.type === 'spawn')
            .sort((a, b) => (a.props?.player || 1) - (b.props?.player || 1));

        let candidateSpots = spawnEntities.map(e => ({ x: e.x, y: e.y }));
        if (candidateSpots.length === 0) {
            candidateSpots = [{ x: 100, y: 100 }]; // Failsafe
        }

        for (let pt of candidateSpots) {
            let clear = true;
            for (const [e, p] of this.ecs.players.entries()) {
                if (p.id !== id && !p.isDead) {
                    const t = this.ecs.transforms.get(e)!;
                    if (Math.hypot(t.x - pt.x, t.y - pt.y) < 30) {
                        clear = false;
                    }
                }
            }
            
            if (clear) { 
                chosenX = pt.x; 
                chosenY = pt.y; 
                break; 
            }
        }

        if (chosenX !== null) {
            let preservedScore = 0;
            const existing = this.ecs.getPlayerEntity(id);
            if (existing !== undefined) {
                const oldP = this.ecs.players.get(existing);
                if (oldP) preservedScore = oldP.score;
                this.ecs.destroy(existing);
            }
            
            if (type === 'classic') spawnClassicPlayer(this.ecs, id, chosenX, chosenY!, preservedScore);
            else spawnModernPlayer(this.ecs, id, chosenX, chosenY!, preservedScore);

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

    broadcastTileUpdate(x: number, y: number, tile: number) {
        this.io.to(`level_${this.levelIndex}`).emit('tile_update', { x, y, tile });
    }

    resetLevel() {
        if (this.initialRawMap) {
            this.level.rawMap = JSON.parse(JSON.stringify(this.initialRawMap));
        }
        for (const [e] of Array.from(this.ecs.turrets.entries())) {
            this.ecs.destroy(e);
        }
        for (const [e] of Array.from(this.ecs.tanks.entries())) {
            this.ecs.destroy(e);
        }
        for (const [e] of Array.from(this.ecs.flyingEnemies.entries())) {
            this.ecs.destroy(e);
        }
         for (const [e] of Array.from(this.ecs.cargos.entries())) {
             this.ecs.destroy(e);
         }
         for (const [e] of Array.from(this.ecs.powerups.entries())) {
             this.ecs.destroy(e);
         }
        this.spawnEntities();
        this.io.to(`level_${this.levelIndex}`).emit('initLevel', this.level);
    }    
}
