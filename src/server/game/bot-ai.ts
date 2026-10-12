// spawnDogfightBot(room.ecs, x, y, "A.I.")
import { Registry, type Entity } from '../core/ecs';
import type { Room } from '../Room';
import { raycastEnvironment } from '../core/math';
import { spawnModernPlayer } from './player-modern';
import { TILE_DICTIONARY } from '../core/tiles';
import { SERVER_CONFIG } from '../core/config';

// Bot Constants
const PREDICTION_FRAMES = 15;
const BOT_UUID_PREFIX = 'BOT_';

export function spawnDogfightBot(ecs: Registry, x: number, y: number, alias: string, level?: import('../core/types').LevelData): Entity {
    const safePos = findSafePadPosition(level, x, y, alias);
    const botId = BOT_UUID_PREFIX + alias;
    const e = spawnModernPlayer(ecs, botId, safePos.x, safePos.y, { uuid: botId, alias, shipType: 'modern' });
    
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
        stateTimer: 25,
        path: [],
        pathTimer: 0
    });
    
    return e;
}

export function sysBotAI(ecs: Registry, room: Room) {
    if (room.category !== 'dogfight') return;

    const bots = Array.from(ecs.bots.entries());
    const activeBots = bots.filter(([e]) => !ecs.players.get(e)?.isDead);
    const humans = Array.from(ecs.players.entries()).filter(([e, p]) => !p.isDead && !ecs.bots.has(e));

    // Log ASCII map and crash telemetry only when a bot actually dies
    for (const [e, bot] of bots) {
        const p = ecs.players.get(e);
        if (p?.isDead && (bot as any).wasAlive) {
            (bot as any).wasAlive = false;
            if (SERVER_CONFIG.debugMode) {
                const t = ecs.transforms.get(e);
                console.log(`[BOT-AI] ${p.alias} CRASHED at tile (${Math.floor((t?.x||0)/32)}, ${Math.floor((t?.y||0)/32)})!`);
                if (t && bot.targetId) {
                    const targetE = ecs.getPlayerEntity(bot.targetId);
                    const targetT = targetE ? ecs.transforms.get(targetE) : undefined;
                    if (targetT) dumpAsciiMap(room, t.x, t.y, targetT.x, targetT.y, bot.path, p.alias);
                }
            }
        } else if (p && !p.isDead) {
            (bot as any).wasAlive = true;
        }
    }

    assignSquadRoles(activeBots, humans, ecs);

    for (const [e, bot] of activeBots) {
        processBotFlight(ecs, room, e, bot);
    }
}

// ----------------------------------------------------------------------------
// Small Methods: High-Level Squad Logic
// ----------------------------------------------------------------------------

function assignSquadRoles(bots: [Entity, import('../core/types').BotState][], humans: [Entity, import('../core/ecs').Player][], ecs: Registry) {
    if (humans.length === 0) return;

    const targetCounts = new Map<string, number>();

    for (const [e, bot] of bots) {
        if (bot.reactionTimer > 0) {
            bot.reactionTimer--;
            continue;
        }

        const myPos = ecs.transforms.get(e)!;
        
        let closestHuman: string | undefined;
        let minDist = Infinity;

        for (const [he, hp] of humans) {
            const hPos = ecs.transforms.get(he)!;
            const d = Math.hypot(hPos.x - myPos.x, hPos.y - myPos.y);
            if (d < minDist) {
                minDist = d;
                closestHuman = hp.id;
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
// Small Methods: Low-Level Flight & Steering
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
        return;
    }

    if (bot.state === 'takeoff') {
        const floorHit = raycastEnvironment({ x: t.x, y: t.y }, { x: t.x, y: t.y + 60 }, room.level);
        const ceilingHit = raycastEnvironment({ x: t.x, y: t.y }, { x: t.x, y: t.y - 60 }, room.level);
        const floorDist = floorHit ? floorHit.y - t.y : 999;
        const ceilingDist = ceilingHit ? t.y - ceilingHit.y : 999;

        if (ceilingDist < 35 || floorDist > 22 || bot.stateTimer <= 0) {
            bot.state = 'attack';
        } else {
            bot.stateTimer--;
            p.inputs.up = true;
            applyAngularControl(p, t, v, -Math.PI / 2);
            return;
        }
    }

    const targetEntity = bot.targetId ? ecs.getPlayerEntity(bot.targetId) : undefined;
    const targetT = targetEntity !== undefined ? ecs.transforms.get(targetEntity) : undefined;
    const targetV = targetEntity !== undefined ? ecs.velocities.get(targetEntity) : undefined;

    let aimX = t.x;
    let aimY = t.y - 100;
    let hasLOS = false;
    let hasPredictedLOS = false;
    let angleToPredicted = 0;

    if (targetT && targetV) {
        const dist = Math.hypot(targetT.x - t.x, targetT.y - t.y);

        if (bot.path.length === 0 || bot.pathTimer <= 0) {
            const rawPath = calculatePath(room.level.rawMap, t.x, t.y, targetT.x, targetT.y);
            const targetTileX = Math.floor(targetT.x / 32);
            const targetTileY = Math.floor(targetT.y / 32);
            const lastNode = rawPath[rawPath.length - 1];
            const reachedTarget = !!lastNode && lastNode.x === targetTileX && lastNode.y === targetTileY;

            if (!reachedTarget && dist > 250 && !hasLOS) {
                bot.state = 'roam';
                bot.path = prunePath(generateRoamPath(room.level.rawMap, t.x, t.y), room, { x: t.x, y: t.y });
            } else {
                bot.state = 'attack';
                bot.path = prunePath(rawPath, room, { x: t.x, y: t.y });
            }
            bot.pathTimer = 90 + Math.floor(Math.random() * 30);
            if (SERVER_CONFIG.debugMode) {
                console.log(`[BOT-AI] ${p.alias} Path Recalc (State: ${bot.state}): ${bot.path.length} nodes (raw ${rawPath.length}, reached: ${reachedTarget}). Dist: ${Math.round(dist)}`);
            }
        }
        bot.pathTimer--;

        if (bot.path && bot.path.length > 0) {
            let nextWp = bot.path[0];
            
            let wpX = nextWp.x * 32 + 16;
            let wpY = nextWp.y * 32 + 16;
            const map = room.level.rawMap;
            if (map && map[nextWp.y]) {
                if (map[nextWp.y]?.[nextWp.x - 1] && TILE_DICTIONARY[map[nextWp.y][nextWp.x - 1]]?.solid) wpX += 8;
                if (map[nextWp.y]?.[nextWp.x + 1] && TILE_DICTIONARY[map[nextWp.y][nextWp.x + 1]]?.solid) wpX -= 8;
                if (map[nextWp.y - 1]?.[nextWp.x] && TILE_DICTIONARY[map[nextWp.y - 1][nextWp.x]]?.solid) wpY += 8;
                if (map[nextWp.y + 1]?.[nextWp.x] && TILE_DICTIONARY[map[nextWp.y + 1][nextWp.x]]?.solid) wpY -= 8;
            }
            
            aimX = wpX;
            aimY = wpY;

            if (Math.hypot(aimX - t.x, aimY - t.y) < 32) {
                const popped = bot.path.shift();
                if (SERVER_CONFIG.debugMode && popped) {
                    console.log(`[BOT-AI] ${p.alias} Reached Waypoint (${popped.x}, ${popped.y}). Remaining: ${bot.path.length}`);
                }
                if (bot.path.length > 0) {
                    nextWp = bot.path[0];
                    aimX = nextWp.x * 32 + 16;
                    aimY = nextWp.y * 32 + 16;
                }
            }
        } else {
            aimX = targetT.x;
            aimY = targetT.y;
            if (bot.role === 'intercept') {
                aimX += targetV.vx * PREDICTION_FRAMES;
                aimY += targetV.vy * PREDICTION_FRAMES;
            } else if (bot.role === 'flank-high') {
                aimY -= 150;
            }
        }

        const BULLET_SPEED = 12.0;
        const leadTicks = Math.min(35, dist / BULLET_SPEED);
        const predX = targetT.x + targetV.vx * leadTicks;
        const predY = targetT.y + targetV.vy * leadTicks;
        
        angleToPredicted = Math.atan2(predY - t.y, predX - t.x);
        hasLOS = !raycastEnvironment({ x: t.x, y: t.y }, { x: targetT.x, y: targetT.y }, room.level);
        hasPredictedLOS = !raycastEnvironment({ x: t.x, y: t.y }, { x: predX, y: predY }, room.level);

        const alignDiff = Math.abs(getAngleDiff(angleToPredicted, t.angle));
        if (alignDiff < 0.35 && dist < 600 && (hasLOS || hasPredictedLOS)) {
            p.inputs.shoot = true;
        } else if (dist < 400 && hasLOS && Math.random() < 0.15) {
            p.inputs.shoot = true;
        }
    }

    const dirX = aimX - t.x;
    const dirY = aimY - t.y;
    const distToAim = Math.hypot(dirX, dirY) || 1;
    
    const straightawayDist = getStraightawayDistance(t, bot.path, room);
    const maxCruise = straightawayDist > 120 ? 4.5 : 2.0;
    const cruiseSpeed = Math.min(maxCruise, distToAim / 20);

    const velSpeed = Math.hypot(v.vx, v.vy);
    const normDirX = dirX / distToAim;
    const normDirY = dirY / distToAim;
    
    const velDotTarget = velSpeed > 0.5 ? (v.vx * normDirX + v.vy * normDirY) / velSpeed : 1.0;

    let forceX = normDirX * cruiseSpeed - v.vx;
    let forceY = normDirY * cruiseSpeed - v.vy - 1.2;

    const velMag = Math.hypot(v.vx, v.vy);
    const moveAngle = velMag > 0.5 ? Math.atan2(v.vy, v.vx) : t.angle;
    const RAY_DIST = 120;
    let isEmergency = false;
    let repelX = 0;
    let repelY = 0;

    const testAngles = [moveAngle, moveAngle - 0.4, moveAngle + 0.4, moveAngle - 0.8, moveAngle + 0.8];
    for (const ang of testAngles) {
        const hit = raycastEnvironment({ x: t.x, y: t.y }, { x: t.x + Math.cos(ang) * RAY_DIST, y: t.y + Math.sin(ang) * RAY_DIST }, room.level);
        if (hit) {
            const d = Math.hypot(hit.x - t.x, hit.y - t.y);
            const effectiveD = Math.max(1, d - 16);
            if (effectiveD < RAY_DIST) {
                const panic = Math.pow((RAY_DIST - effectiveD) / RAY_DIST, 2);
                repelX -= Math.cos(ang) * panic * 8.0;
                repelY -= Math.sin(ang) * panic * 8.0;
                isEmergency = true;
            }
        }
    }

    if (isEmergency) {
        forceX += repelX;
        forceY += repelY;
    }

    const currentSpeed = Math.hypot(v.vx, v.vy);

    const glideTicks = Math.min(25, Math.floor(currentSpeed * 6) + 10);
    const isGlidePathSafe = currentSpeed > 1.0 && !predictGlideCollision(t, v, glideTicks, room);
    const headingDiff = velSpeed > 0.5 ? Math.abs(getAngleDiff(Math.atan2(v.vy, v.vx), Math.atan2(dirY, dirX))) : 0;

    const isHeadingToCollision = !isGlidePathSafe && currentSpeed > 1.0;
    const needsRetroBrake = (isEmergency && velSpeed > 0.8) || (isHeadingToCollision && velSpeed > 0.8) || (velSpeed > 1.2 && velDotTarget < 0.2);

    const navAngle = Math.atan2(forceY, forceX);
    const wantsToAimAtTarget = targetT !== undefined && distToAim > 0 && (hasLOS || hasPredictedLOS) && distToAim < 500 && !isEmergency;

    let desiredAngle: number;
    if (needsRetroBrake) {
        desiredAngle = Math.atan2(-v.vy, -v.vx);
    } else if (wantsToAimAtTarget && isGlidePathSafe && currentSpeed > 1.0) {
        desiredAngle = angleToPredicted;
    } else {
        desiredAngle = navAngle;
    }

    const angleDiff = applyAngularControl(p, t, v, desiredAngle);
    const thrustCone = needsRetroBrake ? 1.2 : (isEmergency ? 1.2 : 0.5);

    const flightAlignDiff = Math.abs(getAngleDiff(desiredAngle, navAngle));
    const isAimingOffCourse = wantsToAimAtTarget && desiredAngle === angleToPredicted && flightAlignDiff > 0.6;

    const needsThrust = !isAimingOffCourse && (
        isEmergency ||
        !isGlidePathSafe ||
        needsRetroBrake ||
        (currentSpeed < maxCruise * 0.7 && headingDiff < 0.4) ||
        currentSpeed < 0.8 ||
        velDotTarget < 0.4
    );

    if (angleDiff < thrustCone && needsThrust) {
        p.inputs.up = true;
    }
}

function applyAngularControl(p: import('../core/types').Player, t: import('../core/ecs').Transform, v: import('../core/ecs').Velocity, desiredAngle: number): number {
    const diff = getAngleDiff(desiredAngle, t.angle);
    const Kp = 0.15;
    const Kd = 1.0;
    const angVel = (p as any).angleStep || (p as any).angularVelocity || (v as any).angularVelocity || 0;
    const desiredAngVel = diff * Kp;
    const torque = desiredAngVel - angVel * Kd;

    if (torque < -0.001) p.inputs.left = true;
    else if (torque > 0.001) p.inputs.right = true;

    return Math.abs(diff);
}

function predictGlideCollision(t: {x: number, y: number}, v: {vx: number, vy: number}, ticks: number, room: Room): boolean {
    const GRAVITY = 0.12;
    let prevX = t.x;
    let prevY = t.y;
    const step = 5;
    for (let k = step; k <= ticks; k += step) {
        const curX = t.x + v.vx * k;
        const curY = t.y + v.vy * k + 0.5 * GRAVITY * k * k;
        if (!hasClearPath({ x: prevX, y: prevY }, { x: curX, y: curY }, room.level)) {
            return true;
        }
        prevX = curX;
        prevY = curY;
    }
    return false;
}

function getStraightawayDistance(t: {x: number, y: number}, path: {x: number, y: number}[], room: Room): number {
    if (!path || path.length === 0) return 0;
    let dist = 0;
    let lastPos = { x: t.x, y: t.y };

    for (let i = 0; i < Math.min(path.length, 3); i++) {
        const wpPos = { x: path[i].x * 32 + 16, y: path[i].y * 32 + 16 };
        if (hasClearPath(lastPos, wpPos, room.level)) {
            dist += Math.hypot(wpPos.x - lastPos.x, wpPos.y - lastPos.y);
            lastPos = wpPos;
        } else {
            break;
        }
    }
    return dist;
}

function getAngleDiff(target: number, current: number): number {
    let diff = target - current;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    return diff;
}

function hasClearPath(p1: {x: number, y: number}, p2: {x: number, y: number}, level: import('../core/types').LevelData): boolean {
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len;
    const ny = dx / len;
    const margin = 15;

    if (raycastEnvironment(p1, p2, level)) return false;
    if (raycastEnvironment({x: p1.x + nx * margin, y: p1.y + ny * margin}, {x: p2.x + nx * margin, y: p2.y + ny * margin}, level)) return false;
    if (raycastEnvironment({x: p1.x - nx * margin, y: p1.y - ny * margin}, {x: p2.x - nx * margin, y: p2.y - ny * margin}, level)) return false;

    return true;
}

function prunePath(rawPath: {x: number, y: number}[], room: Room, botPos?: {x: number, y: number}): {x: number, y: number}[] {
    if (rawPath.length === 0) return [];
    if (rawPath.length <= 2) return [...rawPath];

    let startIdx = 0;
    if (botPos) {
        for (let i = Math.min(rawPath.length - 1, 8); i >= 0; i--) {
            const nodePos = { x: rawPath[i].x * 32 + 16, y: rawPath[i].y * 32 + 16 };
            if (hasClearPath(botPos, nodePos, room.level)) {
                startIdx = i;
                break;
            }
        }
    }

    const pruned: {x: number, y: number}[] = [rawPath[startIdx]];
    let current = startIdx;

    while (current < rawPath.length - 1) {
        let next = rawPath.length - 1;
        while (next > current + 1) {
            const p1 = { x: rawPath[current].x * 32 + 16, y: rawPath[current].y * 32 + 16 };
            const p2 = { x: rawPath[next].x * 32 + 16, y: rawPath[next].y * 32 + 16 };
            if (hasClearPath(p1, p2, room.level)) {
                break;
            }
            next--;
        }
        pruned.push(rawPath[next]);
        current = next;
    }
    return pruned;
}

function calculatePath(map: number[][], sx: number, sy: number, tx: number, ty: number): {x: number, y: number}[] {
    if (!map) return [];
    
    const startX = Math.floor(sx / 32);
    const startY = Math.floor(sy / 32);
    const endX = Math.floor(tx / 32);
    const endY = Math.floor(ty / 32);

    if (!map[startY] || map[startY][startX] === undefined) return [];

    const open: {x: number, y: number, f: number, g: number}[] = [];
    const closed = new Set<string>();
    const cameFrom = new Map<string, {x: number, y: number}>();

    open.push({x: startX, y: startY, f: 0, g: 0});

    let iterations = 0;
    let closestNode = {x: startX, y: startY};
    let minHeuristic = Infinity;

    while (open.length > 0 && iterations < 300) {
        iterations++;
        open.sort((a, b) => a.f - b.f);
        const current = open.shift()!;
        const currentKey = `${current.x},${current.y}`;

        if (current.x === endX && current.y === endY) {
            closestNode = current;
            break;
        }

        closed.add(currentKey);

        const neighbors = [
            {x: current.x + 1, y: current.y}, {x: current.x - 1, y: current.y},
            {x: current.x, y: current.y + 1}, {x: current.x, y: current.y - 1},
            {x: current.x + 1, y: current.y + 1}, {x: current.x - 1, y: current.y - 1},
            {x: current.x + 1, y: current.y - 1}, {x: current.x - 1, y: current.y + 1}
        ];

        for (const n of neighbors) {
            if (n.y < 0 || n.y >= map.length || n.x < 0 || n.x >= map[0].length) continue;
            
            const tileId = map[n.y][n.x];
            if (TILE_DICTIONARY[tileId]?.solid) continue;

            const nKey = `${n.x},${n.y}`;
            if (closed.has(nKey)) continue;

            let wallPenalty = 0;
            for (let dy = -2; dy <= 2; dy++) {
                for (let dx = -2; dx <= 2; dx++) {
                    if (map[n.y + dy]?.[n.x + dx] && TILE_DICTIONARY[map[n.y + dy][n.x + dx]]?.solid) {
                        const distSq = dx * dx + dy * dy;
                        wallPenalty += distSq <= 2 ? 8 : 3;
                    }
                }
            }

            const g = current.g + 1;
            const h = Math.abs(n.x - endX) + Math.abs(n.y - endY);
            const f = g + h + wallPenalty;

            if (h < minHeuristic) {
                minHeuristic = h;
                closestNode = n;
            }

            const existing = open.find(o => o.x === n.x && o.y === n.y);
            if (!existing) {
                open.push({x: n.x, y: n.y, f, g});
                cameFrom.set(nKey, {x: current.x, y: current.y});
            } else if (g < existing.g) {
                existing.g = g;
                existing.f = f;
                cameFrom.set(nKey, {x: current.x, y: current.y});
            }
        }
    }

    const path = [];
    let currStr = `${closestNode.x},${closestNode.y}`;
    while (cameFrom.has(currStr)) {
        const nodeStr = currStr.split(',');
        path.unshift({ x: parseInt(nodeStr[0], 10), y: parseInt(nodeStr[1], 10) });
        const parent = cameFrom.get(currStr)!;
        currStr = `${parent.x},${parent.y}`;
    }
    
    return path;
}

function dumpAsciiMap(room: Room, botX: number, botY: number, targetX: number, targetY: number, path: {x: number, y: number}[], botAlias: string) {
    const map = room.level.rawMap;
    if (!map) return;
    const bx = Math.floor(botX / 32);
    const by = Math.floor(botY / 32);
    const tx = Math.floor(targetX / 32);
    const ty = Math.floor(targetY / 32);

    const pathSet = new Set(path.map(p => `${p.x},${p.y}`));

    const minX = Math.max(0, Math.min(bx, tx) - 4);
    const maxX = Math.min(map[0].length - 1, Math.max(bx, tx) + 4);
    const minY = Math.max(0, Math.min(by, ty) - 4);
    const maxY = Math.min(map.length - 1, Math.max(by, ty) + 4);

    let ascii = `\n--- MAP SLICE [${botAlias}] (B=Bot, P=Player, *=Path, #=Wall) ---\n`;
    for (let y = minY; y <= maxY; y++) {
        let row = '';
        for (let x = minX; x <= maxX; x++) {
            if (x === bx && y === by) row += 'B';
            else if (x === tx && y === ty) row += 'P';
            else if (pathSet.has(`${x},${y}`)) row += '*';
            else if (TILE_DICTIONARY[map[y]?.[x]]?.solid) row += '#';
            else row += '.';
        }
        ascii += row + '\n';
    }
    console.log(ascii);
}

function generateRoamPath(map: number[][], sx: number, sy: number): {x: number, y: number}[] {
    if (!map) return [];
    const startX = Math.floor(sx / 32);
    const startY = Math.floor(sy / 32);

    for (let attempt = 0; attempt < 8; attempt++) {
        const angle = Math.random() * Math.PI * 2;
        const radius = 12 + Math.floor(Math.random() * 10);
        const rx = Math.max(1, Math.min(map[0].length - 2, startX + Math.round(Math.cos(angle) * radius)));
        const ry = Math.max(1, Math.min(map.length - 2, startY + Math.round(Math.sin(angle) * radius)));

        if (!TILE_DICTIONARY[map[ry]?.[rx]]?.solid) {
            const raw = calculatePath(map, sx, sy, rx * 32 + 16, ry * 32 + 16);
            if (raw.length > 0 && raw[raw.length - 1].x === rx && raw[raw.length - 1].y === ry) {
                return raw;
            }
        }
    }
    return [];
}

function findSafePadPosition(level: import('../core/types').LevelData | undefined, x: number, y: number, botAlias: string = 'BOT'): { x: number, y: number } {
    if (!level || !level.rawMap) return { x, y };
    const map = level.rawMap;
    const mapH = map.length;
    if (mapH === 0) return { x, y };
    const mapW = map[0].length;

    const tileX = Math.max(0, Math.min(mapW - 1, Math.floor(x / 32)));
    const tileY = Math.max(0, Math.min(mapH - 1, Math.floor(y / 32)));

    // If requested spawn position is ALREADY in open air (not solid), trust the map entity's exact Y coordinate!
    if (!TILE_DICTIONARY[map[tileY]?.[tileX]]?.solid) {
        return { x, y };
    }

    // Step up if raw spawn coordinates are inside solid wall terrain
    let airY = tileY;
    while (airY >= 0 && TILE_DICTIONARY[map[airY]?.[tileX]]?.solid) {
        airY--;
    }
    const safeY = airY >= 0 ? airY * 32 + 16 : y;

    return { x, y: safeY };
}