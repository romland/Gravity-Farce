import { BasePlayer } from './BasePlayer';
import { Bullet } from './entities';
import type { Room } from './Room';
import { lineIntersect, normalizeAngle } from './math';

export class ModernPlayer extends BasePlayer {
    public angularVelocity = 0;
    
    private readonly GRAVITY = 0.012; 
    private readonly THRUST = 0.08;
    private readonly DRAG = 0.996; 
    private readonly MAX_VEL = 8.0;

    spawn(x: number, y: number): void {
        this.x = x; this.y = y;
        this.vx = 0; this.vy = 0;
        this.angle = -Math.PI / 2;
        this.angularVelocity = 0;
        this.isDead = false;
        this.inputs = { up: false, left: false, right: false, shoot: false };
        this.shootLatch = false;
        this.prevShoot = false;
        this.gunCooldown = 0;
    }

    update(room: Room) {
        if (this.isDead) return;

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

        if (this.gunCooldown > 0) this.gunCooldown--;
        let activeShoot = this.inputs.shoot || this.shootLatch;
        
        // Authentic arcade mechanic: fast tapping bypasses slow auto-fire
        if (activeShoot && !this.prevShoot) this.gunCooldown = 0;

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
        this.inputs = { up: false, left: false, right: false, shoot: false };
        this.shootLatch = false;
        this.prevShoot = false;
        setTimeout(() => { this.respawnRequest = true; }, 3000);
    }

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