import { Registry, type Entity } from '../core/ecs';
import { killPlayer, checkPvPCollisions } from './combat';
import type { Room } from '../Room';
import { getShipPolygon, checkEnvironmentCollisions } from './player-shared';
import type { PlayerStats } from '../core/types';
import { scaleAmigaPerFrameDelta, scaleAmigaDrag, scaleAmigaFrameTimer } from '../core/math';
import { SERVER_CONFIG } from '../core/config';

// ============================================================================
// AUTHENTIC AMIGA 68K CONSTANTS (Reverse-Engineered & Scaled from 50Hz PAL)
// ============================================================================

// 0x0002E196: 72-step sine/cosine lookup table (360 deg / 5 deg = 72 steps).
// Accumulator full circle is 72,000 units (1,000 units per 5-deg step).
// Step 54 is straight UP (-90 deg = 54,000 units).
export const AMIGA_ANGLE_STEPS = 72;
export const AMIGA_UPRIGHT_STEP = 54;
export const AMIGA_UPRIGHT_ACC = AMIGA_UPRIGHT_STEP * 1000;
export const AMIGA_FULL_CIRCLE_ACC = AMIGA_ANGLE_STEPS * 1000;
// True 50Hz PAL rotation rate (1,000 units = 1 step = 5 deg per 50Hz frame = 250 deg/sec)
export const CLASSIC_ROTATION_SPEED = scaleAmigaPerFrameDelta(1000);

// 0x00037F78: Baseline gravity (0.010 in 50Hz PAL, tuned to 0.014 so descents pull you down firmly without floatiness)
export const CLASSIC_GRAVITY = scaleAmigaPerFrameDelta(0.014);

// Extra downward gravity added per unit of cargo weight (1 weight = +40%, 3 weight = +120% gravity pull)
export const CLASSIC_CARGO_GRAVITY_MULT = 0.40;

// 0x0002E196 & 0x00037FBA: Thrust vector multiplied by [02, 05, 00, 00] (2.5x).
// Scaled from 0.070 at 50Hz PAL with a 1.05x responsiveness trim (was 1.20x when *(60/50) was present).
export const CLASSIC_THRUST_IMPULSE = scaleAmigaPerFrameDelta(0.070 * 1.12);

// Takeoff constants when lifting off from a landed state
export const CLASSIC_TAKEOFF_THRUST_THRESHOLD = 0.5;
export const CLASSIC_TAKEOFF_VY = -scaleAmigaPerFrameDelta(1.2);

// ============================================================================
// MOMENTUM, GLIDE & RETRO-BRAKING TUNING CONSTANTS (Classic Player Only)
// ============================================================================
// How much speed is retained after 1 full second (50 PAL frames / 60 server ticks) of coasting:
//   - 0.9975 per 60Hz tick -> 86.0% retained after 1s (stops sideways drift too easily on its own)
//   - 0.9992 per 50Hz frame -> 96.1% retained after 1s (authentic icy glide; requires active retro-burn to stop)
//   - 0.9996 per 50Hz frame -> 98.0% retained after 1s (near-vacuum inertia)
//   - 1.0000                -> 100% retained (pure Newtonian vacuum, zero passive slowdown)
export const CLASSIC_COAST_DRAG_X = scaleAmigaDrag(0.9945);

// Horizontal drag while actively firing the thruster (slight air-stabilization under power).
// Set equal to CLASSIC_COAST_DRAG_X if you want zero difference between powered and unpowered glide.
export const CLASSIC_THRUST_DRAG_X = scaleAmigaDrag(0.9935);

// Vertical drag applied when ascending (vy < 0) so upward hops peak crisply,
// and during powered flight. Free-fall (vy > 0, no thrust) uses CLASSIC_FREEFALL_DRAG_Y.
export const CLASSIC_ASCENT_DRAG_Y = scaleAmigaDrag(0.9950);
// 1.0 = zero air-resistance braking when falling downward so gravity pulls you down hard
export const CLASSIC_FREEFALL_DRAG_Y = 1.0;

// Multiplier on engine thrust when counter-thrusting (retro-braking) against existing horizontal momentum.
//   - 1.00 = symmetric thrust (accelerating and braking have identical force)
//   - 0.85 = stiffer momentum (harder to arrest a fast sideways slide; requires earlier braking)
//   - 1.15 = snappier braking (easier to catch a slide)
export const CLASSIC_RETRO_BRAKE_MULT = 0.90;
export const CLASSIC_RETRO_THRESHOLD_VX = scaleAmigaPerFrameDelta(0.2);
export const CLASSIC_DRAG = CLASSIC_COAST_DRAG_X;

// 0x0003580E & 0x00035852: Gravity well force vectors (tiles 0xCC..0xCF) = [02, 00, 00, 00] (0.020 units/frame = 2x gravity)
export const MAGNET_FORCE_X = scaleAmigaPerFrameDelta(0.020);
export const MAGNET_FORCE_Y = scaleAmigaPerFrameDelta(0.020);

// Top speed cap (scaled from 7.5 at 50Hz PAL with 1.05x trim = ~6.56 px/tick at 60Hz instead of 7.5)
export const CLASSIC_MAX_SPEED = scaleAmigaPerFrameDelta(7.5 * 1.15);

// 0x000352A8 & 0x000352CE: Safe landing velocity bounds (Y bounce threshold: 0x30000, X crash threshold: 0x02000000 = 2.000)
export const MAX_SAFE_LANDING_VY = scaleAmigaPerFrameDelta(2.0);
export const MAX_SAFE_LANDING_VX = scaleAmigaPerFrameDelta(2.0);
export const LANDING_BOUNCE_THRESHOLD_VY = scaleAmigaPerFrameDelta(1.15);
export const CLASSIC_BOUNCE_DAMP_Y = 0.45;
export const CLASSIC_BOUNCE_DAMP_X = 0.50;

// 52 to 56 Amiga angle gate around upright step 54 (±2 steps = ±10 degrees)
export const CLASSIC_UPRIGHT_TOLERANCE_STEPS = 2;
export const CLASSIC_SHIP_BASE_SIZE = 16;
export const CLASSIC_PVP_HIT_RADIUS = 20;
export const CLASSIC_SMALL_CARGO_ID = 0xD1;
export const CLASSIC_SMALL_CARGO_WEIGHT = 1;
export const CLASSIC_LARGE_CARGO_WEIGHT = 2;

// 0x00038062 & 0x00031B28: Active fuel deduction rate = 0x0000000F (15 units/frame at 50Hz = 750 units/sec)
export const CLASSIC_FUEL_DRAIN = scaleAmigaPerFrameDelta(15);
export const CLASSIC_INITIAL_FUEL = 76464;
export const CLASSIC_MAX_FUEL = 99999;

// ImpNote 1: Slow auto-fire when holding fire button (30 ticks), fast pulse when spamming fire (6 Amiga frames)
export const CLASSIC_AUTOFIRE_COOLDOWN = Math.round(scaleAmigaFrameTimer(25));

export function spawnClassicPlayer(ecs: Registry, id: string, x: number, y: number, stats?: Partial<PlayerStats>): Entity {
    const e = ecs.create();
    ecs.transforms.set(e, { x, y, angle: -Math.PI / 2 });
    ecs.velocities.set(e, { vx: 0, vy: 0, angularVelocity: 0 });
    ecs.players.set(e, {
        id,
        type: 'classic',
        uuid: stats?.uuid ?? id,
        alias: stats?.alias ?? 'UNK',
        isBotPilot: stats?.isBot ?? false,
        joinedAt: stats?.joinedAt ?? Date.now(),
        joinedAtTick: stats?.joinedAtTick ?? 0,
        isDead: false,
        inputs: { up: false, left: false, right: false, shoot: false },
        respawnRequest: false,
        angleAcc: AMIGA_UPRIGHT_ACC,
        angleStep: AMIGA_UPRIGHT_STEP,
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
    ecs.fuelTanks.set(e, { current: CLASSIC_INITIAL_FUEL, max: CLASSIC_MAX_FUEL, consumed: stats?.fuelConsumed ?? 0 });
    ecs.cargoBays.set(e, { stack: [], unloadTimer: 0, maxWeight: 3 });
    ecs.weaponMounts.set(e, {
        cooldown: 0,
        baseCooldown: CLASSIC_AUTOFIRE_COOLDOWN,
        activeModeId: 0xD5,
        charges: 0,
        shotsFired: stats?.shotsFired ?? 0,
        shootLatch: false,
        prevShoot: false,
        triggerReleased: true
    });
    return e;
}

export function sysClassicPlayers(ecs: Registry, room: Room) {
    for (const [e, p] of ecs.players.entries()) {
        if (p.type !== 'classic' || p.isDead) continue;
        const t = ecs.transforms.get(e)!;
        const v = ecs.velocities.get(e)!;
        const inv = ecs.cargoBays.get(e);
        const f = ecs.fuelTanks.get(e);

        const weight = inv ? inv.stack.reduce((sum, id) => sum + (id === CLASSIC_SMALL_CARGO_ID ? CLASSIC_SMALL_CARGO_WEIGHT : CLASSIC_LARGE_CARGO_WEIGHT), 0) : 0;
        const weightGravity = CLASSIC_GRAVITY * (1.0 + (weight * CLASSIC_CARGO_GRAVITY_MULT));
        // 0x00037FBA: Original Amiga thrust multiplier [02, 05, 00, 00] (2.5x) is constant; cargo mass does not cut engine thrust
        const weightThrust = CLASSIC_THRUST_IMPULSE;
        const thrustScale = Math.max(p.inputs.up ? 1.0 : 0.0, p.inputs.analogUp || 0.0);

        if (p.isLanded) {
            v.vx = 0; 
            v.vy = 0; 
            p.angleAcc = AMIGA_UPRIGHT_ACC; 
            p.angleStep = AMIGA_UPRIGHT_STEP; 
            t.angle = -Math.PI / 2;
            
            if (thrustScale > CLASSIC_TAKEOFF_THRUST_THRESHOLD) { // Needs sufficient thrust to lift off
                p.isLanded = false;
                v.vy = CLASSIC_TAKEOFF_VY;
            } else {
                continue;
            }
        }

        if (p.inputs.analogX) {
            const rot = Math.round(CLASSIC_ROTATION_SPEED * p.inputs.analogX);
            p.angleAcc = (p.angleAcc + rot + AMIGA_FULL_CIRCLE_ACC) % AMIGA_FULL_CIRCLE_ACC;
        } else {
            if (p.inputs.left) {
                p.angleAcc = (p.angleAcc - CLASSIC_ROTATION_SPEED + AMIGA_FULL_CIRCLE_ACC) % AMIGA_FULL_CIRCLE_ACC;
            }
            if (p.inputs.right) {
                p.angleAcc = (p.angleAcc + CLASSIC_ROTATION_SPEED) % AMIGA_FULL_CIRCLE_ACC;
            }
        }

        // 72 discrete 5-degree steps around the circle (step 54 = -PI/2 upright)
        p.angleStep = Math.floor(p.angleAcc / 1000) % AMIGA_ANGLE_STEPS;
        t.angle = (p.angleStep * (Math.PI * 2)) / AMIGA_ANGLE_STEPS;

        if (thrustScale > 0 && f && f.current > 0) {
             const drain = Math.min(CLASSIC_FUEL_DRAIN * thrustScale, f.current);
             f.current -= drain;
             f.consumed += drain;
             const accelX = Math.cos(t.angle) * weightThrust * thrustScale;
             // Apply CLASSIC_RETRO_BRAKE_MULT when thrusting opposite to current horizontal motion
             const isRetroX = (v.vx > CLASSIC_RETRO_THRESHOLD_VX && accelX < 0) || (v.vx < -CLASSIC_RETRO_THRESHOLD_VX && accelX > 0);
             v.vx += accelX * (isRetroX ? CLASSIC_RETRO_BRAKE_MULT : 1.0);
             v.vy += Math.sin(t.angle) * weightThrust * thrustScale;
        }
        
        // Gravity Wells / Magnets (0xCC - 0xCF) from $00035852 table
        if (room.level && room.level.rawMap) {
            const tileX = Math.floor(t.x / 32);
            const tileY = Math.floor(t.y / 32);
            const tileId = room.level.rawMap[tileY]?.[tileX];
            
            if (tileId !== undefined) {
                if (tileId === 0xCC) v.vx += MAGNET_FORCE_X; // Right (Dir 01)
                if (tileId === 0xCD) v.vy += MAGNET_FORCE_Y; // Down  (Dir 01)
                if (tileId === 0xCE) v.vx -= MAGNET_FORCE_X; // Left  (Dir 00)
                if (tileId === 0xCF) v.vy -= MAGNET_FORCE_Y; // Up    (Dir 00)
            }
        }

        // Apply separate horizontal coasting vs powered drag and vertical ascent vs free-fall drag
        v.vx *= (thrustScale > 0 ? CLASSIC_THRUST_DRAG_X : CLASSIC_COAST_DRAG_X);
        if (v.vy < 0 || thrustScale > 0) {
            v.vy *= CLASSIC_ASCENT_DRAG_Y;
        } else {
            v.vy *= CLASSIC_FREEFALL_DRAG_Y;
        }
        v.vy += weightGravity;
        
        const speed = Math.hypot(v.vx, v.vy);
        if (speed > CLASSIC_MAX_SPEED) {
            v.vx = (v.vx / speed) * CLASSIC_MAX_SPEED;
            v.vy = (v.vy / speed) * CLASSIC_MAX_SPEED;
        }
        
        t.x += v.vx; 
        t.y += v.vy;

        const sl = getShipPolygon(t.x, t.y, t.angle, CLASSIC_SHIP_BASE_SIZE);

        // 52 to 56 Amiga angle gate around upright step 54 (±10 degrees)
        const isAngleUpright = Math.abs(p.angleStep - AMIGA_UPRIGHT_STEP) <= CLASSIC_UPRIGHT_TOLERANCE_STEPS;
        // 0x000352A8 & 0x000352CE: Must satisfy both vertical and horizontal velocity bounds
        const canLand = () => v.vy >= 0 && v.vy <= MAX_SAFE_LANDING_VY && Math.abs(v.vx) <= MAX_SAFE_LANDING_VX && isAngleUpright;

        const land = (targetY: number) => { 
            // 0x000352A8: Optional landing bounce if vertical speed exceeds soft threshold
            if (SERVER_CONFIG.classicLandingBounce && v.vy > LANDING_BOUNCE_THRESHOLD_VY) {
                t.y = targetY - 1;
                v.vy = -v.vy * CLASSIC_BOUNCE_DAMP_Y;
                v.vx *= CLASSIC_BOUNCE_DAMP_X;
                return;
            }
            p.isLanded = true; 
            t.y = targetY; 
            v.vy = 0; 
            v.vx = 0; 
            p.angleAcc = AMIGA_UPRIGHT_ACC; 
            p.angleStep = AMIGA_UPRIGHT_STEP; 
            t.angle = -Math.PI / 2; 
        };

        const crashed = checkEnvironmentCollisions(sl, t.x, t.y, room.level, canLand, (landY, isEndPad) => {
            land(landY);
        });

        const pvpHit = room.category === 'dogfight' && !p.isLanded && checkPvPCollisions(ecs, e, t, CLASSIC_PVP_HIT_RADIUS, room);

        if ((crashed || pvpHit) && !p.advancing) {
            killPlayer(ecs, e, room);
        }
    }
}
