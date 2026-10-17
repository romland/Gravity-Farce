import type { Inputs, BotState } from './types';

export type Entity = number;

export interface Transform {
    x: number;
    y: number;
    angle: number;
}

export interface Velocity {
    vx: number;
    vy: number;
    angularVelocity: number;
}

export interface GameEvent {
    type: string;
    x: number;
    y: number;
    soundId?: number;
    text?: string;
    color?: string;
    vx?: number;
    vy?: number;
}

export interface PlayerRaceState {
    state: number; // 0 = Waiting, 1 = Racing, 2 = Finished
    nextCheckpoint: number; // 1-8
    currentLap: number;
    totalLaps: number;
    startTime: number;
    finishTime?: number;
    lapTimes: number[];
    currentLapSplits?: Record<number, number>;
    bestLapResult?: { value: number; rank: number; isNewPb: boolean; timestamp: number };
    bestFlyingResult?: { value: number; rank: number; isNewPb: boolean; timestamp: number };
}

export interface Player {
    id: string;
    uuid: string;
    alias: string;
    isBotPilot?: boolean;
    type: 'classic' | 'modern';
    isDead: boolean;
    inputs: Inputs;
    respawnRequest: boolean;
    respawnTimer?: number;
    angleAcc: number;
    angleStep: number;
    isLanded: boolean;
    score: number;
    joinedAt: number;
    joinedAtTick: number;
    spawnX: number;
    spawnY: number;
    homeSpawnX: number;
    homeSpawnY: number;
    levelStartScore: number;
    streakStartLevel: number;
    advancing?: boolean;
    race?: PlayerRaceState;
    lives: number;
    ping: number;
    team?: 'E2' | 'E3';
    kills: number;
    deaths: number;
    unforcedErrors: number;
    lastDamagedBy?: { attackerId: string; tick: number };
}

export interface FuelTank {
    current: number;
    max: number;
    consumed: number;
}

export interface CargoBay {
    stack: number[];
    unloadTimer: number;
    maxWeight: number;
}

export interface WeaponMount {
    baseCooldown: number;
    cooldown: number;
    activeModeId: number;
    charges: number;
    shotsFired: number;
    shootLatch: boolean;
    prevShoot: boolean;
    triggerReleased?: boolean;
}

export interface Turret {
    active: boolean;
    hp: number;
    hpMax: number;
    cooldown: number;
    turretType: number;
    orientUp: boolean;
    triggerId?: number;
    tileX: number;
    tileY: number;
    width: number;
    height: number;
    damageHistory: Record<string, number>;
}

export interface Tank {
    active: boolean;
    hp: number;
    debugId: number;
    moveTimer: number;
    dirX: number;
    dirY: number;
    scoreValue: number;
    width: number;
    height: number;
    damageHistory: Record<string, number>;
}

export interface FlyingEnemy {
    active: boolean;
    hp: number;
    debugId: number;
    enemyType: number;
    scoreValue: number;
    canShoot: boolean;
    spawnsDebris: boolean;
    width: number;
    height: number;
    fireTimer: number;
    burstRemaining: number;
    startX: number;
    startY: number;
    damageHistory: Record<string, number>;
    lastDx?: number;
    lastDy?: number;
    outOfBoundsLogged?: boolean;
    segmentId?: string;
    pointIndex?: number;
}

export interface HomingMissile {
    active: boolean;
    x: number;
    y: number;
    vx: number;
    vy: number;
    targetId?: string;
}

export interface Bullet {
    life: number;
    isPlayer: boolean;
    ownerId: string;
}

export interface Cargo {
    active: boolean;
    typeId: number;
    weight: number;
    scoreValue: number;
    width: number;
    height: number;
    tileX: number;
    tileY: number;
    heldBy?: string;
}

export interface Powerup {
    active: boolean;
    typeId: number;
    charges: number;
    width: number;
    height: number;
}

export interface RoomRulesComponent {
    discipline: 'mission' | 'race' | 'dogfight';
    flavor: string;
    objectiveText: string;
    customCounters?: Record<string, string | number>;
}

export class Registry {
    private nextId = 1;
    public transforms = new Map<Entity, Transform>();
    public velocities = new Map<Entity, Velocity>();
    public players = new Map<Entity, Player>();
    public turrets = new Map<Entity, Turret>();
    public tanks = new Map<Entity, Tank>();
    public flyingEnemies = new Map<Entity, FlyingEnemy>();
    public homingMissiles = new Map<Entity, HomingMissile>();
    public cargos = new Map<Entity, Cargo>();
    public powerups = new Map<Entity, Powerup>();
    public bullets = new Map<Entity, Bullet>();
    public fuelTanks = new Map<Entity, FuelTank>();
    public cargoBays = new Map<Entity, CargoBay>();
    public weaponMounts = new Map<Entity, WeaponMount>();
    public bots = new Map<Entity, BotState>();
    public roomRules: RoomRulesComponent = {
        discipline: 'mission',
        flavor: 'STANDARD',
        objectiveText: 'SECURE ALL CARGO',
        customCounters: {}
    };
    public events: GameEvent[] = [];

    create(): Entity { 
        return this.nextId++; 
    }
    
    destroy(e: Entity) {
        this.transforms.delete(e);
        this.velocities.delete(e);
        this.players.delete(e);
        this.turrets.delete(e);
        this.tanks.delete(e);
        this.flyingEnemies.delete(e);
        this.homingMissiles.delete(e);
        this.bullets.delete(e);
        this.cargos.delete(e);
        this.powerups.delete(e);
        this.fuelTanks.delete(e);
        this.cargoBays.delete(e);
        this.weaponMounts.delete(e);
        this.bots.delete(e);
    }

    getPlayerEntity(id: string): Entity | undefined {
        for (const [e, p] of this.players.entries()) {
            if (p.id === id) return e;
        }
        return undefined;
    }
}
