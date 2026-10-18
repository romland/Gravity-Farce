import { Registry, type Entity } from '../core/ecs';
import { killPlayer, checkPvPCollisions } from './combat';
import { scaleAmigaPerFrameDelta, scaleAmigaDrag, scaleAmigaFrameTimer } from '../core/math';
import type { Room } from '../Room';
import { getShipPolygon, checkEnvironmentCollisions } from './player-shared';
import type { PlayerStats } from '../core/types';
import { SERVER_CONFIG } from '../core/config';

// Preserved previous Classic player feel as Modern player for A/B comparison.
// Scaled via math.ts helpers so 60Hz, 90Hz, and 144Hz servers maintain identical feel.
const MODERN_ROTATION_SPEED = scaleAmigaPerFrameDelta(1000 * (60 / 50));
const MODERN_GRAVITY = scaleAmigaPerFrameDelta(0.010 * (60 / 50));
const MODERN_THRUST_IMPULSE = scaleAmigaPerFrameDelta(0.070 * (60 / 50));
const MODERN_DRAG = scaleAmigaDrag(Math.pow(0.997, 60 / 50));
const MODERN_MAGNET_FORCE = MODERN_THRUST_IMPULSE * 0.5;
const MODERN_MAX_SPEED = scaleAmigaPerFrameDelta(7.5 * (60 / 50));
const MODERN_SAFE_LANDING_VY = scaleAmigaPerFrameDelta(2.0 * (60 / 50));
const MODERN_SAFE_LANDING_VX = scaleAmigaPerFrameDelta(2.0 * (60 / 50));
const MODERN_FUEL_DRAIN = scaleAmigaPerFrameDelta(15);
const MODERN_BASE_COOLDOWN = Math.round(scaleAmigaFrameTimer(6));
const MODERN_INITIAL_FUEL = 76464;
const MODERN_MAX_FUEL = 99999;

export function spawnModernPlayer(ecs: Registry, id: string, x: number, y: number, stats?: Partial<PlayerStats>): Entity {
    const e = ecs.create();
    ecs.transforms.set(e, { x, y, angle: -Math.PI / 2 });
    ecs.velocities.set(e, { vx: 0, vy: 0, angularVelocity: 0 });
    ecs.players.set(e, {
        id,
        type: 'modern',
        uuid: stats?.uuid ?? id,
        alias: stats?.alias ?? 'UNK',
        isBotPilot: stats?.isBot ?? false,
        joinedAt: stats?.joinedAt ?? Date.now(),
        joinedAtTick: stats?.joinedAtTick ?? 0,
        isDead: false,
        inputs: { up: false, left: false, right: false, shoot: false },
        respawnRequest: false,
        angleAcc: 54000,
        angleStep: 27,
        isLanded: false,
        score: stats?.score ?? 0,
        spawnX: x,
        spawnY: y,
        homeSpawnX: stats?.homeSpawnX ?? x,
        homeSpawnY: stats?.homeSpawnY ?? y,
        levelStartScore: stats?.score ?? 0,
        streakStartLevel: stats?.streakStartLevel ?? 0,
        race: stats?.race,
        lives: stats?.lives ?? 5,
        ping: 0,
        team: stats?.team,
        kills: 0,
        deaths: 0,
        unforcedErrors: 0
    });
    ecs.fuelTanks.set(e, { current: MODERN_INITIAL_FUEL, max: MODERN_MAX_FUEL, consumed: stats?.fuelConsumed ?? 0 });
    ecs.cargoBays.set(e, { stack: [], unloadTimer: 0, maxWeight: 3 });
    ecs.weaponMounts.set(e, {
        cooldown: 0,
        baseCooldown: MODERN_BASE_COOLDOWN,
        activeModeId: 0xD5,
        charges: 0,
        shotsFired: stats?.shotsFired ?? 0,
        shootLatch: false,
        prevShoot: false,
        triggerReleased: true
    });
    return e;
}

export function sysModernPlayers(ecs: Registry, room: Room) {
    for (const [e, p] of ecs.players.entries()) {
        if (p.type !== 'modern' || p.isDead) continue;
        const t = ecs.transforms.get(e)!;
        const v = ecs.velocities.get(e)!;
        if (p.advancing || room.dogfightCompleted || p.race?.state === 2) {
            v.vx = 0;
            v.vy = 0;
            v.angularVelocity = 0;
            p.inputs = { up: false, left: false, right: false, shoot: false };
            continue;
        }
        const inv = ecs.cargoBays.get(e);
        const f = ecs.fuelTanks.get(e);

        const weight = inv ? inv.stack.reduce((sum, id) => sum + (id === 0xD1 ? 1 : 2), 0) : 0;
        const weightGravity = MODERN_GRAVITY * (1.0 + (weight * 0.40));
        const weightThrust = MODERN_THRUST_IMPULSE * (1.0 - (weight * 0.15));
        const thrustScale = Math.max(p.inputs.up ? 1.0 : 0.0, p.inputs.analogUp || 0.0);

        if (p.isLanded) {
            v.vx = 0; 
            v.vy = 0; 
            v.angularVelocity = 0; 
            p.angleAcc = 54000;
            p.angleStep = 27;
            t.angle = -Math.PI / 2;
            if (thrustScale > 0.5) {
                p.isLanded = false;
                v.vy = -scaleAmigaPerFrameDelta(1.2 * (60 / 50));
            } else {
                continue;
            }
        }

        if (p.inputs.analogX) {
            const rot = Math.round(MODERN_ROTATION_SPEED * p.inputs.analogX);
            p.angleAcc = (p.angleAcc + rot + 72000) % 72000;
        } else {
            if (p.inputs.left) {
                p.angleAcc = (p.angleAcc - MODERN_ROTATION_SPEED + 72000) % 72000;
            }
            if (p.inputs.right) {
                p.angleAcc = (p.angleAcc + MODERN_ROTATION_SPEED) % 72000;
            }
        }
        p.angleStep = Math.floor(p.angleAcc / 2000) % 36;
        t.angle = (p.angleStep * (Math.PI * 2)) / 36;

        if (thrustScale > 0 && f && f.current > 0) {
             const drain = Math.min(MODERN_FUEL_DRAIN * thrustScale, f.current);
             f.current -= drain;
             f.consumed += drain;
             if (f.current <= 0 && !ecs.bots.has(e) && !room.isReplayMode) {
                 room.emitToPlayer(p.id, 'playfield_announce', { text: 'OUT OF FUEL!', color: '#ef4444' });
             }
             v.vx += Math.cos(t.angle) * weightThrust * thrustScale;
             v.vy += Math.sin(t.angle) * weightThrust * thrustScale;
        }
        
        // Gravity Wells / Magnets (0xCC - 0xCF)
        if (room.level && room.level.rawMap) {
            const tileX = Math.floor(t.x / 32);
            const tileY = Math.floor(t.y / 32);
            const tileId = room.level.rawMap[tileY]?.[tileX];
            
            if (tileId !== undefined) {
                if (tileId === 0xCC) v.vx += MODERN_MAGNET_FORCE; // Right (Dir 01)
                if (tileId === 0xCD) v.vy += MODERN_MAGNET_FORCE; // Down  (Dir 01)
                if (tileId === 0xCE) v.vx -= MODERN_MAGNET_FORCE; // Left  (Dir 00)
                if (tileId === 0xCF) v.vy -= MODERN_MAGNET_FORCE; // Up    (Dir 00)
            }
        }

        v.vx *= MODERN_DRAG; 
        if (v.vy < 0 || thrustScale > 0) {
            v.vy *= MODERN_DRAG;
        }
        v.vy += weightGravity;

        const speed = Math.hypot(v.vx, v.vy);
        if (speed > MODERN_MAX_SPEED) { 
            v.vx = (v.vx / speed) * MODERN_MAX_SPEED; 
            v.vy = (v.vy / speed) * MODERN_MAX_SPEED; 
        }

        t.x += v.vx; 
        t.y += v.vy;

        const sl = getShipPolygon(t.x, t.y, t.angle, 16);
        const isAngleUpright = Math.abs(p.angleStep - 27) <= 1;
        const canLand = () => v.vy >= 0 && v.vy <= MODERN_SAFE_LANDING_VY && Math.abs(v.vx) <= MODERN_SAFE_LANDING_VX && isAngleUpright;

        const crashed = checkEnvironmentCollisions(sl, t.x, t.y, room.level, canLand, (landY, isEndPad) => {
            p.isLanded = true;
            t.y = landY; 
            v.vy = 0; 
            v.vx = 0; 
            p.angleAcc = 54000;
            p.angleStep = 27;
            t.angle = -Math.PI / 2; // Snap perfectly upright
            v.angularVelocity = 0;
        });

        const pvpHit = room.category === 'dogfight' && !p.isLanded && checkPvPCollisions(ecs, e, t, 20, room);

        if ((crashed || pvpHit) && !p.advancing) {
            killPlayer(ecs, e, room);
        }
    }
}
