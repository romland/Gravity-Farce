import { Registry, type Entity } from '../core/ecs';
import type { Room } from '../Room';
import { spawnClassicPlayer } from './player-classic';
import { SERVER_CONFIG } from '../core/config';
import { TILE_DICTIONARY } from '../core/tiles';
import { applyAngularControl, getAngleDiff, hasClearPath, prunePath, calculatePath, findSafePadPosition, logDogfightCrash, predictGlideCollision } from './bot-utils';
import { evaluateTacticalSensors } from './bot-sensors';

const BOT_UUID_PREFIX = 'MBOT_';
let globalTickCounter = 0;

export function spawnMissionBot(ecs: Registry, x: number, y: number, alias: string, level?: import('../core/types').LevelData): Entity {
    const safePos = findSafePadPosition(level, x, y);
    const botId = BOT_UUID_PREFIX + alias;
    const e = spawnClassicPlayer(ecs, botId, safePos.x, safePos.y, { uuid: botId, alias, shipType: 'classic', lives: 5 });

    const t = ecs.transforms.get(e);
    if (t) t.angle = -Math.PI / 2;

    const v = ecs.velocities.get(e);
    if (v) { v.vx = 0; v.vy = 0; v.angularVelocity = 0; }

    const p = ecs.players.get(e);
    if (p) p.isLanded = true;

    ecs.bots.set(e, {
        active: true,
        role: 'mission',
        reactionTimer: 0,
        state: 'takeoff',
        stateTimer: 20,
        path: [],
        pathTimer: 0
    });

    return e;
}

export function sysMissionBotAI(ecs: Registry, room: Room) {
    if (room.category !== 'mission') return;
    globalTickCounter++;

    const bots = Array.from(ecs.bots.entries()).filter(([, bot]) => bot.role === 'mission');
    for (const [e, bot] of bots) {
        const p = ecs.players.get(e);
        if (p?.isDead && p.inputs) p.inputs = { up: false, left: false, right: false, shoot: false };

        if (p?.isDead && (bot as any).wasAlive) {
            (bot as any).wasAlive = false;
            if (SERVER_CONFIG.debugMode) logDogfightCrash(ecs, room, e, bot, p, globalTickCounter, true);
        } else if (p && !p.isDead) {
            (bot as any).wasAlive = true;
            processMissionFlight(ecs, room, e, bot);
        }
    }
}

function processMissionFlight(ecs: Registry, room: Room, e: Entity, bot: import('../core/types').BotState) {
    const p = ecs.players.get(e)!;
    const t = ecs.transforms.get(e)!;
    const v = ecs.velocities.get(e)!;
    const inv = ecs.cargoBays.get(e);

    if (p.advancing) {
        p.inputs = { up: false, left: false, right: false, shoot: false };
        return;
    }

    p.inputs = { up: false, left: false, right: false, shoot: false };

    const availableMapCargo = Array.from(ecs.cargos.values()).filter(c => c.active);
    const currentWeight = inv ? inv.stack.reduce((sum, id) => sum + (id === 0xD1 ? 1 : 2), 0) : 0;

    if (p.isLanded) {
        const isAtStartBase = Math.hypot(t.x - p.spawnX, t.y - p.spawnY) < 150;
        
        if (inv && inv.stack.length > 0) {
            if (isAtStartBase) {
                bot.state = 'land_base';
                return; // Wait for the cargo unloading system to process our crates
            }
        }
        
        const missionDone = availableMapCargo.length === 0 && currentWeight === 0;
        if (missionDone) {
            const pads = room.level.entities.filter(ent => ent.type === 'pad' && ent.props?.isEndPad);
            let isAtEndPad = false;
            for (const pad of pads) {
                if (t.x >= pad.x - 10 && t.x <= pad.x + (pad.w || 32) + 10) isAtEndPad = true;
            }
            
            if ((pads.length > 0 && isAtEndPad) || (pads.length === 0 && isAtStartBase)) {
                bot.state = 'land_base';
                return; // Mission accomplished, chill on the pad
            }
        }

        bot.state = 'takeoff';
        bot.stateTimer = 25;
        p.inputs.up = true;
        applyAngularControl(p, t, v, -Math.PI / 2);
        return;
    }

    if (bot.state === 'takeoff') {
        bot.stateTimer--;
        p.inputs.up = true;
        applyAngularControl(p, t, v, -Math.PI / 2);
        if (bot.stateTimer <= 0) bot.state = 'seek_cargo';
        return;
    }

    // 1. Determine Target Objective
    let targetType: 'cargo' | 'base' | 'end' | 'roam' = 'roam';
    let targetObj: {x: number, y: number} | null = null;

    if (currentWeight >= 3 || (currentWeight > 0 && availableMapCargo.length === 0)) {
        targetType = 'base';
        targetObj = { x: p.spawnX, y: p.spawnY };
    } else if (availableMapCargo.length > 0) {
        targetType = 'cargo';
        let minDist = Infinity;
        for (const c of availableMapCargo) {
            if (currentWeight + c.weight <= 3) {
                const cargoEntry = Array.from(ecs.cargos.entries()).find(([, val]) => val === c);
                if (cargoEntry) {
                    const ct = ecs.transforms.get(cargoEntry[0]);
                    if (ct) {
                        const d = Math.hypot(ct.x - t.x, ct.y - t.y);
                        if (d < minDist) { minDist = d; targetObj = { x: ct.x, y: ct.y }; }
                    }
                }
            }
        }
        if (!targetObj && currentWeight > 0) {
            targetType = 'base';
            targetObj = { x: p.spawnX, y: p.spawnY };
        }
    } else {
        const pads = room.level.entities.filter(ent => ent.type === 'pad' && ent.props?.isEndPad);
        if (pads.length > 0) {
            targetType = 'end';
            const pad = pads[0];
            targetObj = { x: pad.x + (pad.w || 32) / 2, y: pad.y };
        }
    }

    if (!targetObj) {
        bot.state = 'roam';
        targetObj = { x: p.spawnX, y: p.spawnY }; 
    }

    const distToTarget = Math.hypot(targetObj.x - t.x, targetObj.y - t.y);

    // 2. Pathfinding
    if (bot.path && bot.path.length > 0) {
        const nextX = bot.path[0].x * 32 + 16;
        const nextY = bot.path[0].y * 32 + 16;
        if (!hasClearPath({x: t.x, y: t.y}, {x: nextX, y: nextY}, room.level)) {
            bot.pathTimer = 0; // Force recalculation if we drifted behind a wall!
            bot.path = [];
        }
    }

    if (bot.pathTimer <= 0 || bot.path.length === 0) {
        const rawPath = calculatePath(room.level.rawMap!, t.x, t.y, targetObj.x, targetObj.y);
        bot.path = prunePath(rawPath, room, { x: t.x, y: t.y });
        bot.pathTimer = 60;
    }
    bot.pathTimer--;

    bot.state = 'seek_cargo';
    let isLandingFinal = false;

    // 3. Landing Approach Injection
    if ((targetType === 'base' || targetType === 'cargo' || targetType === 'end') && distToTarget < 200 && hasClearPath({x: t.x, y: t.y}, {x: targetObj.x, y: targetObj.y - 20}, room.level)) {
        const dx = targetObj.x - t.x;
        const dy = targetObj.y - t.y;

        if (dy > 70 || Math.abs(dx) > 30) {
            bot.state = 'land_approach';
            targetObj = { x: targetObj.x, y: targetObj.y - 70 }; // Override aim point to hover above
        } else {
            bot.state = 'land_final';
            isLandingFinal = true;
        }
        if (bot.path.length > 0) bot.path = [];
    }

    // 4. Standard Navigation
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
        if (Math.hypot(t.x - wx0, t.y - wy0) < 45) bot.path.shift();
    }

    let aimX = targetObj.x;
    let aimY = targetObj.y;
    if (bot.path && bot.path.length > 0) {
        let nextWp = bot.path[0];
        let wpX = nextWp.x * 32 + 16;
        let wpY = nextWp.y * 32 + 16;
        const map = room.level.rawMap;
        if (map && map[nextWp.y]) {
            // Apex smoothing: push waypoints away from hard corners
            if (map[nextWp.y]?.[nextWp.x - 1] && TILE_DICTIONARY[map[nextWp.y][nextWp.x - 1]]?.solid) wpX += 14;
            if (map[nextWp.y]?.[nextWp.x + 1] && TILE_DICTIONARY[map[nextWp.y][nextWp.x + 1]]?.solid) wpX -= 14;
            if (map[nextWp.y - 1]?.[nextWp.x] && TILE_DICTIONARY[map[nextWp.y - 1][nextWp.x]]?.solid) wpY += 14;
            if (map[nextWp.y + 1]?.[nextWp.x] && TILE_DICTIONARY[map[nextWp.y + 1][nextWp.x]]?.solid) wpY -= 14;
        }
        aimX = wpX;
        aimY = wpY;
    }

    const currentSpeed = Math.hypot(v.vx, v.vy);
    const dirX = aimX - t.x;
    const dirY = aimY - t.y;
    const distToAim = Math.hypot(dirX, dirY) || 1;

    const botMoveAngle = currentSpeed > 1.0 ? Math.atan2(v.vy, v.vx) : t.angle;
    let trajectorySeverity = 0;
    if (currentSpeed > 1.5) {
        const pathAngle = Math.atan2(dirY, dirX);
        const driftDiff = Math.abs(getAngleDiff(pathAngle, botMoveAngle)) / Math.PI;
        trajectorySeverity = Math.min(1.0, Math.max(0, driftDiff - 0.1) * 2.0);
    }

    let pathSeverity = 0;
    if (bot.path && bot.path.length >= 2) {
        let prevAngle = Math.atan2((bot.path[0].y * 32 + 16) - t.y, (bot.path[0].x * 32 + 16) - t.x);
        const segAngle = Math.atan2((bot.path[1].y * 32 + 16) - (bot.path[0].y * 32 + 16), (bot.path[1].x * 32 + 16) - (bot.path[0].x * 32 + 16));
        const turnDiff = Math.abs(getAngleDiff(segAngle, prevAngle));
        if (turnDiff > 0.3) pathSeverity = Math.min(1.0, (turnDiff / Math.PI) * 1.5);
    }

    const clampedSeverity = Math.min(1.0, Math.max(trajectorySeverity, pathSeverity));
    let targetSpeed = 4.5 * (1.0 - clampedSeverity); // Dynamic cruise speed

    if (bot.state === 'land_approach') {
        // Brake smoothly as we align horizontally to prevent pendulum overshoots
        targetSpeed = Math.min(2.5, Math.max(0.5, Math.abs(targetObj.x - t.x) * 0.05));
    }
    if (bot.state === 'land_final') targetSpeed = 0.5;
    

    let isEmergency = false;
    let repelX = 0;
    let repelY = 0;

    const tactics = evaluateTacticalSensors(ecs, e, t, v, bot);
    if (tactics.isEmergency) isEmergency = true;
    repelX += tactics.repelX;
    repelY += tactics.repelY;

    const desVx = (dirX / distToAim) * targetSpeed;
    const desVy = (dirY / distToAim) * targetSpeed;
    const weightGravity = 0.010 * (1.0 + (currentWeight * 0.40)); // Match classic physics gravity scaling
    const forceX = desVx - v.vx + repelX;
    const forceY = desVy - v.vy - weightGravity + repelY; // Compensate for dynamic cargo weight!

    const aimForceAngle = Math.atan2(forceY, forceX);
    let steerAngle = aimForceAngle;
    
    let isRetrograde = false;
    // Anticipate walls along our trajectory to prevent blind crashes
    if (!isLandingFinal && currentSpeed > 0.2) {
        const ticksToAim = Math.floor(distToAim / Math.max(0.1, currentSpeed));
        const checkTicks = Math.min(45, Math.max(10, ticksToAim - 8));
        if (predictGlideCollision(t, v, checkTicks, room, currentWeight)) {
            steerAngle = Math.atan2(-v.vy, -v.vx); // Retrograde burn if heading towards a wall
			isRetrograde = true;
		}
    }

    if (isLandingFinal) {
        steerAngle = -Math.PI / 2; // Force upright
        const dx = targetObj.x - t.x;
        if (dx < -4) steerAngle -= 0.12; // Gentle left tilt
        if (dx > 4) steerAngle += 0.12;  // Gentle right tilt
    }

    // Hostile clearing & Turret aiming
    const hostiles = Array.from(ecs.turrets.entries()).concat(Array.from(ecs.flyingEnemies.entries()) as any).concat(Array.from(ecs.tanks.entries()) as any);
    for(const [ee, ent] of hostiles) {
        if (!(ent as any).active || (ent as any).hp <= 0) continue;
        const et = ecs.transforms.get(ee);
        if (!et) continue;
        const hd = Math.hypot(et.x - t.x, et.y - t.y);
        if (hd < 350 && hasClearPath({x: t.x, y: t.y}, {x: et.x, y: et.y}, room.level)) {
            const angleToH = Math.atan2(et.y - t.y, et.x - t.x);
            
            // If we are relatively safe and not trying to land, override steering to aim at the target
            if (!isRetrograde && !isEmergency && !isLandingFinal && Math.hypot(repelX, repelY) < 1.0) {
                steerAngle = angleToH;
            }

            // Shoot if our nose is generally pointed at them!
            if (Math.abs(getAngleDiff(t.angle, angleToH)) < 0.3) {
                p.inputs.shoot = (globalTickCounter % 4 !== 0);
            }
        }
    }

    const reqForce = Math.hypot(forceX, forceY);
    const angleDiff = applyAngularControl(p, t, v, steerAngle);
    
    // Decouple thrust decisions from steering so we don't accidentally thrust into a turret while aiming at it
    const thrustAngleDiff = (isLandingFinal || isRetrograde || isEmergency) ? angleDiff : Math.abs(getAngleDiff(aimForceAngle, t.angle));
    
    let thrustCone = 0.8;
    if (isRetrograde) thrustCone = 1.5;
    else if (isLandingFinal) thrustCone = 0.3;
    else if (isEmergency) thrustCone = 1.0;

    if (isRetrograde) {
        if (angleDiff < thrustCone) {
            p.inputs.up = true;
        }
    } else if (isLandingFinal) {
        if (angleDiff < thrustCone) {
            if (v.vy > 1.5) p.inputs.up = true;
            else if (targetObj.y - t.y < 15 && v.vy > 0.4) p.inputs.up = true;
            else if (Math.abs(targetObj.x - t.x) > 3 && v.vy > 0.3) p.inputs.up = true;
        } else {
            if (v.vy > 1.8) p.inputs.up = true; // Emergency catch
        }
    } else if (thrustAngleDiff < thrustCone && (reqForce > 0.1 || isEmergency)) {
        p.inputs.up = true;
    }

    // Flight recorder telemetry
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
        safe: !isEmergency,
        targetSpeed: Number(targetSpeed.toFixed(2)),
        pathOffset: 0,
        distToAim: Math.round(distToAim)
    });
    if (rec.length > 240) rec.shift();
}