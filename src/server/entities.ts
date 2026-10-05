import { Inputs, Point } from './types';
import { lineIntersect, normalizeAngle } from './math';
import { Room } from './Room';

export abstract class Entity {
    constructor(public x: number, public y: number, public vx: number, public vy: number) {}
    public isDestroyed: boolean = false;
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
        let target: Player | null = null; let minDist = 800;
        
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
                b.life = 90; // Override default life so turrets don't shoot across the entire map
                room.bullets.push(b);
                this.cooldown = 90;
            }
        }
    }
    serialize() { return { x: this.x, y: this.y, angle: this.angle, orientUp: this.orientUp, active: this.active }; }
}

export class Player extends Entity {
    public angle = -Math.PI / 2; public angularVelocity = 0;
    public gunCooldown = 0; public isDead = true; 
    public inputs: Inputs = { up: false, left: false, right: false, shoot: false };
    public shootLatch = false; public prevShoot = false;
    
    // Physics Config
    private readonly GRAVITY = 0.012; private readonly THRUST = 0.08;
    private readonly DRAG = 0.996; private readonly MAX_VEL = 8.0;
    
    constructor(public id: string, public levelIndex: number) { super(0, 0, 0, 0); }

    update(room: Room) {
        if (this.isDead) return;

        // Thrust & Gravity
        if (this.inputs.left) this.angularVelocity -= 0.004;
        if (this.inputs.right) this.angularVelocity += 0.004;
        this.angularVelocity *= 0.93; this.angle += this.angularVelocity;

        if (this.inputs.up) {
            this.vx += Math.cos(this.angle) * this.THRUST;
            this.vy += Math.sin(this.angle) * this.THRUST;
        }

        this.vy += this.GRAVITY;
        this.vx *= this.DRAG; this.vy *= this.DRAG;

        const speed = Math.hypot(this.vx, this.vy);
        if (speed > this.MAX_VEL) { this.vx = (this.vx / speed) * this.MAX_VEL; this.vy = (this.vy / speed) * this.MAX_VEL; }

        this.x += this.vx; this.y += this.vy;

        // Weapons
        if (this.gunCooldown > 0) this.gunCooldown--;
        let activeShoot = this.inputs.shoot || this.shootLatch;
        if (activeShoot && !this.prevShoot) this.gunCooldown = 0; // Rapid fire bypass
        if (activeShoot && this.gunCooldown <= 0) {
            room.bullets.push(new Bullet(this.x + Math.cos(this.angle)*16, this.y + Math.sin(this.angle)*16, this.vx + Math.cos(this.angle)*3, this.vy + Math.sin(this.angle)*3, true, this.id));
            this.gunCooldown = 15;
        }
        this.prevShoot = activeShoot; this.shootLatch = false;

        this.checkCollisions(room, speed);
    }

    private checkCollisions(room: Room, speed: number) {
        let crashed = false; let advancing = false;
        const sl = this.getCollisionLines();

        // Floor
        for (let i = 0; i < room.level.floor.length - 1; i++) {
            const p1 = room.level.floor[i]; const p2 = room.level.floor[i+1];
            const isFlat = Math.abs(p1.y - p2.y) < 1.0;
            for (let line of sl) {
                if (lineIntersect(line[0].x, line[0].y, line[1].x, line[1].y, p1.x, p1.y, p2.x, p2.y)) {
                    let diff = normalizeAngle(this.angle);
                    if (isFlat && speed < 2.5 && Math.abs(diff) < 0.25) {
                        if (this.vy >= 0) { this.y = p1.y - 12; this.vy = 0; this.vx = 0; this.angle += diff * 0.25; this.angularVelocity = 0; }
                    } else { crashed = true; }
                }
            }
        }
        
        // Ceiling & PvP
        for (let i = 0; i < room.level.ceiling.length - 1; i++) {
            for (let line of sl) {
                if (lineIntersect(line[0].x, line[0].y, line[1].x, line[1].y, room.level.ceiling[i].x, room.level.ceiling[i].y, room.level.ceiling[i+1].x, room.level.ceiling[i+1].y)) crashed = true;
            }
        }
        for (let other of room.players.values()) {
            if (other.id !== this.id && !other.isDead && Math.hypot(this.x - other.x, this.y - other.y) < 20) {
                crashed = true; other.kill(); 
            }
        }

        // Pads
        const sPad = room.level.startPad;
        if (this.x > sPad.x - 10 && this.x < sPad.x + sPad.w + 10 && this.y > sPad.y - 30 && this.y < sPad.y + 10) {
            let diff = normalizeAngle(this.angle);
            if (speed < 2.5 && Math.abs(diff) < 0.25) {
                crashed = false;
                if (this.vy >= 0 && this.y >= sPad.y - 12) { this.y = sPad.y - 12; this.vy = 0; this.vx = 0; this.angle += diff * 0.25; this.angularVelocity = 0; }
            } else if (this.y > sPad.y) crashed = true;
        }

        const ePad = room.level.endPad;
        if (this.x > ePad.x - 10 && this.x < ePad.x + ePad.w + 10 && this.y > ePad.y - 30 && this.y < ePad.y + 10) {
            let diff = normalizeAngle(this.angle);
            if (speed < 2.5 && Math.abs(diff) < 0.25) {
                crashed = false;
                if (this.vy >= 0 && this.y >= ePad.y - 12) {
                    this.y = ePad.y - 12; this.vy = 0; this.vx = 0; this.angle += diff * 0.25; this.angularVelocity = 0;
                    if (!this.inputs.up) { advancing = true; room.transitionPlayer(this); }
                }
            } else if (this.y > ePad.y) crashed = true;
        }

        if (crashed && !advancing) this.kill();
    }

    public kill() {
        if (this.isDead) return;
        this.isDead = true;
        setTimeout(() => { 
            // In a real DI setup, emit an event. Here we rely on Room catching the dead state to respawn.
            this.respawnRequest = true; 
        }, 3000);
    }
    public respawnRequest = false;

    private getCollisionLines() {
        const cos = Math.cos(this.angle), sin = Math.sin(this.angle), w = 16, h = 16;
        const nose = { x: this.x + cos * w, y: this.y + sin * h };
        const leftWing = { x: this.x - cos * w - sin * (w*0.7), y: this.y - sin * h + cos * (w*0.7) };
        const rightWing = { x: this.x - cos * w + sin * (w*0.7), y: this.y - sin * h - cos * (w*0.7) };
        const engine = { x: this.x - cos * (w*0.5), y: this.y - sin * (h*0.5) };
        return [[nose, rightWing], [rightWing, engine], [engine, leftWing], [leftWing, nose]];
    }

    serialize() { 
        return { x: this.x, y: this.y, vx: this.vx, vy: this.vy, angle: this.angle, isDead: this.isDead, inputs: this.inputs }; 
    }
}
