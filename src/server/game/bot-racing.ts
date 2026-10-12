import { Registry, type Entity } from '../core/ecs';
import type { Room } from '../Room';
import { raycastEnvironment } from '../core/math';
import { spawnModernPlayer } from './player-modern';
import { TILE_DICTIONARY } from '../core/tiles';
import { SERVER_CONFIG } from '../core/config';

const BOT_UUID_PREFIX = 'RACER_';

let racingTickCounter = 0;

interface CheckpointGate {
    tileId: number;
    tiles: { x: number; y: number; px: number; py: number }[];
    center: { x: number; y: number };
}

const cachedCheckpoints = new Map<string, CheckpointGate[]>();

function getCheckpoints(room: Room): CheckpointGate[] {
    if (cachedCheckpoints.has(room.id)) return cachedCheckpoints.get(room.id)!;
    
    const cpMap = new Map<number, { x: number; y: number; px: number; py: number }[]>();
    const map = room.level.rawMap;
    if (map) {
        for (let y = 0; y < map.length; y++) {
            for (let x = 0; x < map[y].length; x++) {
                const tileId = map[y][x];
                if (tileId >= 0xDA && tileId <= 0xE1) {
                    if (!cpMap.has(tileId)) cpMap.set(tileId, []);
                    cpMap.get(tileId)!.push({ x, y, px: x * 32 + 16, py: y * 32 + 16 });
                }
            }
        }
    }
    
    const sortedTileIds = Array.from(cpMap.keys()).sort((a, b) => a - b);
    const cps: CheckpointGate[] = [];
    
    for (let i = 0; i < 8; i++) {
        const tileId = 0xDA + i;
        const tiles = cpMap.get(tileId);
        if (tiles && tiles.length > 0) {
            const avgX = tiles.reduce((acc, t) => acc + t.px, 0) / tiles.length;
            const avgY = tiles.reduce((acc, t) => acc + t.py, 0) / tiles.length;
            cps[i] = { tileId, tiles, center: { x: avgX, y: avgY } };
        } else if (sortedTileIds.length > 0) {
            const fallbackTile = sortedTileIds.find(id => id > tileId) || sortedTileIds[0];
            const fbTiles = cpMap.get(fallbackTile)!;
            const avgX = fbTiles.reduce((acc, t) => acc + t.px, 0) / fbTiles.length;
            const avgY = fbTiles.reduce((acc, t) => acc + t.py, 0) / fbTiles.length;
            cps[i] = { tileId: fallbackTile, tiles: fbTiles, center: { x: avgX, y: avgY } };
        }
    }
    
    if (SERVER_CONFIG.debugMode) {
        console.log(`[BOT-RACING] Level ${room.levelIndex} Gates Mapped: ${sortedTileIds.length} checkpoint lines found.`);
    }
    cachedCheckpoints.set(room.id, cps);
    return cps;
}

export function spawnRacingBot(ecs: Registry, x: number, y: number, alias: string, level?: import('../core/types').LevelData): Entity {
    const safePos = findSafePadPosition(level, x, y);
    const botId = BOT_UUID_PREFIX + alias;
    const e = spawnModernPlayer(ecs, botId, safePos.x, safePos.y, { uuid: botId, alias, shipType: 'modern' });
    
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
                logRacingCrash(ecs, room, e, bot, p);
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
        p.inputs.up = true;
        applyAngularControl(p, t, v, -Math.PI / 2);
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
        
        // Look ahead to CP N+1 (including lap wrap-around) to stitch a continuous multi-gate racing line
        const validCps = checkpoints.filter(Boolean);
        const nextIndex = validCps.length > 0 ? (currentCpNum % validCps.length) : 0;
        const futureCp = validCps[nextIndex];

        if (futureCp && rawPath1.length > 0) {
            const lastNode = rawPath1[rawPath1.length - 1];
            const startX = lastNode.x * 32 + 16;
            const startY = lastNode.y * 32 + 16;
            const rawPath2 = calculatePathToGate(room.level.rawMap, startX, startY, futureCp);
            const combined = [...rawPath1, ...rawPath2.slice(1)];
            bot.path = prunePath(combined, room, { x: t.x, y: t.y });
        } else {
            bot.path = prunePath(rawPath1, room, { x: t.x, y: t.y });
        }
        bot.pathTimer = 30;
    }
    // FOLLOW OPTIMAL RACING LINE (F1 STYLE)
    if (bot.path && bot.path.length > 0) {
        // 1. Apex Cutting: Pop waypoints extremely early (96px / 3 tiles out) to maintain momentum
        let nextWp = bot.path[0];
        let wpX = nextWp.x * 32 + 16;
        let wpY = nextWp.y * 32 + 16;

        if (Math.hypot(wpX - t.x, wpY - t.y) < 96) {
            bot.path.shift();
        }

        // 2. Lookahead Targeting: Aim at the furthest visible point on the path to start turns early
        let lookaheadIdx = 0;
        for (let i = 0; i < Math.min(bot.path.length, 6); i++) {
            const testX = bot.path[i].x * 32 + 16;
            const testY = bot.path[i].y * 32 + 16;
            if (hasClearPath({ x: t.x, y: t.y }, { x: testX, y: testY }, room.level)) {
                lookaheadIdx = i;
            } else {
                break;
            }
        }

        if (bot.path.length > 0 && bot.path[lookaheadIdx]) {
            aimX = bot.path[lookaheadIdx].x * 32 + 16;
            aimY = bot.path[lookaheadIdx].y * 32 + 16;
        }
    } else {
        aimX = targetCp.center.x;
        aimY = targetCp.center.y;
    }

    // 4. VECTOR-BASED RACING PHYSICS (GRAVITY & INERTIA DRIFT COMPENSATED)
    const dirX = aimX - t.x;
    const dirY = aimY - t.y;
    const distToAim = Math.hypot(dirX, dirY) || 1;
    
    const currentSpeed = Math.hypot(v.vx, v.vy);
    const targetSpeed = 7.0;

    // Desired velocity vector
    const desVx = (dirX / distToAim) * targetSpeed;
    const desVy = (dirY / distToAim) * targetSpeed;

    // Vector Force = (Desired Velocity - Current Velocity) - Gravity
    // Subtracting positive gravity (0.12) pulls forceY UPWARD to counteract downward sink
    const GRAVITY = 0.12;
    const forceX = desVx - v.vx;
    const forceY = (desVy - v.vy) - GRAVITY;

    // Lookahead Glide Prediction: Will current momentum + gravity crash into a wall in next 45 ticks?
    const glideTicks = Math.min(45, Math.floor(currentSpeed * 7) + 15);
    const isGlidePathSafe = currentSpeed < 1.5 || !predictGlideCollision(t, v, glideTicks, room);

    const normDirX = dirX / distToAim;
    const normDirY = dirY / distToAim;
    const velDotTarget = currentSpeed > 0.5 ? (v.vx * normDirX + v.vy * normDirY) / currentSpeed : 1.0;

    let desiredAngle: number;
    if (!isGlidePathSafe && currentSpeed > 2.5 && velDotTarget < 0.2) {
        // EMERGENCY RETRO-BRAKE: Turn opposite to velocity to kill sideways drift
        desiredAngle = Math.atan2(-v.vy, -v.vx);
    } else {
        desiredAngle = Math.atan2(forceY, forceX);
    }

    (bot as any).lastDesiredAngle = desiredAngle;
    const angleDiff = applyAngularControl(p, t, v, desiredAngle);

    // DYNAMIC THROTTLE MANAGEMENT
    if (isGlidePathSafe) {
        // Safe line: Keep throttle open if nose is reasonably aligned with force vector
        if (angleDiff < 1.2) p.inputs.up = true;
    } else {
        // Trajectory unsafe: Lift throttle to let angular rotation whip the nose around tighter,
        // only firing thruster when aligned with correction vector to counteract drift.
        if (angleDiff < 0.35) p.inputs.up = true;
    }
}
// ----------------------------------------------------------------------------
// Reused Core Math/Physics Helpers
// ----------------------------------------------------------------------------

function applyAngularControl(p: import('../core/types').Player, t: import('../core/ecs').Transform, v: import('../core/ecs').Velocity, desiredAngle: number): number {
    const diff = getAngleDiff(desiredAngle, t.angle);
    const Kp = 0.20; // Increased Proportional gain for snappier racing turns
    const Kd = 1.2;  // Increased Derivative gain to prevent oversteer wobbles
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
    const margin = 24; // Increased margin so paths give walls wide berth

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

function calculatePathToGate(map: number[][], sx: number, sy: number, gate: CheckpointGate): {x: number, y: number}[] {
    if (!map) return [];
    
    const startX = Math.floor(sx / 32);
    const startY = Math.floor(sy / 32);

    if (!map[startY] || map[startY][startX] === undefined) return [];

    const gateTileSet = new Set(gate.tiles.map(t => `${t.x},${t.y}`));

    const open: {x: number, y: number, f: number, g: number}[] = [];
    const closed = new Set<string>();
    const cameFrom = new Map<string, {x: number, y: number}>();

    open.push({x: startX, y: startY, f: 0, g: 0});

    let iterations = 0;
    let closestNode = {x: startX, y: startY};
    let minHeuristic = Infinity;

    while (open.length > 0 && iterations < 500) {
        iterations++;
        open.sort((a, b) => a.f - b.f);
        const current = open.shift()!;
        const currentKey = `${current.x},${current.y}`;

        if (gateTileSet.has(currentKey)) {
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
            
            let h = Infinity;
            for (const gt of gate.tiles) {
                const dist = Math.abs(n.x - gt.x) + Math.abs(n.y - gt.y);
                if (dist < h) h = dist;
            }
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

function findSafePadPosition(level: import('../core/types').LevelData | undefined, x: number, y: number): { x: number, y: number } {
    if (!level || !level.rawMap) return { x, y };
    const map = level.rawMap;
    const mapH = map.length;
    if (mapH === 0) return { x, y };
    const mapW = map[0].length;

    const tileX = Math.max(0, Math.min(mapW - 1, Math.floor(x / 32)));
    const tileY = Math.max(0, Math.min(mapH - 1, Math.floor(y / 32)));

    if (!TILE_DICTIONARY[map[tileY]?.[tileX]]?.solid) {
        return { x, y };
    }

    let airY = tileY;
    while (airY >= 0 && TILE_DICTIONARY[map[airY]?.[tileX]]?.solid) {
        airY--;
    }
    const safeY = airY >= 0 ? airY * 32 + 16 : y;

    return { x, y: safeY };
}

// ----------------------------------------------------------------------------
// Crash Telemetry & ASCII Slice Logging
// ----------------------------------------------------------------------------

function logRacingCrash(ecs: Registry, room: Room, e: Entity, bot: import('../core/types').BotState, p: import('../core/types').Player) {
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

    console.log(`\n=== [BOT-RACING CRASH TELEMETRY] ${p.alias} crashed at tile (${bx}, ${by}) ===`);
    console.log(`- Target Checkpoint  : Gate #${cpNum} ${targetCp ? `at Center (${Math.floor(targetCp.center.x / 32)},${Math.floor(targetCp.center.y / 32)})` : 'NOT FOUND'}`);
    console.log(`- Impact Speed       : ${speed.toFixed(2)} px/tick`);
    console.log(`- Trajectory vs Face : Motion: ${motionAngleDeg}° | Facing: ${facingAngleDeg}° | Drift Angle: ${driftAngleDeg}°`);
    if ((bot as any).lastDesiredAngle !== undefined) {
        const steerErr = (Math.abs(getAngleDiff((bot as any).lastDesiredAngle, t.angle)) * 180 / Math.PI).toFixed(1);
        console.log(`- Steering Target    : ${((bot as any).lastDesiredAngle * 180 / Math.PI).toFixed(1)}° (Alignment Error: ${steerErr}°)`);
    }
    console.log(`- Line Offset        : ${pathOffsetPx} px away from active path node`);
    console.log(`- Path Nodes Left    : ${bot.path?.length || 0}`);


    dumpRacingAsciiMap(room, t.x, t.y, targetCp?.center, bot.path, p.alias);
}

function dumpRacingAsciiMap(room: Room, botX: number, botY: number, targetCenter?: {x: number, y: number}, path: {x: number, y: number}[] = [], botAlias: string = 'RACER') {
    const map = room.level.rawMap;
    if (!map) return;
    const bx = Math.floor(botX / 32);
    const by = Math.floor(botY / 32);
    const cx = targetCenter ? Math.floor(targetCenter.x / 32) : bx;
    const cy = targetCenter ? Math.floor(targetCenter.y / 32) : by;

    const pathSet = new Set(path.map(node => `${node.x},${node.y}`));

    const minX = Math.max(0, Math.min(bx, cx) - 4);
    const maxX = Math.min(map[0].length - 1, Math.max(bx, cx) + 4);
    const minY = Math.max(0, Math.min(by, cy) - 4);
    const maxY = Math.min(map.length - 1, Math.max(by, cy) + 4);
    let ascii = `--- RACING MAP SLICE [${botAlias}] (B=Crash Site, C=Target Gate, *=Path, #=Wall) ---\n`;
    for (let y = minY; y <= maxY; y++) {
        let row = '';
        for (let x = minX; x <= maxX; x++) {
            if (x === bx && y === by) row += 'B';
            else if (x === cx && y === cy) row += 'C';
            else if (pathSet.has(`${x},${y}`)) row += '*';
            else if (TILE_DICTIONARY[map[y]?.[x]]?.solid) row += '#';
            else row += '.';
        }
        ascii += row + '\n';
    }
    console.log(ascii + '\n');
}