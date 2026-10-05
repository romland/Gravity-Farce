import { Server } from 'socket.io';
import { LevelData } from './types';
import { Player, Turret, Bullet } from './entities';

export class Room {
    public players = new Map<string, Player>();
    public turrets: Turret[] = [];
    public bullets: Bullet[] = [];

    constructor(public levelIndex: number, public level: LevelData, private io: Server, private transitionCb: (p: Player) => void) {
        this.turrets = level.turrets.map(t => new Turret(t.x, t.y, t.orientUp));
    }

    tick() {
        if (this.players.size === 0) return;

        // Update Entities
        this.turrets.forEach(t => t.update(this));
        this.players.forEach(p => {
            if (p.respawnRequest) { p.respawnRequest = false; this.trySpawnPlayer(p); }
            p.update(this);
        });
        
        for (let i = this.bullets.length - 1; i >= 0; i--) {
            this.bullets[i].update(this);
            if (this.bullets[i].isDestroyed) this.bullets.splice(i, 1);
        }

        // Broadcast State
        const state = {
            players: Object.fromEntries(Array.from(this.players.entries()).map(([id, p]) => [id, p.serialize()])),
            turrets: this.turrets.map(t => t.serialize()),
            bullets: this.bullets.map(b => b.serialize())
        };
        this.io.to(`level_${this.levelIndex}`).emit('state', state);
    }

    trySpawnPlayer(p: Player) {
        const spawnY = this.level.startPad.y - 20;
        const padW = this.level.startPad.w;
        const spots = [this.level.startPad.x + 25, this.level.startPad.x + padW - 25, this.level.startPad.x + padW / 2];
        
        let chosenX: number | null = null;
        for (let x of spots) {
            let clear = true;
            for (let other of this.players.values()) {
                if (other.id !== p.id && !other.isDead && Math.hypot(other.x - x, other.y - spawnY) < 30) clear = false;
            }
            if (clear) { chosenX = x; break; }
        }

        if (chosenX !== null) {
            p.x = chosenX; p.y = spawnY; p.vx = 0; p.vy = 0;
            p.angle = -Math.PI / 2; p.angularVelocity = 0;
            p.isDead = false; p.inputs = { up: false, left: false, right: false, shoot: false };
            p.shootLatch = false; p.prevShoot = false; p.gunCooldown = 0;
        } else {
            setTimeout(() => this.trySpawnPlayer(p), 500);
        }
    }

    transitionPlayer(p: Player) {
        this.transitionCb(p);
    }
}