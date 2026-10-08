import type { Inputs } from './types';

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
}

export interface Player {
    id: string;
    uuid: string;
    alias: string;
    type: 'classic' | 'modern';
    isDead: boolean;
    inputs: Inputs;
    shootLatch: boolean;
    prevShoot: boolean;
    gunCooldown: number;
    respawnRequest: boolean;
    angleAcc: number;
    angleStep: number;
    isLanded: boolean;
    score: number;
    joinedAt: number;
    cargoStack: number[];
    unloadTimer: number;
    doubleShotAmmo: number;
    fuel: number;
    shotsFired: number;
    spawnX: number;
    spawnY: number;
    advancing?: boolean;
    race?: PlayerRaceState;
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
}

export interface FlyingEnemy {
    active: boolean;
    hp: number;
    debugId: number;
    enemyType: number;
    scoreValue: number;
    directionState: number; // Offset +$02
    maneuverStep: number;   // Offset +$1A (24-frame blindfold timer)
    canShoot: boolean;
    width: number;
    height: number;
    fireTimer: number;
    burstRemaining: number;
    startX: number;
    startY: number;
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
    }

    getPlayerEntity(id: string): Entity | undefined {
        for (const [e, p] of this.players.entries()) {
            if (p.id === id) return e;
        }
        return undefined;
    }
}
