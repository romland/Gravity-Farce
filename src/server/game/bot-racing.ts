// src/server/game/bot-racing.ts
import { Registry, type Entity } from '../core/ecs';
import type { Room } from '../Room';
import { raycastEnvironment } from '../core/math';
import { TILE_DICTIONARY } from '../core/tiles';
import { SERVER_CONFIG } from '../core/config';
import { getCheckpoints, calculatePathToGate, prunePath, hasClearPath, applyAngularControl, getAngleDiff, logRacingCrash, findSafePadPosition } from './bot-utils';
import { botPathWorker } from './bot-path-worker';
import { spawnClassicPlayer } from './player-classic';
export const BOT_UUID_PREFIX = 'RACER_';


let racingTickCounter = 0;

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

    if (SERVER_CONFIG.debugMode && racingTickCounter % 60 === 0) {
        const cpIdx = p.race ? p.race.nextCheckpoint : 1;
        console.log(`[BOT-RACING] ${p.alias} | State: ${bot.state} | Landed: ${p.isLanded} | NextCP: ${cpIdx} | Speed: ${Math.hypot(v.vx, v.vy).toFixed(2)}`);
    }

    p.inputs = { up: false, left: false, right: false, shoot: false };

    // 1. LANDED RECOVERY
    if (p.isLanded) {
        bot.state = 'takeoff';
        bot.stateTimer = 20;
        p.inputs.up = true;
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

    // 3. TARGET ACQUISITION (Strict sequence order)
    if (p.race?.state === 2) return; // Race finished! Coast to a stop.

    const checkpoints = getCheckpoints(room);
    const nextCpNum = p.race ? p.race.nextCheckpoint : 1;
    const targetCp = checkpoints[nextCpNum - 1];

    if (!targetCp) return;

    // PATH RECALCULATION
    bot.pathTimer--;
    const currentCpNum = p.race ? p.race.nextCheckpoint : 1;
    if (!bot.pathPending && (bot.path.length === 0 || bot.pathTimer <= 0 || (bot as any).lastCpNum !== currentCpNum)) {
        (bot as any).lastCpNum = currentCpNum;
        const validCps = checkpoints.filter(Boolean);
        const nextIndex = validCps.length > 0 ? (currentCpNum % validCps.length) : 0;
        const futureCp = validCps[nextIndex];

        bot.pathTimer = 15;
        bot.pathPending = true;
        botPathWorker.syncLevel(room.levelIndex, room.level);
        botPathWorker.enqueue({
            kind: 'gate',
            levelIndex: room.levelIndex,
            sx: t.x,
            sy: t.y,
            gate: targetCp,
            futureGate: futureCp
        }, (res) => {
            bot.pathPending = false;
            if (res.path.length > 0) bot.path = res.path;
        });
    }

    // 4. PATH ANALYZER & DYNAMIC BRAKING
    const currentSpeed = Math.hypot(v.vx, v.vy);
    const map = room.level.rawMap;

    // Simple waypoint popping based strictly on radius (prevents accidentally deleting corner nodes)
    while (bot.path.length > 0) {
        let wx = bot.path[0].x * 32 + 16;
        let wy = bot.path[0].y * 32 + 16;
        if (Math.hypot(t.x - wx, t.y - wy) < 40) {
            bot.path.shift();
        } else {
            break;
        }
    }

    // Apply Apex smoothing to path array to push racing line away from walls
    const smoothedPath = bot.path.map(wp => {
        let wx = wp.x * 32 + 16;
        let wy = wp.y * 32 + 16;
        if (map && map[wp.y]) {
            if (map[wp.y]?.[wp.x - 1] && TILE_DICTIONARY[map[wp.y][wp.x - 1]]?.solid) wx += 16;
            if (map[wp.y]?.[wp.x + 1] && TILE_DICTIONARY[map[wp.y][wp.x + 1]]?.solid) wx -= 16;
            if (map[wp.y - 1]?.[wp.x] && TILE_DICTIONARY[map[wp.y - 1][wp.x]]?.solid) wy += 16;
            if (map[wp.y + 1]?.[wp.x] && TILE_DICTIONARY[map[wp.y + 1][wp.x]]?.solid) wy -= 16;
        }
        return { x: wx, y: wy };
    });

    const botMoveAngle = currentSpeed > 1.0 ? Math.atan2(v.vy, v.vx) : t.angle;

    // Kinematic Stopping Distance: d = (v^2 / 2a) + (v * turnTime)
    const turnTime = 36; // Ticks required for a 180 degree rotation
    const brakingAccel = 0.05; // Conservative thrust minus gravity overhead
    const stoppingDist = ((currentSpeed * currentSpeed) / (2 * brakingAccel)) + (currentSpeed * turnTime);

    const LOOKAHEAD_DIST = Math.max(120, stoppingDist * 1.2);

    let aimX = t.x, aimY = t.y;
    let foundAim = false;
    let accumDistAim = 0;
    let prevPosAim = { x: t.x, y: t.y };

    // 1. Find Lookahead Aim Point smoothly along the polyline
    for (let i = 0; i < smoothedPath.length; i++) {
        const wp = smoothedPath[i];
        const segDist = Math.hypot(wp.x - prevPosAim.x, wp.y - prevPosAim.y);

        if (accumDistAim + segDist >= LOOKAHEAD_DIST) {
            const excess = LOOKAHEAD_DIST - accumDistAim;
            const ratio = excess / (segDist || 1);
            aimX = prevPosAim.x + (wp.x - prevPosAim.x) * ratio;
            aimY = prevPosAim.y + (wp.y - prevPosAim.y) * ratio;
            foundAim = true;
            break;
        }
        accumDistAim += segDist;
        prevPosAim = wp;
    }

    // 2. Analyze Track Curvature (Strictly Track Geometry, Independent of Bot Position)
    let maxPathSeverity = 0;
    let accumDistCurve = 0;
    const LOOKAHEAD_CURVE = Math.max(800, stoppingDist * 1.5);

    if (smoothedPath.length >= 2) {
        accumDistCurve += Math.hypot(smoothedPath[0].x - t.x, smoothedPath[0].y - t.y);
        let prevAngle = Math.atan2(smoothedPath[1].y - smoothedPath[0].y, smoothedPath[1].x - smoothedPath[0].x);
        for (let i = 1; i < smoothedPath.length - 1; i++) {
            const wpCurr = smoothedPath[i];
            const wpNext = smoothedPath[i + 1];
            const segDist = Math.hypot(wpNext.x - wpCurr.x, wpNext.y - wpCurr.y);
            const segAngle = Math.atan2(wpNext.y - wpCurr.y, wpNext.x - wpCurr.x);

            const turnDiff = Math.abs(getAngleDiff(segAngle, prevAngle));

            // Only penalize significant turns (> ~25 degrees). Protects Level 50 max speed.
            if (turnDiff > 0.43) {
                const distanceDiscount = Math.max(0, 1.0 - (accumDistCurve / LOOKAHEAD_CURVE));
                const severity = Math.min(1.0, (turnDiff / Math.PI) * 1.5) * distanceDiscount;
                if (severity > maxPathSeverity) {
                    maxPathSeverity = severity;
                }
            }

            accumDistCurve += segDist;
            prevAngle = segAngle;
            if (accumDistCurve > LOOKAHEAD_CURVE) break;
        }
    }

    if (!foundAim && smoothedPath.length > 0) {
        aimX = smoothedPath[smoothedPath.length - 1].x;
        aimY = smoothedPath[smoothedPath.length - 1].y;
    } else if (smoothedPath.length === 0) {
        aimX = targetCp.center.x;
        aimY = targetCp.center.y;
    }

    let isBlockedPocket = false;
    // Line of sight fallback. If aim point is blocked by a wall, pull aim point much closer!
    if (!hasClearPath({ x: t.x, y: t.y }, { x: aimX, y: aimY }, room.level)) {
        if (smoothedPath.length > 0) {
            aimX = smoothedPath[0].x;
            aimY = smoothedPath[0].y;
            // STRICT centerline raycast to detect true physical blockage, ignoring the 22px fat margin
            if (raycastEnvironment({ x: t.x, y: t.y }, { x: aimX, y: aimY }, room.level)) {
                isBlockedPocket = true;
            }
        }
    }

    // --- DYNAMIC SEVERITY SCALING ---

    // 1. Trajectory Alignment Severity: If we are drifting wildly away from our aim point, brake!
    let trajectorySeverity = 0;
    if (currentSpeed > 2.0) {
        const pathAngle = Math.atan2(aimY - t.y, aimX - t.x);
        const driftDiff = Math.abs(getAngleDiff(pathAngle, botMoveAngle)) / Math.PI;
        // Aggressive scaling: 50-deg drift (0.28) -> 45% brake. 90-deg drift (0.5) -> 100% brake (Retro-burn)
        trajectorySeverity = Math.min(1.0, Math.max(0, driftDiff - 0.1) * 2.5);
    }

    let wallSeverity = isBlockedPocket ? 1.0 : 0.0;
    const maxSeverity = Math.max(maxPathSeverity, trajectorySeverity, wallSeverity);
    const clampedSeverity = Math.max(0.0, Math.min(1.0, maxSeverity));

    let targetSpeed = 7.5 * (1.0 - clampedSeverity);
    targetSpeed = Math.max(0.0, Math.min(7.5, targetSpeed));

    // 5. VECTOR PHYSICS CORRECTOR
    const dirX = aimX - t.x;
    const dirY = aimY - t.y;
    const distToAim = Math.hypot(dirX, dirY) || 1;

    const desVx = (dirX / distToAim) * targetSpeed;
    const desVy = (dirY / distToAim) * targetSpeed;

    const forceX = desVx - v.vx;
    const forceY = desVy - v.vy - 0.010; // Compensate for gravity constant


    let forceAngle = Math.atan2(forceY, forceX);

    if (currentSpeed < 0.5 && isBlockedPocket) {
        forceAngle = -Math.PI / 2; // Ascend if stuck hovering in a pocket
    }

    (bot as any).lastDesiredAngle = forceAngle;

    const angleDiff = applyAngularControl(p, t, v, forceAngle);
    const reqForce = Math.hypot(forceX, forceY);

    // Widen thrust cone heavily when requiring massive corrective force (retro-burns/trail-braking)
    const thrustCone = reqForce > 5.0 ? 1.4 : (reqForce > 2.0 ? 0.9 : 0.4);

    if (angleDiff < thrustCone && reqForce > 0.05) {
        p.inputs.up = true;
    }

    let currentPathOffset = 0;
    if (bot.path && bot.path.length > 0) {
        currentPathOffset = Math.hypot(t.x - (bot.path[0].x * 32 + 16), t.y - (bot.path[0].y * 32 + 16));
    }

    // BLACK-BOX FLIGHT RECORDER
    if (!(bot as any).flightRecorder) (bot as any).flightRecorder = [];
    const rec = (bot as any).flightRecorder;
    rec.push({
        tick: racingTickCounter,
        x: Math.round(t.x), y: Math.round(t.y),
        vx: Number(v.vx.toFixed(2)), vy: Number(v.vy.toFixed(2)),
        speed: Number(currentSpeed.toFixed(2)),
        facingDeg: Number((t.angle * 180 / Math.PI).toFixed(1)),
        desiredDeg: Number((forceAngle * 180 / Math.PI).toFixed(1)),
        thrust: Boolean(p.inputs.up),
        safe: true,
        targetSpeed: Number(targetSpeed.toFixed(2)),
        pathOffset: Math.round(currentPathOffset),
        distToAim: Math.round(distToAim)
    });
    if (rec.length > 240) rec.shift();
}

export function spawnRacingBot(ecs: Registry, x: number, y: number, alias: string, level?: import('../core/types').LevelData): Entity {
    const safePos = findSafePadPosition(level, x, y);
    const botId = BOT_UUID_PREFIX + alias;
    const e = spawnClassicPlayer(ecs, botId, safePos.x, safePos.y, { uuid: botId, alias, shipType: 'classic', lives: SERVER_CONFIG.defaultLives });

    const t = ecs.transforms.get(e);
    if (t) t.angle = -Math.PI / 2;

    const v = ecs.velocities.get(e);
    if (v) { v.vx = 0; v.vy = 0; v.angularVelocity = 0; }

    const p = ecs.players.get(e);
    if (p) p.isLanded = true;

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