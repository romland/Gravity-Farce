import { Server } from 'socket.io';
import type { LevelData } from './core/types';
import { Registry } from './core/ecs';
import { spawnTurret, sysTurrets, sysBullets } from './game/combat';
import { spawnModernPlayer, sysModernPlayers } from './game/player-modern';
import { spawnClassicPlayer, sysClassicPlayers } from './game/player-classic';
import { sysWeapons, sysNetworkSync } from './game/systems';
import { spawnTank, sysTanks } from './game/tank-ai';
import { spawnFlyingEnemy, sysFlyingEnemies } from './game/flying-ai';
import { sysBotAI } from './game/bot-dogfighting';
import { sysRacingBotAI } from './game/bot-racing';
import { sysMissionBotAI } from './game/bot-mission';
import { spawnCargo, sysCargo } from './game/cargo';
import { spawnPowerup, sysPowerups } from './game/powerups';
import { sysRacing } from './game/racing';
import { sysMission } from './game/mission';
import type { PlayerStats } from './core/types';
import { getLevelCategory, type LevelCategory } from './levels';
import { TILE_DICTIONARY } from './core/tiles';
import { GameTracker } from './core/tracker';
import { SERVER_CONFIG } from './core/config';
import { createPRNG } from './core/math';
import { getActivePhysicsHash } from './core/records';
import { FloraBurnSystem, type FloraBurnRecord } from './game/highres/FloraBurnSystem';
import { botPathWorker } from './game/bot-path-worker';

export class Room {
    public ecs = new Registry();
    private initialRawMap?: number[][];
    public initialCargoCount = 0;
    private debugEnemyCounter = 0;
    public globalWaveTimer = 0;
    public activeClientIds = new Set<string>();
    public seed: number;
    public prng: () => number;
    public category: LevelCategory;
    public tracker: GameTracker;
    public isReplayMode: boolean = false;
    private lastInputMasks = new Map<string, number>();
    public replayFrames: any[] = [];
    public floraBurns = new Map<number, FloraBurnRecord>();
    public floraHeat = new Map<number, number>();

    constructor(public levelIndex: number, public level: LevelData, private io: Server, private transitionCb: (id: string) => void, public isLethalRacing: boolean = false, public raceBumpModifier: number = 0.4) {
        if (level.rawMap) {
            this.initialRawMap = JSON.parse(JSON.stringify(level.rawMap));
        }
        this.category = getLevelCategory(levelIndex);
        this.seed = Date.now();
        this.prng = createPRNG(this.seed);
        this.tracker = new GameTracker(levelIndex, this.category, 'SP', getActivePhysicsHash(), SERVER_CONFIG.debugMode);
        this.tracker['entry'].replayData.seed = this.seed;
        this.spawnEntities();
        botPathWorker.syncLevel(this.levelIndex, this.level, true);
        this.printLevelStats();
    }

    tick(isPaused: boolean = false) {
        if (this.activeClientIds.size === 0) return;

        if (!isPaused) {
            if (!this.isReplayMode) {
                const frameInputs: Record<string, number> = {};
                for (const [e, p] of this.ecs.players.entries()) {
                    let mask = 0;
                    if (p.inputs.up) mask |= 1;
                    if (p.inputs.left) mask |= 2;
                    if (p.inputs.right) mask |= 4;
                    if (p.inputs.shoot) mask |= 8;
                    if (this.lastInputMasks.get(p.id) !== mask) {
                        frameInputs[p.id] = mask;
                        this.lastInputMasks.set(p.id, mask);
                    }
                }
                if (Object.keys(frameInputs).length > 0) {
                    this.tracker.logReplayFrame({ t: this.globalWaveTimer, i: frameInputs });
                }
            } else {
                const frame = this.replayFrames.find(f => f.t === this.globalWaveTimer);
                if (frame && frame.i) {
                    for (const [pid, mask] of Object.entries(frame.i)) {
                        const e = this.ecs.getPlayerEntity(pid);
                        if (e !== undefined) {
                            const p = this.ecs.players.get(e)!;
                            p.inputs.up = ((mask as number) & 1) !== 0;
                            p.inputs.left = ((mask as number) & 2) !== 0;
                            p.inputs.right = ((mask as number) & 4) !== 0;
                            p.inputs.shoot = ((mask as number) & 8) !== 0;
                            if (p.inputs.shoot) {
                                const w = this.ecs.weaponMounts.get(e);
                                if (w) w.shootLatch = true;
                            }
                        }
                    }
                }
            }
            this.globalWaveTimer++;
            for (const [e, p] of this.ecs.players.entries()) {
                if (p.respawnRequest) { p.respawnRequest = false; this.trySpawnPlayer(p.id, p.type); }
            }

            sysModernPlayers(this.ecs, this);
            sysClassicPlayers(this.ecs, this);
            sysWeapons(this.ecs);
            sysTurrets(this.ecs, this);
            sysBotAI(this.ecs, this);
            sysRacingBotAI(this.ecs, this);
            sysMissionBotAI(this.ecs, this);
            sysTanks(this.ecs, this);
            sysFlyingEnemies(this.ecs, this);
            sysCargo(this.ecs, this);
            sysPowerups(this.ecs, this);
            sysRacing(this.ecs, this);
            sysMission(this.ecs, this);
            sysBullets(this.ecs, this);
            FloraBurnSystem.update(this.ecs, this);
        }

        sysNetworkSync(this.ecs, this, this.io);

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
                spawnFlyingEnemy(this.ecs, ent.x, ent.y, ent.props?.enemyType || 0xEC, this.debugEnemyCounter, this.prng);
            }
            if (ent.type === 'cargo') {
                spawnCargo(this.ecs, ent.x, ent.y, ent.props?.typeId || 0xD1);
            }
            if (ent.type === 'powerup') {
                spawnPowerup(this.ecs, ent.x, ent.y, ent.props?.typeId || 0xD6);
            }
        });
    }

    addPlayer(id: string, type: 'classic' | 'modern', stats?: Partial<PlayerStats>) {
        this.activeClientIds.add(id);
        if (this.ecs.players.size === 0) {
            this.resetLevel();
        }
        if (this.activeClientIds.size > 1) {
            this.tracker['entry'].mode = 'MP';
        }
        this.trySpawnPlayer(id, type, { ...stats, joinedAtTick: this.globalWaveTimer });
        this.tracker.initPlayer(id, stats?.uuid || id, stats?.alias || 'UNK');
        if (this.floraBurns.size > 0) {
            const burns = Array.from(this.floraBurns.entries()).map(([idx, b]) => ({ idx, originT: b.originT }));
            this.emitToPlayer(id, 'flora_burn_sync', burns);
        }
    }

    removePlayer(id: string) {
        this.activeClientIds.delete(id);
        const e = this.ecs.getPlayerEntity(id);
        if (e !== undefined) {
            const w = this.ecs.weaponMounts.get(e);
            if (w) this.tracker.updatePlayerShots(id, w.shotsFired);
            const f = this.ecs.fuelTanks.get(e);
            if (f) this.tracker.updatePlayerFuelConsumed(id, f.consumed);
            this.ecs.destroy(e);
        }
        // Note: Room deletion when empty is now handled by the parent index.ts
        if (this.activeClientIds.size === 0) {
            for (const [botE] of Array.from(this.ecs.bots.entries())) {
                this.ecs.destroy(botE);
            }
        }
    }

    trySpawnPlayer(id: string, type: 'classic' | 'modern', stats?: Partial<PlayerStats>) {
        const isBot = id.includes('BOT_') || id.includes('RACER_') || id.includes('MBOT_');
        if (!this.activeClientIds.has(id) && !isBot) return;
        let chosenX: number | null = null;
        let chosenY: number | null = null;

        const spawnEntities = this.level.entities
            .filter(e => e.type === 'spawn')
            .sort((a, b) => (a.props?.player || 1) - (b.props?.player || 1));

        let candidateSpots = spawnEntities.map(e => ({ x: e.x, y: e.y }));
        if (candidateSpots.length === 0) {
            candidateSpots = [{ x: 100, y: 100 }]; // Failsafe
        }

        let freeSpots = [];
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
            if (clear) freeSpots.push(pt);
        }

        if (freeSpots.length > 0) {
            chosenX = freeSpots[0].x;
            chosenY = freeSpots[0].y;
        } else if (candidateSpots.length > 1) {
            // If all spots are blocked on a multi-spawn map, force a spawn instead of queuing
            const spot = candidateSpots[Math.floor(this.prng() * candidateSpots.length)];
            chosenX = spot.x;
            chosenY = spot.y;
        }

        if (chosenX !== null) {
            let spawnStats = stats ? { ...stats } : undefined;
            let oldBotState: any = undefined;
            const existing = this.ecs.getPlayerEntity(id);
            if (existing !== undefined) {
                const oldP = this.ecs.players.get(existing);
                oldBotState = this.ecs.bots.get(existing);
                if (oldP) {
                    spawnStats = { score: oldP.score, race: oldP.race, uuid: oldP.uuid, alias: oldP.alias, joinedAt: oldP.joinedAt, shotsFired: oldP.shotsFired, lives: oldP.lives }; // Keep score, race, identity, level timer, shots, and lives
                }
                this.ecs.destroy(existing);
            }

            if (type === 'classic') spawnClassicPlayer(this.ecs, id, chosenX, chosenY!, spawnStats);
            else spawnModernPlayer(this.ecs, id, chosenX, chosenY!, spawnStats);

            const playerEntity = this.ecs.getPlayerEntity(id);
            if (playerEntity !== undefined) {
                if (oldBotState) {
                    oldBotState.state = 'takeoff';
                    oldBotState.stateTimer = 20;
                    oldBotState.path = [];
                    this.ecs.bots.set(playerEntity, oldBotState);
                }
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
            setTimeout(() => this.trySpawnPlayer(id, type, stats), 500);
        }
    }

    transitionPlayer(id: string) {
        this.transitionCb(id);
    }

    broadcastTileUpdate(x: number, y: number, tile: number) {
        this.io.to(`level_${this.levelIndex}`).emit('tile_update', { x, y, tile });
        botPathWorker.notifyTileUpdate(this.levelIndex, x, y, tile);
    }

    broadcastFloraBurn(idx: number, originT: number) {
        this.io.to(`level_${this.levelIndex}`).emit('flora_burn', { idx, originT });
    }

    emitToPlayer(id: string, event: string, payload: any) {
        this.io.to(id).emit(event, payload);
    }

    resetLevel() {
        this.tracker.finishAndSave();
        this.tracker = new GameTracker(this.levelIndex, this.category, this.activeClientIds.size > 1 ? 'MP' : 'SP', getActivePhysicsHash(), SERVER_CONFIG.debugMode);
        this.seed = Date.now();
        this.prng = createPRNG(this.seed);
        this.tracker['entry'].replayData.seed = this.seed;
        this.globalWaveTimer = 0;
        this.lastInputMasks.clear();
        this.floraBurns.clear();
        this.floraHeat.clear();
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
        for (const [e] of Array.from(this.ecs.bots.entries())) {
            this.ecs.destroy(e);
        }
        for (const [e] of Array.from(this.ecs.bullets.entries())) {
            this.ecs.destroy(e);
        }
        for (const [e] of Array.from(this.ecs.homingMissiles.entries())) {
            this.ecs.destroy(e);
        }
        this.spawnEntities();
        botPathWorker.syncLevel(this.levelIndex, this.level, true);
        this.io.to(`level_${this.levelIndex}`).emit('initLevel', this.level);
    }

    private printLevelStats() {
        if (!this.level.rawMap) return;

        const counts: Record<number, number> = {};
        for (let y = 0; y < this.level.rawMap.length; y++) {
            for (let x = 0; x < this.level.rawMap[y].length; x++) {
                const tile = this.level.rawMap[y][x];
                counts[tile] = (counts[tile] || 0) + 1;
            }
        }

        const formatCounts = (tiles: number[]) => {
            const found = tiles.filter(t => counts[t]);
            if (found.length === 0) return '0';
            const total = found.reduce((sum, t) => sum + counts[t], 0);
            const details = found.map(t => `0x${t.toString(16).toUpperCase().padStart(2, '0')}: ${counts[t]}`).join(', ');
            return `${total} (${details})`;
        };

        const spawns: number[] = [];
        const checkpoints: number[] = [];
        const cargos: number[] = [];
        const turrets: number[] = [];
        const flying: number[] = [];
        const tanks: number[] = [];
        const powerups: number[] = [];

        for (const [idStr, def] of Object.entries(TILE_DICTIONARY)) {
            const id = parseInt(idStr, 10);
            const type = def.entity?.type;
            if (type === 'spawn') spawns.push(id);
            else if (def.description.toLowerCase().includes('checkpoint')) checkpoints.push(id);
            else if (type === 'cargo') cargos.push(id);
            else if (type === 'turret') turrets.push(id);
            else if (type === 'flying_enemy') flying.push(id);
            else if (type === 'path_node' && def.entity?.props?.index === 0) tanks.push(id);
            else if (type === 'powerup') powerups.push(id);
        }

        console.log(`\n=== LEVEL ${this.levelIndex} DIAGNOSTICS (Current Category: ${this.category}) ===`);
        console.log(`   - Spawns:         ${formatCounts(spawns)}`);
        console.log(`   - Checkpoints:    ${formatCounts(checkpoints)}`);
        console.log(`   - Cargos:         ${formatCounts(cargos)}`);
        console.log(`   - Turrets:        ${formatCounts(turrets)}`);
        console.log(`   - Flying Enemies: ${formatCounts(flying)}`);
        console.log(`   - Tanks (Nodes):  ${formatCounts(tanks)}`);
        console.log(`   - Powerups:       ${formatCounts(powerups)}`);
        console.log(`   - Physics hash:   ${getActivePhysicsHash()}`);
    }
}
