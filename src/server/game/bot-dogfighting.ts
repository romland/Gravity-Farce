// spawnDogfightBot(room.ecs, x, y, "A.I.")
import { Registry, type Entity } from '../core/ecs';
import type { Room } from '../Room';
import { raycastEnvironment } from '../core/math';
import { spawnClassicPlayer } from './player-classic';
import { TILE_DICTIONARY } from '../core/tiles';
import { SERVER_CONFIG } from '../core/config';
import { 
    applyAngularControl, getAngleDiff, hasClearPath, prunePath, calculatePath, 
    generateRoamPath, resolveTargetEntity, getEntityPos, getEntityVel, findSafePadPosition, 
    logDogfightCrash, predictGlideCollision } from './bot-utils';
import { evaluateTacticalSensors } from './bot-sensors';

// Bot Constants
const BOT_UUID_PREFIX = 'BOT_';

// Shared Partial Path Cache for Target Squads
interface SharedTargetPath {
    path: { x: number; y: number }[];
    tick: number;
}
const sharedTargetPaths = new Map<string, SharedTargetPath>();
let globalTickCounter = 0;

export function spawnDogfightBot(ecs: Registry, x: number, y: number, alias: string, level?: import('../core/types').LevelData): Entity {
    const safePos = findSafePadPosition(level, x, y, alias);
    const botId = BOT_UUID_PREFIX + alias;
    const e = spawnClassicPlayer(ecs, botId, safePos.x, safePos.y, { uuid: botId, alias, shipType: 'classic', lives: 1 });

    // Ensure initial physics state is upright and resting cleanly on pad
    const t = ecs.transforms.get(e);
    if (t) t.angle = -Math.PI / 2;

    const v = ecs.velocities.get(e);
    if (v) { v.vx = 0; v.vy = 0; v.angularVelocity = 0; }

    const p = ecs.players.get(e);
    if (p) p.isLanded = true;

    // Attach the brain
    ecs.bots.set(e, {
        active: true,
        role: 'pursuit',
        reactionTimer: 0,
        state: 'takeoff',
        stateTimer: 20,
        path: [],
        pathTimer: 0
    });

    return e;
}

export function sysBotAI(ecs: Registry, room: Room) {
    if (room.category !== 'dogfight') return;
    globalTickCounter++;

    const bots = Array.from(ecs.bots.entries());
    const activeBots = bots.filter(([e]) => !ecs.players.get(e)?.isDead);
    const humans = Array.from(ecs.players.entries()).filter(([e, p]) => !p.isDead && !ecs.bots.has(e));

    // Telemetry logs on crash
    for (const [e, bot] of bots) {
        const p = ecs.players.get(e);

        // PREVENT GHOST BULLETS: Release the trigger on dead bots so corpses don't keep firing
        if (p?.isDead && p.inputs) {
            p.inputs = { up: false, left: false, right: false, shoot: false };
        }

        if (p?.isDead && (bot as any).wasAlive) {
            (bot as any).wasAlive = false;
            if (SERVER_CONFIG.debugMode) {
                logDogfightCrash(ecs, room, e, bot, p, globalTickCounter);
            }
        } else if (p && !p.isDead) {
            (bot as any).wasAlive = true;
        }
    }

    const hostiles: { id: string, e: Entity, isHuman: boolean }[] = humans.map(([e, p]) => ({ id: p.id, e, isHuman: true }));

    for (const [ee, turret] of ecs.turrets.entries()) {
        if (!turret.active || turret.hp <= 0) continue;
        hostiles.push({ id: `turret_${ee}`, e: ee, isHuman: false });
    }
    for (const [ee, tank] of ecs.tanks.entries()) {
        if (!tank.active || tank.hp <= 0) continue;
        hostiles.push({ id: `tank_${ee}`, e: ee, isHuman: false });
    }
    for (const [ee, flying] of ecs.flyingEnemies.entries()) {
        if (!flying.active || flying.hp <= 0) continue;
        hostiles.push({ id: `flying_${ee}`, e: ee, isHuman: false });
    }

    assignSquadRoles(activeBots, hostiles, ecs);

    for (const [e, bot] of activeBots) {
        processBotFlight(ecs, room, e, bot);
    }
}

// ----------------------------------------------------------------------------
// Squad Role Assignment
// ----------------------------------------------------------------------------

function assignSquadRoles(bots: [Entity, import('../core/types').BotState][], hostiles: { id: string, e: Entity, isHuman: boolean }[], ecs: Registry) {
    if (hostiles.length === 0) return;

    const targetCounts = new Map<string, number>();

    for (const [e, bot] of bots) {
        if (bot.reactionTimer > 0) {
            bot.reactionTimer--;
            continue;
        }

        const myPos = ecs.transforms.get(e)!;
        let closestHuman: string | undefined;
        let minDist = Infinity;

        for (const target of hostiles) {
            const hPos = getEntityPos(ecs, target.e);
            if (!hPos) continue;
            const d = Math.hypot(hPos.x - myPos.x, hPos.y - myPos.y);
            let adjustedDist = target.isHuman ? d : d + 300;

            // TARGET STICKINESS: Keep hammering the same target until it dies instead of giving up after a 3-bullet burst
            if (target.id === bot.targetId) {
                adjustedDist -= 600;
            }

            if (adjustedDist < minDist) {
                minDist = adjustedDist;
                closestHuman = target.id;
            }
        }

        if (closestHuman) {
            bot.targetId = closestHuman;
            const currentAttackers = targetCounts.get(closestHuman) || 0;

            if (currentAttackers === 0) {
                bot.role = 'pursuit';
            } else if (currentAttackers === 1) {
                bot.role = 'flank-high';
            } else {
                bot.role = 'intercept';
            }

            targetCounts.set(closestHuman, currentAttackers + 1);
            bot.reactionTimer = 15;
        }
    }
}

// ----------------------------------------------------------------------------
// Flight Control & Navigation
// ----------------------------------------------------------------------------

function processBotFlight(ecs: Registry, room: Room, e: Entity, bot: import('../core/types').BotState) {
    const p = ecs.players.get(e)!;
    const t = ecs.transforms.get(e)!;
    const v = ecs.velocities.get(e)!;

    p.inputs = { up: false, left: false, right: false, shoot: false };

    if (p.isLanded) {
        bot.state = 'takeoff';
        bot.stateTimer = 20;
        p.inputs.up = true;
        applyAngularControl(p, t, v, -Math.PI / 2);
        return;
    }

    if (bot.state === 'takeoff') {
        const floorHit = raycastEnvironment({ x: t.x, y: t.y }, { x: t.x, y: t.y + 60 }, room.level);
        const ceilingHit = raycastEnvironment({ x: t.x, y: t.y }, { x: t.x, y: t.y - 60 }, room.level);
        const floorDist = floorHit ? floorHit.y - t.y : 999;
        const ceilingDist = ceilingHit ? t.y - ceilingHit.y : 999;

        if (ceilingDist < 45 || floorDist >= 22 || bot.stateTimer <= 0) {
            bot.state = 'attack';
        } else {
            bot.stateTimer--;
            p.inputs.up = true;
            applyAngularControl(p, t, v, -Math.PI / 2);
            return;
        }
    }

    const targetEntity = resolveTargetEntity(ecs, bot.targetId);
    if (bot.targetId && targetEntity === undefined) bot.targetId = undefined;
    const targetT = targetEntity !== undefined ? getEntityPos(ecs, targetEntity) : undefined;
    const targetV = targetEntity !== undefined ? getEntityVel(ecs, targetEntity) : undefined;

    let aimX = t.x;
    let aimY = t.y - 100;
    let hasLOS = false;
    let hasPredictedLOS = false;
    let angleToPredicted = 0;
    let distToTarget = 9999;

    if (targetT) {
        distToTarget = Math.hypot(targetT.x - t.x, targetT.y - t.y);
        const tVx = targetV?.vx || 0;
        const tVy = targetV?.vy || 0;

        hasLOS = !raycastEnvironment({ x: t.x, y: t.y }, { x: targetT.x, y: targetT.y }, room.level);

        // 1. WEAPONS FIRING LOGIC (RESTORED!)
        const BULLET_SPEED = 12.0;
        const leadTicks = Math.min(35, distToTarget / BULLET_SPEED);
        const predX = targetT.x + tVx * leadTicks;
        const predY = targetT.y + tVy * leadTicks;

        angleToPredicted = Math.atan2(predY - t.y, predX - t.x);
        hasPredictedLOS = !raycastEnvironment({ x: t.x, y: t.y }, { x: predX, y: predY }, room.level);

        const alignDiff = Math.abs(getAngleDiff(angleToPredicted, t.angle));
        let wantsToShoot = false;
        if (alignDiff < 0.6 && distToTarget < 800 && (hasLOS || hasPredictedLOS)) {
            wantsToShoot = true;
        } else if (distToTarget < 600 && hasLOS && Math.random() < 0.4) {
            wantsToShoot = true;
        }
        if (wantsToShoot) {
            p.inputs.shoot = (globalTickCounter % 4 !== 0);
        }

        // 2. PATH RECALCULATION
        if (bot.path.length === 0 || bot.pathTimer <= 0) {
            let stitchedPath: { x: number; y: number }[] | null = null;
            if (bot.targetId) {
                const cached = sharedTargetPaths.get(bot.targetId);
                if (cached && (globalTickCounter - cached.tick < 30) && cached.path.length > 0) {
                    let bestIndex = -1;
                    let minDist = Infinity;
                    for (let i = 0; i < cached.path.length; i++) {
                        const wp = cached.path[i];
                        const wpPx = { x: wp.x * 32 + 16, y: wp.y * 32 + 16 };
                        const d = Math.hypot(wpPx.x - t.x, wpPx.y - t.y);
                        if (d < minDist && hasClearPath({ x: t.x, y: t.y }, wpPx, room.level)) {
                            minDist = d;
                            bestIndex = i;
                        }
                    }
                    if (bestIndex !== -1) stitchedPath = cached.path.slice(bestIndex);
                }
            }

            if (!targetT) {
                bot.state = 'roam';
                bot.path = prunePath(generateRoamPath(room.level.rawMap, t.x, t.y), room, { x: t.x, y: t.y });
            } else if (stitchedPath && stitchedPath.length > 0) {
                bot.state = 'attack';
                bot.path = [...stitchedPath];
            } else {
                const rawPath = calculatePath(room.level.rawMap, t.x, t.y, targetT.x, targetT.y);
                const targetTileX = Math.floor(targetT.x / 32);
                const targetTileY = Math.floor(targetT.y / 32);
                const lastNode = rawPath[rawPath.length - 1];
                const reachedTarget = !!lastNode && lastNode.x === targetTileX && lastNode.y === targetTileY;

                if (!reachedTarget && distToTarget > 250 && !hasLOS) {
                    bot.state = 'roam';
                    bot.path = prunePath(generateRoamPath(room.level.rawMap, t.x, t.y), room, { x: t.x, y: t.y });
                } else {
                    bot.state = 'attack';
                    bot.path = prunePath(rawPath, room, { x: t.x, y: t.y });
                }

                if (bot.targetId && bot.path.length > 0 && bot.state === 'attack') {
                    sharedTargetPaths.set(bot.targetId, { path: [...bot.path], tick: globalTickCounter });
                }
            }
            bot.pathTimer = 90 + Math.floor(Math.random() * 30);
        }
        bot.pathTimer--;

        // 3. TARGET AIMING (LOS vs Pathing)
        if (hasLOS && distToTarget < 600) {
            // Ignore path if we can see them and are close
            aimX = targetT.x;
            aimY = targetT.y;
            if (bot.role === 'intercept') {
                aimX += tVx * 15;
                aimY += tVy * 15;
            } else if (bot.role === 'flank-high') {
                aimY -= 150;
            }
        } else {
            // Waypoint popping
            while (bot.path && bot.path.length > 1) {
                let wx0 = bot.path[0].x * 32 + 16;
                let wy0 = bot.path[0].y * 32 + 16;
                let wx1 = bot.path[1].x * 32 + 16;
                let wy1 = bot.path[1].y * 32 + 16;
                let d0 = Math.hypot(t.x - wx0, t.y - wy0);
                let d1 = Math.hypot(t.x - wx1, t.y - wy1);
                if (d0 < 45 || (d1 < d0 && d0 < 180 && hasClearPath({ x: t.x, y: t.y }, { x: wx1, y: wy1 }, room.level))) {
                    bot.path.shift();
                } else {
                    break;
                }
            }
            if (bot.path && bot.path.length === 1) {
                let wx0 = bot.path[0].x * 32 + 16;
                let wy0 = bot.path[0].y * 32 + 16;
                if (Math.hypot(t.x - wx0, t.y - wy0) < 45) {
                    bot.path.shift();
                }
            }

            if (bot.path && bot.path.length > 0) {
                let nextWp = bot.path[0];
                let wpX = nextWp.x * 32 + 16;
                let wpY = nextWp.y * 32 + 16;
                const map = room.level.rawMap;
                if (map && map[nextWp.y]) {
                    if (map[nextWp.y]?.[nextWp.x - 1] && TILE_DICTIONARY[map[nextWp.y][nextWp.x - 1]]?.solid) wpX += 14;
                    if (map[nextWp.y]?.[nextWp.x + 1] && TILE_DICTIONARY[map[nextWp.y][nextWp.x + 1]]?.solid) wpX -= 14;
                    if (map[nextWp.y - 1]?.[nextWp.x] && TILE_DICTIONARY[map[nextWp.y - 1][nextWp.x]]?.solid) wpY += 14;
                    if (map[nextWp.y + 1]?.[nextWp.x] && TILE_DICTIONARY[map[nextWp.y + 1][nextWp.x]]?.solid) wpY -= 14;
                }
                aimX = wpX;
                aimY = wpY;
            } else if (targetT) {
                aimX = targetT.x;
                aimY = targetT.y;
            }
        }
    }

    // 4. PHYSICS & NAVIGATION
    const dirX = aimX - t.x;
    const dirY = aimY - t.y;
    const distToAim = Math.hypot(dirX, dirY) || 1;

    const currentSpeed = Math.hypot(v.vx, v.vy);
    const botMoveAngle = currentSpeed > 1.0 ? Math.atan2(v.vy, v.vx) : t.angle;

    const turnTime = 36;
    const brakingAccel = 0.05;
    const stoppingDist = ((currentSpeed * currentSpeed) / (2 * brakingAccel)) + (currentSpeed * turnTime) + 40;

    let isEmergency = false;
    let repelX = 0;
    let repelY = 0;

    const tactics = evaluateTacticalSensors(ecs, e, t, v, bot, t.angle, distToAim);
    if (tactics.friendlyInLineOfFire) {
        p.inputs.shoot = false;
    }
    if (tactics.isEmergency) {
        isEmergency = true;
        repelX += tactics.repelX;
        repelY += tactics.repelY;
    }

    let isBlockedPocket = false;
    if (!hasClearPath({ x: t.x, y: t.y }, { x: aimX, y: aimY }, room.level)) {
        if (bot.path && bot.path.length > 0) {
            let checkX = bot.path[0].x * 32 + 16;
            let checkY = bot.path[0].y * 32 + 16;
            if (raycastEnvironment({ x: t.x, y: t.y }, { x: checkX, y: checkY }, room.level)) {
                isBlockedPocket = true;
            }
        } else {
            isBlockedPocket = true;
        }
    }

    let wallSeverity = isBlockedPocket ? 1.0 : 0.0;
    let isRetrograde = false;

    if (currentSpeed > 0.2 && !isBlockedPocket) {
        const ticksToAim = Math.floor(distToAim / Math.max(0.1, currentSpeed));
        const checkTicks = Math.min(45, Math.max(10, ticksToAim - 8));
        if (predictGlideCollision(t, v, checkTicks, room, 0)) {
            isRetrograde = true;
            wallSeverity = 1.0;
        }
    }

    if (wallSeverity >= 1.0 || isEmergency) {
        (bot as any).panicTimer = 30;
    }
    if ((bot as any).panicTimer > 0) {
        (bot as any).panicTimer--;
        wallSeverity = 1.0;
        isEmergency = true;
    }

    let trajectorySeverity = 0;
    if (currentSpeed > 2.0) {
        const pathAngle = Math.atan2(aimY - t.y, aimX - t.x);
        const driftDiff = Math.abs(getAngleDiff(pathAngle, botMoveAngle)) / Math.PI;
        trajectorySeverity = Math.min(1.0, Math.max(0, driftDiff - 0.1) * 2.0);
    }

    let pathSeverity = 0;
    if (bot.path && bot.path.length >= 2 && !hasLOS) {
        let prevAngle = Math.atan2((bot.path[0].y * 32 + 16) - t.y, (bot.path[0].x * 32 + 16) - t.x);
        let accumDist = Math.hypot((bot.path[0].x * 32 + 16) - t.x, (bot.path[0].y * 32 + 16) - t.y);
        const LOOKAHEAD_CURVE = 300;
        
        for (let i = 0; i < Math.min(bot.path.length - 1, 5); i++) {
            const segAngle = Math.atan2(bot.path[i+1].y - bot.path[i].y, bot.path[i+1].x - bot.path[i].x);
            const turnDiff = Math.abs(getAngleDiff(segAngle, prevAngle));
            if (turnDiff > 0.3) {
                const discount = Math.max(0, 1.0 - (accumDist / LOOKAHEAD_CURVE));
                const severity = Math.min(1.0, (turnDiff / Math.PI) * 1.6) * discount;
                if (severity > pathSeverity) pathSeverity = severity;
            }
            accumDist += Math.hypot(bot.path[i+1].x - bot.path[i].x, bot.path[i+1].y - bot.path[i].y) * 32;
            if (accumDist > LOOKAHEAD_CURVE) break;
            prevAngle = segAngle;
        }
    }

    const clampedSeverity = Math.min(1.0, Math.max(trajectorySeverity, wallSeverity, pathSeverity));

    const maxCruise = 6.0 * tactics.throttleMultiplier;
    let targetSpeed = maxCruise * (1.0 - clampedSeverity);

    // KITING & STANDOFF BRAKES: Maintain optimal firing distance when we have LOS
    if (targetT && (hasLOS || hasPredictedLOS)) {
        if (distToTarget < 250) {
            targetSpeed = -2.5; // Danger close: aggressive backpedal
        } else if (distToTarget < 450) {
            targetSpeed = 0.0; // Sweet spot: kill relative velocity, hover and blast
        } else if (distToTarget < 700) {
            targetSpeed = 3.0; // Coast in slowly to maintain range
        }
    }

    const desVx = (dirX / distToAim) * targetSpeed;
    const desVy = (dirY / distToAim) * targetSpeed;

    const forceX = desVx - v.vx + repelX;
    const forceY = desVy - v.vy - 0.010 + repelY; // Classic gravity is 0.010

    const aimForceAngle = Math.atan2(forceY, forceX);
    let steerAngle = aimForceAngle;
    const reqForce = Math.hypot(forceX, forceY);

    if (isRetrograde) {
        steerAngle = Math.atan2(-v.vy, -v.vx); // Pure retrograde
    } else if (currentSpeed < 0.5 && isBlockedPocket) {
        steerAngle = -Math.PI / 2; // Ascend if stuck hovering in a pocket
    } else if (targetT && (hasLOS || hasPredictedLOS) && distToTarget < 700 && wallSeverity < 0.5 && !isEmergency) {
        // Dogfight Aim Override: Point weapons at target if safe!
        // If we desperately need to fight gravity or brake (reqForce > 1.2), we must abandon shooting to recover flight control
        if (reqForce < 1.2 || Math.abs(getAngleDiff(aimForceAngle, angleToPredicted)) < 0.8) {
            steerAngle = angleToPredicted;
        }
    }

    (bot as any).lastDesiredAngle = steerAngle;

    const angleDiff = applyAngularControl(p, t, v, steerAngle);

    let thrustCone = 0.4;
    if (isRetrograde) thrustCone = 1.5;
    else if (wallSeverity >= 1.0 || isEmergency) thrustCone = 1.0;
    else if (reqForce > 4.0) thrustCone = 1.0;
    else if (reqForce > 1.5) thrustCone = 0.7;

    // If we are steering to shoot, we must evaluate thrust based on our intended travel vector, not our weapon aiming vector!
    const thrustAngleDiff = (wallSeverity >= 1.0 || isEmergency || isRetrograde) ? angleDiff : Math.abs(getAngleDiff(aimForceAngle, t.angle));

    if (thrustAngleDiff < thrustCone && (reqForce > 0.05 || wallSeverity >= 1.0 || isRetrograde)) {
        p.inputs.up = true;
    }

    if (bot.path.length === 0 && distToTarget > 250 && !hasLOS) {
        bot.pathTimer = 0;
    }

    let currentPathOffset = 0;
    if (bot.path && bot.path.length > 0) {
        currentPathOffset = Math.hypot(t.x - (bot.path[0].x * 32 + 16), t.y - (bot.path[0].y * 32 + 16));
    }

    if (!(bot as any).flightRecorder) (bot as any).flightRecorder = [];
    const rec = (bot as any).flightRecorder;
    rec.push({
        tick: globalTickCounter,
        x: Math.round(t.x), y: Math.round(t.y),
        vx: Number(v.vx.toFixed(2)), vy: Number(v.vy.toFixed(2)),
        speed: Number(currentSpeed.toFixed(2)),
        facingDeg: Number((t.angle * 180 / Math.PI).toFixed(1)),
        desiredDeg: Number((steerAngle * 180 / Math.PI).toFixed(1)),
        thrust: Boolean(p.inputs.up),
        safe: wallSeverity < 0.5 && !isEmergency,
        targetSpeed: Number(targetSpeed.toFixed(2)),
        pathOffset: Math.round(currentPathOffset),
        distToAim: Math.round(distToAim)
    });
    if (rec.length > 240) rec.shift();
}
