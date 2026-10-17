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
import { sysDogfight, assignDogfightTeam } from './game/dogfight';
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
    public lastClientViews = new Map<string, { x: number; y: number }>();
    public assignedHomes = new Map<string, { x: number; y: number }>();
    private gameOverResetTimer: any = null;
    public dogfightCompleted: boolean = false;
    public allowSpectators: boolean = true;
    public pendingReplayActors: { actorId: string; type: 'classic' | 'modern'; stats: any; joinedAtTick: number }[] = [];

    constructor(
        public roomId: number,
        public levelIndex: number,
        public level: LevelData,
        private io: Server,
        private transitionCb: (id: string) => void,
        public isLethalRacing: boolean = false,
        public raceBumpModifier: number = 0.4,
        public isReplayMode: boolean = false,
        public sessionMode: 'SP' | 'MP' = 'SP',
        public joinCode: string = '',
        initialSeed?: number
    ) {
        if (level.rawMap) {
            this.initialRawMap = JSON.parse(JSON.stringify(level.rawMap));
        }
        this.category = getLevelCategory(levelIndex);
        this.seed = initialSeed !== undefined ? initialSeed : Date.now();
        this.prng = createPRNG(this.seed);
        this.tracker = new GameTracker(levelIndex, this.category, this.sessionMode, getActivePhysicsHash(), SERVER_CONFIG.debugMode);
        if (this.isReplayMode) {
            (this.tracker as any).isActive = false;
        }
        this.tracker['entry'].replayData.seed = this.seed;
        this.spawnEntities();
        this.syncRoomRulesComponent();
        botPathWorker.syncLevel(this.roomId, this.level, true);
        this.printLevelStats();
    }

    public syncRoomRulesComponent() {
        let flavor = 'STANDARD';
        let objectiveText = 'REACH EXIT PAD';
        if (this.category === 'mission') {
            flavor = this.initialCargoCount > 0 ? 'CARGO RECOVERY' : 'INFILTRATION';
            objectiveText = this.initialCargoCount > 0 ? 'DELIVER ALL CARGO TO HOME PAD' : 'LAND ON DESIGNATED EXIT PAD';
        } else if (this.category === 'race') {
            flavor = this.isLethalRacing ? 'LETHAL CIRCUIT' : 'BUMPER CIRCUIT';
            objectiveText = '3-LAP CHECKPOINT SPRINT';
        } else if (this.category === 'dogfight') {
            flavor = this.getRoomMode() === 'MP' ? 'TEAM ELIMINATION' : 'BOT SKIRMISH';
            objectiveText = 'ELIMINATE OPPOSING SQUADRON';
        }
        this.ecs.roomRules = {
            discipline: this.category,
            flavor,
            objectiveText,
            customCounters: {}
        };
    }

    public get channel(): string {
        return `room_${this.roomId}`;
    }

    public getRoomMode(): 'SP' | 'MP' {
        return this.sessionMode === 'MP' ? 'MP' : 'SP';
    }

    public getBotCount(): number {
        return this.ecs.bots.size;
    }

    public getPhysicsHash(): string {
        return getActivePhysicsHash(this.getBotCount());
    }

    public broadcastGlobalAnnouncement(text: string) {
        this.io.emit('server_announcement', { text });
    }

    public checkAllPlayersOutOfLives() {
        if (this.isReplayMode || this.activeClientIds.size === 0) return;
        if (this.category === 'dogfight') return; // Dogfight round completion is handled by sysDogfight
        let anyHumanAliveOrHasLives = false;
        for (const [e, p] of this.ecs.players.entries()) {
            if (this.ecs.bots.has(e)) continue;
            if (!p.isDead || p.lives > 0) {
                anyHumanAliveOrHasLives = true;
                break;
            }
        }
        if (!anyHumanAliveOrHasLives && !this.gameOverResetTimer) {
            this.tracker.finishAndSave(); // Save replay instantly before the 4s Game Over timer!
            this.tracker.isCompleted = true;
            this.tracker.finishAndSave();
            this.gameOverResetTimer = setTimeout(() => {
                this.gameOverResetTimer = null;
                if (this.activeClientIds.size === 0) return;
                this.resetLevel();
                for (const clientId of this.activeClientIds) {
                    const pe = this.ecs.getPlayerEntity(clientId);
                    if (pe !== undefined) {
                        const oldP = this.ecs.players.get(pe)!;
                        this.trySpawnPlayer(clientId, oldP.type, {
                            score: 0,
                            uuid: oldP.uuid,
                            alias: oldP.alias,
                            isBot: oldP.isBotPilot,
                            lives: SERVER_CONFIG.defaultLives,
                            joinedAtTick: this.globalWaveTimer,
                            shotsFired: 0,
                            fuelConsumed: 0,
                            streakStartLevel: this.levelIndex,
                            streakLastLevel: this.levelIndex,
                            homeSpawnX: oldP.homeSpawnX,
                            homeSpawnY: oldP.homeSpawnY
                        });
                    }
                    this.emitToPlayer(clientId, 'hide_game_over', {});
                }
            }, 4000);
        }
    }

    tick(isPaused: boolean = false) {
        if (this.activeClientIds.size === 0) return;

        if (!isPaused) {
            if (!this.isReplayMode) {
                const frameInputs: Record<string, number> = {};
                for (const [e, p] of this.ecs.players.entries()) {
                    if (!this.tracker['entry'].playerStats[p.id]) {
                        this.tracker.initPlayer(p.id, p.uuid, p.alias, {
                            shipType: p.type,
                            team: p.team,
                            homeSpawnX: p.homeSpawnX,
                            homeSpawnY: p.homeSpawnY,
                            isBot: this.ecs.bots.has(e) || Boolean(p.isBotPilot),
                            joinedAtTick: p.joinedAtTick
                        });
                    }
                    let mask = 0;
                    if (p.inputs.up) mask |= 1;
                    if (p.inputs.left) mask |= 2;
                    if (p.inputs.right) mask |= 4;
                    if (p.inputs.shoot) mask |= 8;
                    const w = this.ecs.weaponMounts.get(e);
                    if (w?.shootLatch) mask |= 16;
                    if (p.inputs.analogX) mask |= ((Math.round(p.inputs.analogX * 127) & 0xFF) << 8);
                    if (p.inputs.analogUp) mask |= ((Math.round(p.inputs.analogUp * 255) & 0xFF) << 16);
                    // Always log if shootLatch (bit 16) is present or if continuous input state changed
                    if ((mask & 16) !== 0 || this.lastInputMasks.get(p.id) !== (mask & ~16)) {
                        frameInputs[p.id] = mask;
                        this.lastInputMasks.set(p.id, mask & ~16);
                    }
                }
                if (Object.keys(frameInputs).length > 0) {
                    this.tracker.logReplayFrame({ t: this.globalWaveTimer, i: frameInputs });
                }
            } else {
                if (this.pendingReplayActors.length > 0) {
                    for (let i = this.pendingReplayActors.length - 1; i >= 0; i--) {
                        const pa = this.pendingReplayActors[i];
                        if (pa.joinedAtTick <= this.globalWaveTimer) {
                            this.addReplayActor(pa.actorId, pa.type, pa.stats);
                            this.pendingReplayActors.splice(i, 1);
                        }
                    }
                }
                const frame = this.replayFrames.find(f => f.t === this.globalWaveTimer);
                if (frame && frame.i) {
                    for (const [pid, mask] of Object.entries(frame.i)) {
                        const e = this.ecs.getPlayerEntity(pid);
                        if (e !== undefined) {
                            const p = this.ecs.players.get(e)!;
                            const prevShoot = p.inputs.shoot;
                            const numMask = mask as number;
                            p.inputs.up = (numMask & 1) !== 0;
                            p.inputs.left = (numMask & 2) !== 0;
                            p.inputs.right = (numMask & 4) !== 0;
                            p.inputs.shoot = (numMask & 8) !== 0;
                            const analogByte = (numMask >> 8) & 0xFF;
                            if (analogByte !== 0) {
                                p.inputs.analogX = ((analogByte << 24) >> 24) / 127.0; // Bitwise sign extension
                            } else {
                                p.inputs.analogX = undefined;
                            }
                            const analogUpByte = (numMask >> 16) & 0xFF;
                            if (analogUpByte !== 0) {
                                p.inputs.analogUp = analogUpByte / 255.0;
                            } else {
                                p.inputs.analogUp = undefined;
                            }
                            // CRITICAL FIX: Only latch a shot on an explicit shootLatch bit (16) OR a true rising edge (!prevShoot && p.inputs.shoot).
                            // Never re-latch just because left/right/up changed while shoot was held down!
                            if ((numMask & 16) !== 0 || (!prevShoot && p.inputs.shoot)) {
                                const w = this.ecs.weaponMounts.get(e);
                                if (w) w.shootLatch = true;
                            }
                        }
                    }
                }
            }
            this.globalWaveTimer++;
            for (const [e, p] of this.ecs.players.entries()) {
                if (p.isDead && p.respawnTimer !== undefined && p.respawnTimer > 0) {
                    p.respawnTimer--;
                    if (p.respawnTimer <= 0) {
                        p.respawnTimer = undefined;
                        p.respawnRequest = true;
                    }
                }
                if (p.respawnRequest) { p.respawnRequest = false; if (p.lives > 0) this.trySpawnPlayer(p.id, p.type); }
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
            sysDogfight(this.ecs, this);
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
        if (this.sessionMode === 'MP' || this.activeClientIds.size > 1) {
            this.tracker['entry'].mode = 'MP';
        }
        this.trySpawnPlayer(id, type, { ...stats, joinedAtTick: this.globalWaveTimer });
        const pe = this.ecs.getPlayerEntity(id);
        const p = pe !== undefined ? this.ecs.players.get(pe) : undefined;
        this.tracker.initPlayer(id, stats?.uuid || id, stats?.alias || 'UNK', {
            shipType: p?.type || type,
            team: p?.team,
            homeSpawnX: p?.homeSpawnX,
            homeSpawnY: p?.homeSpawnY,
            isBot: Boolean(stats?.isBot),
            joinedAtTick: this.globalWaveTimer
        });
        if (this.floraBurns.size > 0) {
            const burns = Array.from(this.floraBurns.entries()).map(([idx, b]) => ({ idx, originT: b.originT }));
            this.emitToPlayer(id, 'flora_burn_sync', burns);
        }
        this.syncRoomRulesComponent();
        this.emitToPlayer(id, 'room_rules', this.ecs.roomRules);
        if (!this.isReplayMode) {
            this.emitToPlayer(id, 'game_hint', {
                id: `deploy_${this.category}`,
                title: `${this.category.toUpperCase()} - ${this.ecs.roomRules.flavor}`,
                body: this.ecs.roomRules.objectiveText,
                showKeys: this.levelIndex === 0
            });
        }
    }

    addReplayActor(actorId: string, type: 'classic' | 'modern', stats?: Partial<PlayerStats>) {
        // Never add replay actors to activeClientIds; they are simulated entities, not connected sockets
        this.trySpawnPlayer(actorId, type, { ...stats, joinedAtTick: 0 }, true);
    }

    addSpectator(socketId: string) {
        this.activeClientIds.add(socketId);
        if (this.floraBurns.size > 0) {
            const burns = Array.from(this.floraBurns.entries()).map(([idx, b]) => ({ idx, originT: b.originT }));
            this.emitToPlayer(socketId, 'flora_burn_sync', burns);
        }
    }

    removeClient(id: string) {
        this.activeClientIds.delete(id);
        this.lastClientViews.delete(id);
        const e = this.ecs.getPlayerEntity(id);
        if (e !== undefined) {
            const w = this.ecs.weaponMounts.get(e);
            if (w) this.tracker.updatePlayerShots(id, w.shotsFired);
            const f = this.ecs.fuelTanks.get(e);
            if (f) this.tracker.updatePlayerFuelConsumed(id, f.consumed);
            this.ecs.destroy(e);
        }
        if (this.activeClientIds.size === 0) {
            this.destroyAllEntities();
        } else {
            this.checkAllPlayersOutOfLives();
        }
    }

    trySpawnPlayer(id: string, type: 'classic' | 'modern', stats?: Partial<PlayerStats>, forceSimulated: boolean = false) {
        const isBot = forceSimulated || this.isReplayMode || id.includes('BOT_') || id.includes('RACER_') || id.includes('MBOT_') || id.startsWith('REPLAY_');
        if (!this.activeClientIds.has(id) && !isBot) return;
        let chosenX: number | null = null;
        let chosenY: number | null = null;
        const assignedTeam = stats?.team || assignDogfightTeam(this, id, isBot);

        const spawnEntities = this.level.entities
            .filter(e => e.type === 'spawn')
            .sort((a, b) => (a.props?.player || 1) - (b.props?.player || 1));

        let candidateSpots = spawnEntities.map(e => ({ x: e.x, y: e.y }));
        if (candidateSpots.length === 0) {
            candidateSpots = [{ x: 100, y: 100 }]; // Failsafe
        }

        // TODO 4: Lock each pilot/bot to the exact home base they first spawned at for the duration of the room
        const existingEnt = this.ecs.getPlayerEntity(id);
        const existingP = existingEnt !== undefined ? this.ecs.players.get(existingEnt) : undefined;
        let homeSpot = this.assignedHomes.get(id)
            || (existingP ? { x: existingP.homeSpawnX, y: existingP.homeSpawnY } : undefined)
            || (stats?.homeSpawnX !== undefined && stats?.homeSpawnY !== undefined ? { x: stats.homeSpawnX, y: stats.homeSpawnY } : undefined);

        if (!homeSpot) {
            if (this.category === 'dogfight' && candidateSpots.length >= 2) {
                homeSpot = assignedTeam === 'E3' ? candidateSpots[1] : candidateSpots[0];
            } else {
                let freeSpots = [];
                for (let pt of candidateSpots) {
                    let clear = true;
                    for (const [, p] of this.ecs.players.entries()) {
                        if (p.id !== id && Math.hypot(p.homeSpawnX - pt.x, p.homeSpawnY - pt.y) < 30) {
                            clear = false;
                        }
                    }
                    if (clear) freeSpots.push(pt);
                }
                homeSpot = freeSpots.length > 0 ? freeSpots[0] : candidateSpots[this.assignedHomes.size % candidateSpots.length];
            }
            this.assignedHomes.set(id, { x: homeSpot.x, y: homeSpot.y });
        }

        // Vary horizontal position slightly along the home pad if another living ship is currently sitting on it
        chosenX = homeSpot.x;
        chosenY = homeSpot.y;
        for (const offset of [0, -18, 18, -32, 32]) {
            const testX = homeSpot.x + offset;
            let clear = true;
            for (const [e, p] of this.ecs.players.entries()) {
                if (p.id !== id && !p.isDead) {
                    const t = this.ecs.transforms.get(e)!;
                    if (Math.hypot(t.x - testX, t.y - homeSpot.y) < 24) {
                        clear = false;
                        break;
                    }
                }
            }
            if (clear) {
                chosenX = testX;
                break;
            }
        }

        if (chosenX !== null) {
            let spawnStats = stats ? { ...stats } : undefined;
            let oldBotState: any = undefined;
            let wasRespawn = false;
            const existing = this.ecs.getPlayerEntity(id);
            if (existing !== undefined) {
                const oldP = this.ecs.players.get(existing);
                const oldW = this.ecs.weaponMounts.get(existing);
                const oldF = this.ecs.fuelTanks.get(existing);
                oldBotState = this.ecs.bots.get(existing);
                if (oldP) {
                    wasRespawn = oldP.isDead && (!stats || stats.lives === undefined);
                    spawnStats = {
                        score: stats?.score ?? oldP.score,
                        race: stats ? stats.race : oldP.race,
                        uuid: stats?.uuid ?? oldP.uuid,
                        alias: stats?.alias ?? oldP.alias,
                        isBot: stats?.isBot ?? oldP.isBotPilot,
                        joinedAt: stats?.joinedAt ?? oldP.joinedAt,
                        joinedAtTick: stats?.joinedAtTick ?? oldP.joinedAtTick,
                        shotsFired: stats?.shotsFired ?? (oldW?.shotsFired || 0),
                        fuelConsumed: stats?.fuelConsumed ?? (oldF?.consumed || 0),
                        lives: stats?.lives ?? oldP.lives,
                        streakStartLevel: stats?.streakStartLevel ?? oldP.streakStartLevel,
                        homeSpawnX: homeSpot.x,
                        homeSpawnY: homeSpot.y,
                        team: oldP.team || assignedTeam
                    };
                }
                this.ecs.destroy(existing);
            } else if (spawnStats) {
                if (spawnStats.streakStartLevel === undefined) spawnStats.streakStartLevel = this.levelIndex;
                spawnStats.homeSpawnX = homeSpot.x;
                spawnStats.homeSpawnY = homeSpot.y;
                spawnStats.team = assignedTeam;
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
                    if (existingP) {
                        p.kills = existingP.kills || 0;
                        p.deaths = existingP.deaths || 0;
                        p.unforcedErrors = existingP.unforcedErrors || 0;
                    }
                    p.isLanded = true;
                    const v = this.ecs.velocities.get(playerEntity);
                    if (v) {
                        v.vx = 0;
                        v.vy = 0;
                        v.angularVelocity = 0;
                    }
                    if (!this.isReplayMode) {
                        this.tracker.initPlayer(id, p.uuid, p.alias, {
                            shipType: p.type,
                            team: p.team,
                            homeSpawnX: p.homeSpawnX,
                            homeSpawnY: p.homeSpawnY,
                            isBot: this.ecs.bots.has(playerEntity) || Boolean(p.isBotPilot),
                            joinedAtTick: p.joinedAtTick
                        });
                    }
                    if (wasRespawn) {
                        this.ecs.events.push({
                            type: 'floating_text',
                            text: `-1 LIFE (${p.lives} LEFT)`,
                            color: '#e74c3c',
                            x: chosenX,
                            y: chosenY! - 36
                        });
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
        this.io.to(this.channel).emit('tile_update', { x, y, tile });
        botPathWorker.notifyTileUpdate(this.roomId, x, y, tile);
    }

    broadcastFloraBurn(idx: number, originT: number) {
        this.io.to(this.channel).emit('flora_burn', { idx, originT });
    }

    emitToPlayer(id: string, event: string, ...args: any[]) {
        this.io.to(id).emit(event, ...args);
    }

    private destroyAllEntities() {
        for (const [e] of Array.from(this.ecs.turrets.entries())) this.ecs.destroy(e);
        for (const [e] of Array.from(this.ecs.tanks.entries())) this.ecs.destroy(e);
        for (const [e] of Array.from(this.ecs.flyingEnemies.entries())) this.ecs.destroy(e);
        for (const [e] of Array.from(this.ecs.cargos.entries())) this.ecs.destroy(e);
        for (const [e] of Array.from(this.ecs.powerups.entries())) this.ecs.destroy(e);
        for (const [e] of Array.from(this.ecs.bots.entries())) this.ecs.destroy(e);
        for (const [e] of Array.from(this.ecs.bullets.entries())) this.ecs.destroy(e);
        for (const [e] of Array.from(this.ecs.homingMissiles.entries())) this.ecs.destroy(e);
        for (const [e] of Array.from(this.ecs.players.entries())) this.ecs.destroy(e);
        botPathWorker.removeRoom(this.roomId);
    }

    resetLevel(keepTeamsAndBots: boolean = false) {
        if (this.isReplayMode) return;
        if (this.gameOverResetTimer) {
            clearTimeout(this.gameOverResetTimer);
            this.gameOverResetTimer = null;
        }
        const savedBots: { id: string; type: 'classic' | 'modern'; stats: Partial<PlayerStats>; botState: any }[] = [];
        if (keepTeamsAndBots) {
            for (const [be, bState] of this.ecs.bots.entries()) {
                const bp = this.ecs.players.get(be);
                if (bp) {
                    savedBots.push({
                        id: bp.id,
                        type: bp.type,
                        stats: {
                            score: 0,
                            uuid: bp.uuid,
                            alias: bp.alias,
                            isBot: true,
                            shipType: bp.type,
                            lives: SERVER_CONFIG.defaultLives,
                            team: bp.team,
                            homeSpawnX: bp.homeSpawnX,
                            homeSpawnY: bp.homeSpawnY
                        },
                        botState: {
                            ...bState,
                            state: 'takeoff',
                            stateTimer: 20,
                            path: [],
                            pathTimer: 0,
                            pathPending: false
                        }
                    });
                }
            }
        }
        this.tracker.finishAndSave();
        this.tracker = new GameTracker(this.levelIndex, this.category, this.getRoomMode(), this.getPhysicsHash(), SERVER_CONFIG.debugMode);
        this.seed = Date.now();
        this.prng = createPRNG(this.seed);
        this.tracker['entry'].replayData.seed = this.seed;
        this.globalWaveTimer = 0;
        this.lastInputMasks.clear();
        this.floraBurns.clear();
        this.floraHeat.clear();
        if (!keepTeamsAndBots) {
            this.assignedHomes.clear();
        }
        this.dogfightCompleted = false;
        if (this.initialRawMap) {
            this.level.rawMap = JSON.parse(JSON.stringify(this.initialRawMap));
        }
        for (const [e] of Array.from(this.ecs.turrets.entries())) this.ecs.destroy(e);
        for (const [e] of Array.from(this.ecs.tanks.entries())) this.ecs.destroy(e);
        for (const [e] of Array.from(this.ecs.flyingEnemies.entries())) this.ecs.destroy(e);
        for (const [e] of Array.from(this.ecs.cargos.entries())) this.ecs.destroy(e);
        for (const [e] of Array.from(this.ecs.powerups.entries())) this.ecs.destroy(e);
        for (const [e] of Array.from(this.ecs.bots.entries())) {
            this.ecs.destroy(e);
        }
        for (const [e] of Array.from(this.ecs.bullets.entries())) this.ecs.destroy(e);
        for (const [e] of Array.from(this.ecs.homingMissiles.entries())) this.ecs.destroy(e);
        this.spawnEntities();
        if (keepTeamsAndBots && savedBots.length > 0) {
            for (const sb of savedBots) {
                this.trySpawnPlayer(sb.id, sb.type, { ...sb.stats, joinedAtTick: 0 }, true);
                const newEnt = this.ecs.getPlayerEntity(sb.id);
                if (newEnt !== undefined) {
                    this.ecs.bots.set(newEnt, sb.botState);
                }
            }
        }
        this.syncRoomRulesComponent();
        botPathWorker.syncLevel(this.roomId, this.level, true);
        this.io.to(this.channel).emit('initLevel', this.level);
        this.io.to(this.channel).emit('room_rules', this.ecs.roomRules);
        this.io.to(this.channel).emit('flora_burn_reset');
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
