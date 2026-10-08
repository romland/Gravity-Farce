import { Registry, type Entity } from '../core/ecs';
import { killPlayer, checkPvPCollisions } from './combat';
import type { Room } from '../Room';
import { getShipPolygon, checkEnvironmentCollisions } from './player-shared';
import type { PlayerStats } from '../core/types';

const ROTATION_SPEED = 1000; 
const GRAVITY = 0.010;
const THRUST_IMPULSE = 0.070; 
const DRAG = 0.997;
const MAGNET_FORCE = THRUST_IMPULSE * 0.5; // Scaled to 50% of engine power
const MAX_SPEED = 7.5; 
const MAX_SAFE_LANDING_VY = 2.0;

export function spawnClassicPlayer(ecs: Registry, id: string, x: number, y: number, stats?: Partial<PlayerStats>): Entity {
    const e = ecs.create();
    ecs.transforms.set(e, { x, y, angle: -Math.PI / 2 });
    ecs.velocities.set(e, { vx: 0, vy: 0, angularVelocity: 0 });
    ecs.players.set(e, {
        id,
        type: 'classic',
        uuid: stats?.uuid ?? id,
        alias: stats?.alias ?? 'UNK',
        joinedAt: stats?.joinedAt ?? Date.now(),
        isDead: false,
        inputs: { up: false, left: false, right: false, shoot: false },
        shootLatch: false,
        prevShoot: false,
        gunCooldown: 0,
        respawnRequest: false,
        angleAcc: 54000,
        angleStep: 27,
        isLanded: false,
        score: stats?.score ?? 0,
        cargoStack: [],
        unloadTimer: 0,
        doubleShotAmmo: stats?.doubleShotAmmo ?? 0,
        fuel: stats?.fuel ?? 76464,
         shotsFired: stats?.shotsFired ?? 0,
        spawnX: x,
        spawnY: y,
        race: stats?.race
    });
    return e;
}

export function sysClassicPlayers(ecs: Registry, room: Room) {
    for (const [e, p] of ecs.players.entries()) {
        if (p.type !== 'classic' || p.isDead) continue;
        const t = ecs.transforms.get(e)!;
        const v = ecs.velocities.get(e)!;

         const weight = p.cargoStack.reduce((sum, id) => sum + (id === 0xD1 ? 1 : 2), 0);
         const weightGravity = GRAVITY * (1.0 + (weight * 0.40));
         const weightThrust = THRUST_IMPULSE * (1.0 - (weight * 0.15));

        if (p.isLanded) {
            v.vx = 0; 
            v.vy = 0; 
            p.angleAcc = 54000; 
            p.angleStep = 27; 
            t.angle = -Math.PI / 2;
            
            if (p.inputs.up) {
                p.isLanded = false;
                v.vy = -1.2;
            } else {
                continue;
            }
        }

        if (p.inputs.left) {
            p.angleAcc = (p.angleAcc - ROTATION_SPEED + 72000) % 72000;
        }
        if (p.inputs.right) {
            p.angleAcc = (p.angleAcc + ROTATION_SPEED) % 72000;
        }

        p.angleStep = Math.floor(p.angleAcc / 2000) % 36;
        t.angle = (p.angleStep * (Math.PI * 2)) / 36;

        if (p.inputs.up && p.fuel > 0) {
             p.fuel = Math.max(0, p.fuel - 15);
             v.vx += Math.cos(t.angle) * weightThrust;
             v.vy += Math.sin(t.angle) * weightThrust;
        }
        
        // Gravity Wells / Magnets (0xCC - 0xCF)
        if (room.level && room.level.rawMap) {
            const tileX = Math.floor(t.x / 32);
            const tileY = Math.floor(t.y / 32);
            const tileId = room.level.rawMap[tileY]?.[tileX];
            
            if (tileId !== undefined) {
                if (tileId === 0xCC) v.vx += MAGNET_FORCE; // Right (Dir 01)
                if (tileId === 0xCD) v.vy += MAGNET_FORCE; // Down  (Dir 01)
                if (tileId === 0xCE) v.vx -= MAGNET_FORCE; // Left  (Dir 00)
                if (tileId === 0xCF) v.vy -= MAGNET_FORCE; // Up    (Dir 00)
            }
        }

        v.vx *= DRAG; 
        v.vy *= DRAG; 
         v.vy += weightGravity;
        
        const speed = Math.hypot(v.vx, v.vy);
        if (speed > MAX_SPEED) { 
            v.vx = (v.vx / speed) * MAX_SPEED; 
            v.vy = (v.vy / speed) * MAX_SPEED; 
        }
        
        t.x += v.vx; 
        t.y += v.vy;

        let advancing = false;
        const sl = getShipPolygon(t.x, t.y, t.angle, 14, 14);

        const isAngleUpright = Math.abs(p.angleStep - 27) <= 1; // 52 to 56 Amiga angle gate
        const canLand = () => v.vy >= 0 && v.vy <= MAX_SAFE_LANDING_VY && isAngleUpright;

        const land = (targetY: number) => { 
            p.isLanded = true; 
            t.y = targetY; 
            v.vy = 0; 
            v.vx = 0; 
            p.angleAcc = 54000; 
            p.angleStep = 27; 
            t.angle = -Math.PI / 2; 
        };

        const crashed = checkEnvironmentCollisions(sl, t.x, t.y, room.level, canLand, (landY, isEndPad) => {
            land(landY);
            if (isEndPad && !p.inputs.up && room.initialCargoCount === 0 && room.category === 'mission') {
                if (!p.advancing) {
                    p.advancing = true;
                    advancing = true; 
                    ecs.events.push({ type: 'floating_text', text: 'CAVERN SECURED', color: '#4facfe', x: t.x, y: t.y - 60 });
                    setTimeout(() => room.transitionPlayer(p.id), 3000);
                }
            }
        });

        if (crashed && !advancing) {
            killPlayer(ecs, e);
        }
    }
}
