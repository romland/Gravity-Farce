import type { Point } from './types';
import { lineIntersect } from './math';
import type { Room } from './Room';
import type { BasePlayer } from './BasePlayer';

export abstract class Entity {
    public isDestroyed: boolean = false;
    constructor(public x: number, public y: number, public vx: number, public vy: number) {}
    abstract update(room: Room): void;
    abstract serialize(): any;
}

export class Bullet extends Entity {
    public life = 400;
    constructor(x: number, y: number, vx: number, vy: number, public isPlayer: boolean, public ownerId: string) {
        super(x, y, vx, vy);
    }
    
    update(room: Room) {
        const ox = this.x; const oy = this.y;
        this.x += this.vx; this.y += this.vy; this.life--;
        
        let hit = false;
        const checkWalls = (walls: Point[]) => {
            for (let j = 0; j < walls.length - 1; j++) {
                if (lineIntersect(ox, oy, this.x, this.y, walls[j].x, walls[j].y, walls[j+1].x, walls[j+1].y)) hit = true;
            }
        };
        checkWalls(room.level.floor); checkWalls(room.level.ceiling);

        for (let p of room.players.values()) {
            if (p.isDead) continue;
            if (Math.hypot(this.x - p.x, this.y - p.y) < 16) {
                if (this.ownerId !== p.id || this.life < 390) { hit = true; p.kill(); }
            }
        }
        
        if (this.isPlayer) {
            for (let t of room.turrets) {
                if (t.active && this.x > t.x - 15 && this.x < t.x + 15 && this.y > t.y - 15 && this.y < t.y + 15) {
                    hit = true; t.hp--; if (t.hp <= 0) t.active = false;
                }
            }
        }
        if (this.life <= 0 || hit) this.isDestroyed = true;
    }
    serialize() { return { x: this.x, y: this.y, isPlayer: this.isPlayer }; }
}

export class Turret extends Entity {
    public angle: number; public hp = 3; public active = true; public cooldown = 0;
    constructor(x: number, y: number, public orientUp: boolean) {
        super(x, y, 0, 0);
        this.angle = orientUp ? -Math.PI/2 : Math.PI/2;
    }

    update(room: Room) {
        if (!this.active) return;
        let target: BasePlayer | null = null; let minDist = 800;
        
        for (let p of room.players.values()) {
            if (p.isDead) continue;
            let d = Math.hypot(p.x - this.x, p.y - this.y);
            if (d < minDist) { minDist = d; target = p; }
        }
        
        if (target) {
            let diff = Math.atan2(target.y - this.y, target.x - this.x) - this.angle;
            while (diff < -Math.PI) diff += Math.PI * 2; while (diff > Math.PI) diff -= Math.PI * 2;
            this.angle += Math.sign(diff) * 0.02;

            if (this.cooldown > 0) this.cooldown--;
            if (this.cooldown <= 0 && Math.abs(diff) < 0.5) {
                const b = new Bullet(this.x + Math.cos(this.angle)*20, this.y + Math.sin(this.angle)*20, Math.cos(this.angle)*6, Math.sin(this.angle)*6, false, 'npc');
                b.life = 90; 
                room.bullets.push(b);
                this.cooldown = 90;
            }
        }
    }
    serialize() { return { x: this.x, y: this.y, angle: this.angle, orientUp: this.orientUp, active: this.active }; }
}