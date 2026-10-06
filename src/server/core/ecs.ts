import type { Inputs } from './types';

export type Entity = number;

export interface Transform { x: number; y: number; angle: number; }
export interface Velocity { vx: number; vy: number; angularVelocity: number; }

export interface Player {
    id: string;
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
}

export interface Turret { active: boolean; hp: number; cooldown: number; orientUp: boolean; }
export interface Bullet { life: number; isPlayer: boolean; ownerId: string; }

export class Registry {
    private nextId = 1;
    public transforms = new Map<Entity, Transform>();
    public velocities = new Map<Entity, Velocity>();
    public players = new Map<Entity, Player>();
    public turrets = new Map<Entity, Turret>();
    public bullets = new Map<Entity, Bullet>();

    create(): Entity { 
        return this.nextId++; 
    }
    
    destroy(e: Entity) {
        this.transforms.delete(e);
        this.velocities.delete(e);
        this.players.delete(e);
        this.turrets.delete(e);
        this.bullets.delete(e);
    }

    getPlayerEntity(id: string): Entity | undefined {
        for (const [e, p] of this.players.entries()) {
            if (p.id === id) return e;
        }
        return undefined;
    }
}
