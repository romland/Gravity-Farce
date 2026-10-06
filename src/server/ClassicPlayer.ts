import { BasePlayer } from './BasePlayer';
import { Bullet } from './entities';
import type { Room } from './Room';
import { lineIntersect } from './math';

export class ClassicPlayer extends BasePlayer {
    public angleAcc: number = 54000;
    public angleStep: number = 27;
    public isLanded: boolean = false;

    private readonly ROTATION_SPEED: number = 500;
    private readonly GRAVITY: number = 0.008;
    private readonly THRUST_IMPULSE: number = 0.065;
    private readonly DRAG: number = 0.997;
    private readonly MAX_SPEED: number = 4.0;
    private readonly MAX_SAFE_LANDING_VY: number = 1.4;

    spawn(x: number, y: number): void {
        this.x = x; this.y = y;
        this.vx = 0; this.vy = 0;
        this.angle = -Math.PI / 2;
        this.angleAcc = 54000;
        this.angleStep = 27;
        this.isLanded = false;
        this.isDead = false;
        this.inputs = { up: false, left: false, right: false, shoot: false };
        this.shootLatch = false;
        this.prevShoot = false;
        this.gunCooldown = 0;
    }

    update(room: Room) {
        if (this.isDead) return;

        if (this.isLanded) {
            this.vx = 0; this.vy = 0;
            this.angleAcc = 54000;
            this.angleStep = 27;
            this.angle = -Math.PI / 2;

            if (this.inputs.up) {
                this.isLanded = false; 
            } else {
                this.handleWeapons(room);
                return;
            }
        }

        if (this.inputs.left) this.angleAcc = (this.angleAcc - this.ROTATION_SPEED + 72000) % 72000;
        if (this.inputs.right) this.angleAcc = (this.angleAcc + this.ROTATION_SPEED) % 72000;

        this.angleStep = Math.floor(this.angleAcc / 2000) % 36;
        this.angle = (this.angleStep * (Math.PI * 2)) / 36;

        if (this.inputs.up) {
            this.vx += Math.cos(this.angle) * this.THRUST_IMPULSE;
            this.vy += Math.sin(this.angle) * this.THRUST_IMPULSE;
        }

        this.vx *= this.DRAG;
        this.vy *= this.DRAG;
        this.vy += this.GRAVITY;

        const speed = Math.hypot(this.vx, this.vy);
        if (speed > this.MAX_SPEED) {
            this.vx = (this.vx / speed) * this.MAX_SPEED;
            this.vy = (this.vy / speed) * this.MAX_SPEED;
        }

        this.x += this.vx; this.y += this.vy;

        this.handleWeapons(room);
        this.checkCollisions(room);
    }

    private handleWeapons(room: Room) {
        if (this.gunCooldown > 0) this.gunCooldown--;
        let activeShoot = this.inputs.shoot || this.shootLatch;
        
        // Authentic arcade mechanic: fast tapping bypasses slow auto-fire
        if (activeShoot && !this.prevShoot) this.gunCooldown = 0;

        if (activeShoot && this.gunCooldown <= 0) {
            room.bullets.push(
                new Bullet(
                    this.x + Math.cos(this.angle) * 14, 
                    this.y + Math.sin(this.angle) * 14, 
                    this.vx + Math.cos(this.angle) * 5.0, 
                    this.vy + Math.sin(this.angle) * 5.0, 
                    true, 
                    this.id
                )
            );
            this.gunCooldown = 10;
        }
        this.prevShoot = activeShoot;
        this.shootLatch = false;
    }

    private checkCollisions(room: Room) {
        let crashed = false; let advancing = false;
        const sl = this.getCollisionLines();

        const isAngleUpright = Math.abs(this.angleStep - 27) <= 2;

        for (let i = 0; i < room.level.floor.length - 1; i++) {
            const p1 = room.level.floor[i]; const p2 = room.level.floor[i + 1];
            const isFlat = Math.abs(p1.y - p2.y) < 1.0;

            for (let line of sl) {
                if (lineIntersect(line[0].x, line[0].y, line[1].x, line[1].y, p1.x, p1.y, p2.x, p2.y)) {
                    if (isFlat && this.vy <= this.MAX_SAFE_LANDING_VY && isAngleUpright) {
                        if (this.vy >= 0 && this.y >= p1.y - 12) {
                            this.landOnSurface(p1.y - 12);
                        }
                    } else {
                        crashed = true;
                    }
                }
            }
        }

        for (let i = 0; i < room.level.ceiling.length - 1; i++) {
            for (let line of sl) {
                if (lineIntersect(line[0].x, line[0].y, line[1].x, line[1].y, room.level.ceiling[i].x, room.level.ceiling[i].y, room.level.ceiling[i + 1].x, room.level.ceiling[i + 1].y)) crashed = true;
            }
        }

        for (let other of room.players.values()) {
            if (other.id !== this.id && !other.isDead && Math.hypot(this.x - other.x, this.y - other.y) < 18) {
                crashed = true; other.kill();
            }
        }

        const checkPad = (pad: { x: number; y: number; w: number }, isEndPad: boolean) => {
            if (this.x > pad.x - 10 && this.x < pad.x + pad.w + 10 && this.y > pad.y - 30 && this.y < pad.y + 10) {
                if (this.vy <= this.MAX_SAFE_LANDING_VY && isAngleUpright) {
                    crashed = false;
                    if (this.vy >= 0 && this.y >= pad.y - 12) {
                        this.landOnSurface(pad.y - 12);
                        if (isEndPad && !this.inputs.up) {
                            advancing = true;
                            room.transitionPlayer(this);
                        }
                    }
                } else if (this.y > pad.y) {
                    crashed = true;
                }
            }
        };

        checkPad(room.level.startPad, false);
        checkPad(room.level.endPad, true);

        if (crashed && !advancing) this.kill();
    }

    private landOnSurface(targetY: number) {
        this.isLanded = true;
        this.y = targetY;
        this.vy = 0; this.vx = 0;
        this.angleAcc = 54000;
        this.angleStep = 27;
        this.angle = -Math.PI / 2;
    }

    public kill() {
        if (this.isDead) return;
        this.isDead = true;
        this.isLanded = false;
        this.vx = 0; this.vy = 0;
        this.inputs = { up: false, left: false, right: false, shoot: false };
        this.shootLatch = false;
        this.prevShoot = false;
        setTimeout(() => { this.respawnRequest = true; }, 3000);
    }

    private getCollisionLines() {
        const cos = Math.cos(this.angle), sin = Math.sin(this.angle), w = 14, h = 14;
        const nose = { x: this.x + cos * w, y: this.y + sin * h };
        const leftWing = { x: this.x - cos * w - sin * (w * 0.7), y: this.y - sin * h + cos * (w * 0.7) };
        const rightWing = { x: this.x - cos * w + sin * (w * 0.7), y: this.y - sin * h - cos * (w * 0.7) };
        const engine = { x: this.x - cos * (w * 0.5), y: this.y - sin * (h * 0.5) };
        return [[nose, rightWing], [rightWing, engine], [engine, leftWing], [leftWing, nose]];
    }

    serialize() {
        return { 
            x: this.x, y: this.y, vx: this.vx, vy: this.vy, 
            angle: this.angle, angleStep: this.angleStep, 
            isLanded: this.isLanded, isDead: this.isDead, inputs: this.inputs 
        };
    }
}