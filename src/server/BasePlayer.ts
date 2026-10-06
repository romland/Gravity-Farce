import { Entity } from './entities';
import type { Inputs } from './types';
import type { Room } from './Room';

export abstract class BasePlayer extends Entity {
    public angle = -Math.PI / 2;
    public isDead = true; 
    public inputs: Inputs = { up: false, left: false, right: false, shoot: false };
    public shootLatch = false; 
    public prevShoot = false;
    public gunCooldown = 0;
    public respawnRequest = false;

    constructor(public id: string, public levelIndex: number) {
        super(0, 0, 0, 0);
    }

    abstract spawn(x: number, y: number): void;
    abstract kill(): void;
}
