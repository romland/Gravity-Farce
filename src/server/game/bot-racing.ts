import { Registry, type Entity } from '../core/ecs';
import type { Room } from '../Room';
import { raycastEnvironment } from '../core/math';
import { spawnClassicPlayer } from './player-classic';
import { TILE_DICTIONARY } from '../core/tiles';
import { SERVER_CONFIG } from '../core/config';
import { findSafePadPosition, getCheckpoints, calculatePathToGate, prunePath, hasClearPath, applyAngularControl, predictGlideCollision, getAngleDiff, dumpRacingAsciiMap } from './bot-racing-utils';

const BOT_UUID_PREFIX = 'RACER_';
let racingTickCounter = 0;

export function spawnRacingBot(ecs: Registry, x: number, y: number, alias: string, level?: import('../core/types').LevelData): Entity {
    const safePos = findSafePadPosition(level, x, y);
    const botId = BOT_UUID_PREFIX + alias;
    const e = spawnClassicPlayer(ecs, botId, safePos.x, safePos.y, { uuid: botId, alias, shipType: 'classic' });
    
    const t = ecs.transforms.get(e);
    if (t) t.angle = -Math.PI / 2;
    
    const v = ecs.velocities.get(e);
    if (v) { v.vx = 0; v.vy = 0; v.angularVelocity = 0; }
    
    const p = ecs.players.get(e);
    if (p) p.isLanded = true;

    if (SERVER_CONFIG.debugMode) {
        console.log(`[BOT-RACING] Spawned Racing Bot "${alias}" at (${Math.round(safePos.x)}, ${Math.round(safePos.y)})`);
    }

    ecs.bots.set(e, {
        active: true,
        role: 'racer',
        reactionTimer: 0,
        state: 'takeoff',
        stateTimer: 20,
        path: [],
        pathTimer: 0
    });
    
    return e;
}

export function sysRacingBotAI(ecs: Registry, room: Room) {
    if (room.category !== 'race') return;
    racingTickCounter++;

    const bots = Array.from(ecs.bots.entries());
    for (const [e, bot] of bots) {
        const p = ecs.players.get(e);
        if (p?.isDead && (bot as any).wasAlive) {
            (bot as any).wasAlive = false;
            if (SERVER_CONFIG.debugMode) {
                logRacingCrash(ecs, room, e, bot, p, racingTickCounter);
            }
        } else if (p && !p.isDead) {
            (bot as any).wasAlive = true;
        }
    }

    const activeRacers = bots.filter(([e]) => !ecs.players.get(e)?.isDead);

    for (const [e, bot] of activeRacers) {
        processRacingFlight(ecs, room, e, bot);
    }
}

function processRacingFlight(ecs: Registry, room: Room, e: Entity, bot: import('../core/types').BotState) {
    const p = ecs.players.get(e)!;
    const t = ecs.transforms.get(e)!;
    const v = ecs.velocities.get(e)!;

    if (SERVER_CONFIG.debugMode && racingTickCounter % 30 === 0) {
        const cpIdx = p.race ? p.race.nextCheckpoint : 1;
        console.log(`[BOT-RACING] ${p.alias} | State: ${bot.state} | Landed: ${p.isLanded} | NextCP: ${cpIdx} | PathLen: ${bot.path?.length}`);
    }

    p.inputs = { up: false, left: false, right: false, shoot: false };

    // 1. LANDED RECOVERY
    if (p.isLanded) {
        bot.state = 'takeoff';
        bot.stateTimer = 20;
        p.isLanded = false;
        return;
    }

    // 2. TAKEOFF SEQUENCE
    if (bot.state === 'takeoff') {
        const floorHit = raycastEnvironment({ x: t.x, y: t.y }, { x: t.x, y: t.y + 60 }, room.level);
        const ceilingHit = raycastEnvironment({ x: t.x, y: t.y }, { x: t.x, y: t.y - 60 }, room.level);
        const floorDist = floorHit ? floorHit.y - t.y : 999;
        const ceilingDist = ceilingHit ? t.y - ceilingHit.y : 999;

        if (ceilingDist < 45 || floorDist >= 22 || bot.stateTimer <= 0) {
            bot.state = 'race';
        } else {
            bot.stateTimer--;
            p.inputs.up = true;
            applyAngularControl(p, t, v, -Math.PI / 2);
            return;
        }
    }

    // 3. TARGET ACQUISITION
    if (p.race?.state === 2) return; // Race finished! Coast to a stop.

    const checkpoints = getCheckpoints(room);
    const nextCpNum = p.race ? p.race.nextCheckpoint : 1; // 1-indexed (1 to 8)
    const targetCp = checkpoints[nextCpNum - 1]; // Array is 0-indexed

    if (!targetCp) return; // No checkpoints found on map

    let aimX = t.x;
    let aimY = t.y - 100;
    const distToCp = Math.hypot(targetCp.x - t.x, targetCp.y - t.y);

    // PATH RECALCULATION
    bot.pathTimer--;
    const currentCpNum = p.race ? p.race.nextCheckpoint : 1;
    if (bot.path.length === 0 || bot.pathTimer <= 0 || (bot as any).lastCpNum !== currentCpNum) {
        (bot as any).lastCpNum = currentCpNum;
        const rawPath1 = calculatePathToGate(room.level.rawMap, t.x, t.y, targetCp);
        
            // F1 Stitching: Plan path to Current Checkpoint, THEN path to Next Checkpoint.
            // But NEVER prune across checkpoints, ensuring we actually cross the required gate.
            const pruned1 = prunePath(rawPath1, room, { x: t.x, y: t.y });

        const validCps = checkpoints.filter(Boolean);
        const nextIndex = validCps.length > 0 ? (currentCpNum % validCps.length) : 0;
        const futureCp = validCps[nextIndex];

        if (futureCp && rawPath1.length > 0) {
            const lastNode = rawPath1[rawPath1.length - 1];
            const startX = lastNode.x * 32 + 16;
            const startY = lastNode.y * 32 + 16;
            const rawPath2 = calculatePathToGate(room.level.rawMap, startX, startY, futureCp);
                const pruned2 = prunePath(rawPath2, room);
                // Combine, preserving the checkpoint gate node precisely
                bot.path = [...pruned1, ...pruned2.slice(1)];
        } else {
                bot.path = pruned1;
        }
            bot.pathTimer = 15; 
    }

        // FOLLOW OPTIMAL RACING LINE (F1 PURE PURSUIT)
        const currentSpeed = Math.hypot(v.vx, v.vy);
        const MAX_SHIP_SPEED = 7.5;
        
    if (bot.path && bot.path.length > 0) {
            // Dynamic Lookahead based on speed. Faster = aim further ahead for smooth apexing.
            const lookaheadDist = Math.max(64, currentSpeed * 24);

            let targetIdx = 0;
            let accumDist = 0;
            let lastPos = {x: t.x, y: t.y};

            for (let i = 0; i < bot.path.length; i++) {
                const wpX = bot.path[i].x * 32 + 16;
                const wpY = bot.path[i].y * 32 + 16;
                const d = Math.hypot(wpX - lastPos.x, wpY - lastPos.y);
                accumDist += d;
                lastPos = { x: wpX, y: wpY };

                if (hasClearPath({ x: t.x, y: t.y }, { x: wpX, y: wpY }, room.level)) {
                    targetIdx = i;
                    if (accumDist >= lookaheadDist) {
                        break;
                    }
                } else {
                    break;
                }
            }

            // Pop deeply passed waypoints to avoid doubling back
            if (targetIdx > 0 && Math.hypot(t.x - (bot.path[0].x * 32 + 16), t.y - (bot.path[0].y * 32 + 16)) < 48) {
            bot.path.shift();
                targetIdx = Math.max(0, targetIdx - 1);
        }

        }
            if (bot.path[targetIdx]) {
                // Apex / Corridor Centering
                let wpX = bot.path[targetIdx].x * 32 + 16;
                let wpY = bot.path[targetIdx].y * 32 + 16;
                const map = room.level.rawMap;
                const nx = bot.path[targetIdx].x;
                const ny = bot.path[targetIdx].y;
                if (map && map[ny]) {
                    if (map[ny]?.[nx - 1] && TILE_DICTIONARY[map[ny][nx - 1]]?.solid) wpX += 16;
                    if (map[ny]?.[nx + 1] && TILE_DICTIONARY[map[ny][nx + 1]]?.solid) wpX -= 16;
                    if (map[ny - 1]?.[nx] && TILE_DICTIONARY[map[ny - 1][nx]]?.solid) wpY += 16;
                    if (map[ny + 1]?.[nx] && TILE_DICTIONARY[map[ny + 1][nx]]?.solid) wpY -= 16;
                }
                aimX = wpX;
                aimY = wpY;
    } else {
        aimX = targetCp.center.x;
        aimY = targetCp.center.y;
    }

    // 4. VECTOR-BASED RACING PHYSICS (GRAVITY & INERTIA DRIFT COMPENSATED)
    const dirX = aimX - t.x;
    const dirY = aimY - t.y;
    const distToAim = Math.hypot(dirX, dirY) || 1;
    
        const targetAngle = Math.atan2(dirY, dirX);
        const currentMotionAngle = currentSpeed > 0.5 ? Math.atan2(v.vy, v.vx) : t.angle;
        const requiredTurn = Math.abs(getAngleDiff(targetAngle, currentMotionAngle));

        // Speed Governor: Only brake if the turn is impossibly sharp.
        let targetSpeed = MAX_SHIP_SPEED;
        if (requiredTurn > Math.PI / 2 && distToAim < 250) {
            targetSpeed = 2.0; // Hairpin brake
        } else if (requiredTurn > Math.PI / 4 && distToAim < 150) {
            targetSpeed = 4.5; // Moderate braking for chicane
    }

    // Desired velocity vector
    const desVx = (dirX / distToAim) * targetSpeed;
    const desVy = (dirY / distToAim) * targetSpeed;

        // Counteract standard Amiga gravity (0.010 per tick) to maintain altitude
        const GRAVITY = 0.010;
    const forceX = desVx - v.vx;
    const forceY = (desVy - v.vy) - GRAVITY;

        let desiredAngle = Math.atan2(forceY, forceX);
        (bot as any).lastDesiredAngle = desiredAngle;

        // F1 Trail Braking: If overcooked into a hairpin, rotate 180 and fire retro thrusters
        let needsRetroBrake = false;
        if (requiredTurn > Math.PI / 1.5 && currentSpeed > 5.0 && distToAim < 200) {
            desiredAngle = Math.atan2(-v.vy, -v.vx);
            needsRetroBrake = true;
    }

    const angleDiff = applyAngularControl(p, t, v, desiredAngle);

        // Keep throttle pinned if facing roughly the right way.
        const thrustCone = needsRetroBrake ? 0.4 : 0.8;
        if (angleDiff < thrustCone) {
            p.inputs.up = true;
    }

    // BLACK-BOX FLIGHT RECORDER (Ring buffer of last 60 ticks)
    if (!(bot as any).flightRecorder) (bot as any).flightRecorder = [];
    const rec = (bot as any).flightRecorder;
    rec.push({
        tick: racingTickCounter,
        x: Math.round(t.x), y: Math.round(t.y),
        vx: Number(v.vx.toFixed(2)), vy: Number(v.vy.toFixed(2)),
        speed: Number(currentSpeed.toFixed(2)),
        facingDeg: Number((t.angle * 180 / Math.PI).toFixed(1)),
        desiredDeg: Number((desiredAngle * 180 / Math.PI).toFixed(1)),
        thrust: Boolean(p.inputs.up),
            safe: true // Obsolete flag removed from AI logic, left for telemetry compat
    });
    if (rec.length > 60) rec.shift();
}

// ----------------------------------------------------------------------------
// Crash Telemetry & ASCII Slice Logging
// ----------------------------------------------------------------------------

function logRacingCrash(ecs: Registry, room: Room, e: Entity, bot: import('../core/types').BotState, p: import('../core/types').Player, currentTick: number) {
    const t = ecs.transforms.get(e);
    const v = ecs.velocities.get(e);
    if (!t || !v) return;

    const speed = Math.hypot(v.vx, v.vy);
    const motionAngleRad = Math.atan2(v.vy, v.vx);
    const motionAngleDeg = (motionAngleRad * 180 / Math.PI).toFixed(1);
    const facingAngleDeg = (t.angle * 180 / Math.PI).toFixed(1);
    const driftAngleDeg = (Math.abs(getAngleDiff(motionAngleRad, t.angle)) * 180 / Math.PI).toFixed(1);

    const cpNum = p.race ? p.race.nextCheckpoint : 1;
    const checkpoints = getCheckpoints(room);
    const targetCp = checkpoints[cpNum - 1];

    let pathOffsetPx = 0;
    if (bot.path && bot.path.length > 0) {
        const wp = bot.path[0];
        pathOffsetPx = Math.round(Math.hypot(t.x - (wp.x * 32 + 16), t.y - (wp.y * 32 + 16)));
    }

    const bx = Math.floor(t.x / 32);
    const by = Math.floor(t.y / 32);

    const rec = (bot as any).flightRecorder || [];
    const maxVy = rec.length > 0 ? Math.max(...rec.map((r: any) => r.vy)) : v.vy;
    const firstUnsafe = rec.find((r: any) => !r.safe);
    const unsafeTicksAgo = firstUnsafe ? (currentTick - firstUnsafe.tick) : 0;

    console.log(`\n=== [BOT-RACING CRASH TELEMETRY] ${p.alias} crashed at tile (${bx}, ${by}) ===`);
    console.log(`- Target Checkpoint  : Gate #${cpNum} ${targetCp ? `at Center (${Math.floor(targetCp.center.x / 32)},${Math.floor(targetCp.center.y / 32)})` : 'NOT FOUND'}`);
    console.log(`- Impact Speed       : ${speed.toFixed(2)} px/tick (Vy: ${v.vy.toFixed(2)}, Max Downward Vy: ${maxVy.toFixed(2)})`);
    console.log(`- Trajectory vs Face : Motion: ${motionAngleDeg}° | Facing: ${facingAngleDeg}° | Drift Angle: ${driftAngleDeg}°`);
    if ((bot as any).lastDesiredAngle !== undefined) {
        const steerErr = (Math.abs(getAngleDiff((bot as any).lastDesiredAngle, t.angle)) * 180 / Math.PI).toFixed(1);
        console.log(`- Steering Target    : ${((bot as any).lastDesiredAngle * 180 / Math.PI).toFixed(1)}° (Alignment Error: ${steerErr}°)`);
    }
    console.log(`- Line Offset        : ${pathOffsetPx} px away from active path node`);
    console.log(`- Glide Alert        : ${firstUnsafe ? `First flagged UNSAFE ${unsafeTicksAgo} ticks (~${(unsafeTicksAgo/60).toFixed(2)}s) before impact` : 'Never flagged unsafe'}`);

    if (rec.length > 0) {
        console.log(`- BLACK-BOX FLIGHT RECORDER (Past ${rec.length} ticks, sampled every 10 ticks):`);
        console.log(`  T-Minus | Pos (X, Y)   | Vel (Vx, Vy)   | Speed | Facing -> Desired | Thrust | Safe`);
        for (let i = Math.max(0, rec.length - 40); i < rec.length; i += 10) {
            const entry = rec[i];
            const ago = currentTick - entry.tick;
            console.log(`  -${String(ago).padStart(2, ' ')}t    | (${entry.x}, ${entry.y}) | (${entry.vx}, ${entry.vy}) | ${entry.speed}  | ${entry.facingDeg}° -> ${entry.desiredDeg}° | ${entry.thrust ? 'ON ' : 'OFF'}   | ${entry.safe ? 'YES' : 'NO '}`);
        }
        const lastEntry = rec[rec.length - 1];
        const lastAgo = currentTick - lastEntry.tick;
        console.log(`  -${String(lastAgo).padStart(2, ' ')}t    | (${lastEntry.x}, ${lastEntry.y}) | (${lastEntry.vx}, ${lastEntry.vy}) | ${lastEntry.speed}  | ${lastEntry.facingDeg}° -> ${lastEntry.desiredDeg}° | ${lastEntry.thrust ? 'ON ' : 'OFF'}   | ${lastEntry.safe ? 'YES' : 'NO '}`);
    }

    dumpRacingAsciiMap(room, t.x, t.y, targetCp?.center, bot.path, p.alias);
}
