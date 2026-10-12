// src/server/game/bot-racing.ts
import { Registry, type Entity } from '../core/ecs';
import type { Room } from '../Room';
import { raycastEnvironment } from '../core/math';
import { TILE_DICTIONARY } from '../core/tiles';
import { SERVER_CONFIG } from '../core/config';
import { getCheckpoints, calculatePathToGate, prunePath, hasClearPath, applyAngularControl, getAngleDiff, logRacingCrash, spawnRacingBot, predictGlideCollision } from './bot-racing-utils';

export { spawnRacingBot };

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
    if (bot.path.length === 0 || bot.pathTimer <= 0 || (bot as any).lastCpNum !== currentCpNum) {
        (bot as any).lastCpNum = currentCpNum;
        
        // Calculate path strictly to the next required checkpoint to prevent skipping logic
        const rawPath = calculatePathToGate(room.level.rawMap, t.x, t.y, targetCp);
        const pruned = prunePath(rawPath, room, { x: t.x, y: t.y });

        // Add a secondary path to the subsequent checkpoint to enable smooth cornering THROUGH the gate
        const validCps = checkpoints.filter(Boolean);
        const nextIndex = validCps.length > 0 ? (currentCpNum % validCps.length) : 0;
        const futureCp = validCps[nextIndex];

        if (futureCp && rawPath.length > 0) {
            const lastNode = rawPath[rawPath.length - 1];
            const startX = lastNode.x * 32 + 16;
            const startY = lastNode.y * 32 + 16;
            const rawPath2 = calculatePathToGate(room.level.rawMap, startX, startY, futureCp);
            const pruned2 = prunePath(rawPath2, room);
            // Stitch paths, ensuring we cross the current gate precisely
            bot.path = [...pruned, ...pruned2.slice(1)];
        } else {
            bot.path = pruned;
        }
        bot.pathTimer = 15;
    }

        // 4. PATH ANALYZER & DYNAMIC BRAKING
    const currentSpeed = Math.hypot(v.vx, v.vy);
        const map = room.level.rawMap;

        // Smart waypoint popping (prevent getting stuck on bypassed nodes during wide drifts)
        while (bot.path.length > 1) {
            let d0 = Math.hypot(t.x - (bot.path[0].x * 32 + 16), t.y - (bot.path[0].y * 32 + 16));
            let d1 = Math.hypot(t.x - (bot.path[1].x * 32 + 16), t.y - (bot.path[1].y * 32 + 16));
            
            // If the next waypoint is closer than the current one, we've passed the plane
            if (d1 < d0 || d0 < 48) {
                bot.path.shift();
            } else {
                break;
            }
        }
        if (bot.path.length === 1) {
            if (Math.hypot(t.x - (bot.path[0].x * 32 + 16), t.y - (bot.path[0].y * 32 + 16)) < 48) {
                bot.path.shift();
            }
        }

        // Apply Apex smoothing to path array to push racing line away from walls
        const smoothedPath = bot.path.map(wp => {
            let wx = wp.x * 32 + 16;
            let wy = wp.y * 32 + 16;
            if (map && map[wp.y]) {
                if (map[wp.y]?.[wp.x - 1] && TILE_DICTIONARY[map[wp.y][wp.x - 1]]?.solid) wx += 14;
                if (map[wp.y]?.[wp.x + 1] && TILE_DICTIONARY[map[wp.y][wp.x + 1]]?.solid) wx -= 14;
                if (map[wp.y - 1]?.[wp.x] && TILE_DICTIONARY[map[wp.y - 1][wp.x]]?.solid) wy += 14;
                if (map[wp.y + 1]?.[wp.x] && TILE_DICTIONARY[map[wp.y + 1][wp.x]]?.solid) wy -= 14;
            }
            return { x: wx, y: wy };
        });

        // Kinematic Stopping Distance: d = (v^2 / 2a) + (v * turnTime)
        const turnTime = 36; // Ticks required for a 180 degree rotation
        const brakingAccel = 0.05; // Conservative thrust minus gravity overhead
        const stoppingDist = ((currentSpeed * currentSpeed) / (2 * brakingAccel)) + (currentSpeed * turnTime);

        let accumDist = 0;
        let targetSpeed = 7.5; 
        let aimX = t.x, aimY = t.y;
        let foundAim = false;
        const LOOKAHEAD_DIST = Math.max(100, stoppingDist * 0.85); 

        let prevPos = { x: t.x, y: t.y };
        let prevAngle = currentSpeed > 1.0 ? Math.atan2(v.vy, v.vx) : t.angle;

        for (let i = 0; i < smoothedPath.length; i++) {
            const wp = smoothedPath[i];
            const segDist = Math.hypot(wp.x - prevPos.x, wp.y - prevPos.y);
            
            // Find Lookahead Aim Point smoothly along the polyline
            if (!foundAim) {
                if (accumDist + segDist >= LOOKAHEAD_DIST) {
                    const excess = LOOKAHEAD_DIST - accumDist;
                    const ratio = excess / (segDist || 1);
                    aimX = prevPos.x + (wp.x - prevPos.x) * ratio;
                    aimY = prevPos.y + (wp.y - prevPos.y) * ratio;
                    foundAim = true;
                }
            }

            // Analyze Curvature for Braking
            const segAngle = Math.atan2(wp.y - prevPos.y, wp.x - prevPos.x);
            const turnDiff = Math.abs(getAngleDiff(segAngle, prevAngle));
            const turnSeverity = turnDiff / Math.PI; 
            
            if (turnSeverity > 0.15) {
                const brakeDist = accumDist + segDist;
                const minSafeSpeedForTurn = 7.5 * (1.0 - turnSeverity);
                const allowedSpeedNow = Math.sqrt(minSafeSpeedForTurn * minSafeSpeedForTurn + 2 * 0.05 * Math.max(0, brakeDist));
                if (allowedSpeedNow < targetSpeed) {
                    targetSpeed = allowedSpeedNow;
                }
            }
            
            accumDist += segDist;
            prevPos = wp;
            prevAngle = segAngle;
            
            if (accumDist > 1000) break; // Lookahead horizon
        }

        if (!foundAim && smoothedPath.length > 0) {
            aimX = smoothedPath[smoothedPath.length - 1].x;
            aimY = smoothedPath[smoothedPath.length - 1].y;
        } else if (smoothedPath.length === 0) {
            aimX = targetCp.center.x;
            aimY = targetCp.center.y;
        }

        // Line of sight fallback. If blocked by blind corner, aim at first visible waypoint to prevent wall-hugging.
        if (!hasClearPath({x: t.x, y: t.y}, {x: aimX, y: aimY}, room.level)) {
            if (smoothedPath.length > 0) {
                aimX = smoothedPath[0].x;
                aimY = smoothedPath[0].y;
            }
        }

        targetSpeed = Math.max(2.0, Math.min(7.5, targetSpeed));

        // 5. VECTOR PHYSICS CORRECTOR
        const dirX = aimX - t.x;
        const dirY = aimY - t.y;
        const distToAim = Math.hypot(dirX, dirY) || 1;
        
        const desVx = (dirX / distToAim) * targetSpeed;
        const desVy = (dirY / distToAim) * targetSpeed;
        
        const forceX = desVx - v.vx;
        const forceY = desVy - v.vy - 0.010; // Compensate for gravity constant
        
        const forceAngle = Math.atan2(forceY, forceX);
        
    (bot as any).lastDesiredAngle = forceAngle;

    const angleDiff = applyAngularControl(p, t, v, forceAngle);
        const reqForce = Math.hypot(forceX, forceY);

        // Widen thrust cone heavily when requiring massive corrective force (trail braking)
        const thrustCone = reqForce > 4.0 ? 1.2 : (reqForce > 1.5 ? 0.8 : 0.4);
        
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
