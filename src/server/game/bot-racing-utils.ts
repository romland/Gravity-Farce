import { Registry, type Entity } from '../core/ecs';
import type { Room } from '../Room';
import { raycastEnvironment } from '../core/math';
import { TILE_DICTIONARY } from '../core/tiles';
import { SERVER_CONFIG } from '../core/config';
import { spawnClassicPlayer } from './player-classic';

export const BOT_UUID_PREFIX = 'RACER_';

export interface CheckpointGate {
	tileId: number;
	tiles: { x: number; y: number; px: number; py: number }[];
	center: { x: number; y: number };
}

const cachedCheckpoints = new Map<string, CheckpointGate[]>();

export function getCheckpoints(room: Room): CheckpointGate[] {
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
		}
	}

	if (SERVER_CONFIG.debugMode) {
		console.log(`[BOT-RACING] Level ${room.levelIndex} Gates Mapped: ${sortedTileIds.length} checkpoint lines found.`);
	}
	cachedCheckpoints.set(room.id, cps);
	return cps;
}

export function findSafePadPosition(level: import('../core/types').LevelData | undefined, x: number, y: number): { x: number, y: number } {
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
	while (airY >= 0 && (TILE_DICTIONARY[map[airY]?.[tileX]]?.solid || TILE_DICTIONARY[map[airY]?.[tileX]]?.pad)) {
		airY--;
	}
	const safeY = airY >= 0 ? airY * 32 + 16 : y;

	return { x, y: safeY };
}

export function applyAngularControl(p: import('../core/types').Player, t: import('../core/ecs').Transform, v: import('../core/ecs').Velocity, desiredAngle: number): number {
	const diff = getAngleDiff(desiredAngle, t.angle);

	if (p.type === 'classic') {
		// Classic ship has instant rotation velocity, no inertia. 10 deg/tick.
		if (diff < -0.1) p.inputs.left = true;
		else if (diff > 0.1) p.inputs.right = true;
		return Math.abs(diff);
	}

	const Kp = 0.20;
	const Kd = 1.2;
	const angVel = (p as any).angularVelocity || (v as any).angularVelocity || 0;
	const desiredAngVel = diff * Kp;
	const torque = desiredAngVel - angVel * Kd;

	if (torque < -0.001) p.inputs.left = true;
	else if (torque > 0.001) p.inputs.right = true;

	return Math.abs(diff);
}

export function predictGlideCollision(t: { x: number, y: number }, v: { vx: number, vy: number }, ticks: number, room: Room): boolean {
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

export function getAngleDiff(target: number, current: number): number {
	let diff = target - current;
	while (diff > Math.PI) diff -= Math.PI * 2;
	while (diff < -Math.PI) diff += Math.PI * 2;
	return diff;
}

export function hasClearPath(p1: { x: number, y: number }, p2: { x: number, y: number }, level: import('../core/types').LevelData): boolean {
	const dx = p2.x - p1.x;
	const dy = p2.y - p1.y;
	const len = Math.hypot(dx, dy) || 1;
	const nx = -dy / len;
	const ny = dx / len;
	const margin = 18;

	if (raycastEnvironment(p1, p2, level)) return false;
	if (raycastEnvironment({ x: p1.x + nx * margin, y: p1.y + ny * margin }, { x: p2.x + nx * margin, y: p2.y + ny * margin }, level)) return false;
	if (raycastEnvironment({ x: p1.x - nx * margin, y: p1.y - ny * margin }, { x: p2.x - nx * margin, y: p2.y - ny * margin }, level)) return false;

	return true;
}

export function prunePath(rawPath: { x: number, y: number }[], room: Room, botPos?: { x: number, y: number }): { x: number, y: number }[] {
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

	const pruned: { x: number, y: number }[] = [rawPath[startIdx]];
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

export function calculatePathToGate(map: number[][], sx: number, sy: number, gate: CheckpointGate): { x: number, y: number }[] {
	if (!map) return [];

	const startX = Math.floor(sx / 32);
	const startY = Math.floor(sy / 32);

	if (!map[startY] || map[startY][startX] === undefined) return [];

	const gateTileSet = new Set(gate.tiles.map(t => `${t.x},${t.y}`));

	const open: { x: number, y: number, f: number, g: number }[] = [];
	const closed = new Set<string>();
	const cameFrom = new Map<string, { x: number, y: number }>();

	open.push({ x: startX, y: startY, f: 0, g: 0 });

	let iterations = 0;
	let closestNode = { x: startX, y: startY };
	let minHeuristic = Infinity;

    while (open.length > 0 && iterations < 4000) {
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
			{ x: current.x + 1, y: current.y }, { x: current.x - 1, y: current.y },
			{ x: current.x, y: current.y + 1 }, { x: current.x, y: current.y - 1 },
			{ x: current.x + 1, y: current.y + 1 }, { x: current.x - 1, y: current.y - 1 },
			{ x: current.x + 1, y: current.y - 1 }, { x: current.x - 1, y: current.y + 1 }
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
				open.push({ x: n.x, y: n.y, f, g });
				cameFrom.set(nKey, { x: current.x, y: current.y });
			} else if (g < existing.g) {
				existing.g = g;
				existing.f = f;
				cameFrom.set(nKey, { x: current.x, y: current.y });
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

export function logRacingCrash(ecs: Registry, room: Room, e: Entity, bot: import('../core/types').BotState, p: import('../core/types').Player, currentTick: number) {
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

    console.log(`\n=== [${new Date().toISOString()}] [BOT-RACING CRASH TELEMETRY] ${p.alias} crashed at tile (${bx}, ${by}) ===`);
	console.log(`- Target Checkpoint  : Gate #${cpNum} ${targetCp ? `at Center (${Math.floor(targetCp.center.x / 32)},${Math.floor(targetCp.center.y / 32)})` : 'NOT FOUND'}`);
	console.log(`- Impact Speed       : ${speed.toFixed(2)} px/tick (Vy: ${v.vy.toFixed(2)}, Max Downward Vy: ${maxVy.toFixed(2)})`);
	console.log(`- Trajectory vs Face : Motion: ${motionAngleDeg}° | Facing: ${facingAngleDeg}° | Drift Angle: ${driftAngleDeg}°`);
	if ((bot as any).lastDesiredAngle !== undefined) {
		const steerErr = (Math.abs(getAngleDiff((bot as any).lastDesiredAngle, t.angle)) * 180 / Math.PI).toFixed(1);
		console.log(`- Steering Target    : ${((bot as any).lastDesiredAngle * 180 / Math.PI).toFixed(1)}° (Alignment Error: ${steerErr}°)`);
	}
	console.log(`- Line Offset        : ${pathOffsetPx} px away from active path node`);
	console.log(`- Glide Alert        : ${firstUnsafe ? `First flagged UNSAFE ${unsafeTicksAgo} ticks (~${(unsafeTicksAgo / 60).toFixed(2)}s) before impact` : 'Never flagged unsafe'}`);

	if (rec.length > 0) {
		console.log(`- BLACK-BOX FLIGHT RECORDER (Past ${rec.length} ticks, sampled every 10 ticks):`);
        console.log(`  T-Minus | Pos (X, Y)   | Vel (Vx, Vy)   | Spd / Tgt | Face -> Desir | DistAim | Offset | Thr | Safe`);
        for (let i = Math.max(0, rec.length - 240); i < rec.length; i += 10) {
			const entry = rec[i];
			const ago = currentTick - entry.tick;
            console.log(`  -${String(ago).padStart(3, ' ')}t   | (${String(entry.x).padStart(3)}, ${String(entry.y).padStart(3)}) | (${String(entry.vx).padStart(5)}, ${String(entry.vy).padStart(5)}) | ${String(entry.speed).padStart(4)}/ ${String(entry.targetSpeed || 0).padStart(4)} | ${String(entry.facingDeg).padStart(5)}° -> ${String(entry.desiredDeg).padStart(5)}° | ${String(entry.distToAim || 0).padStart(7)} | ${String(entry.pathOffset || 0).padStart(6)} | ${entry.thrust ? 'ON ' : 'OFF'} | ${entry.safe ? 'YES' : 'NO '}`);
		}
		const lastEntry = rec[rec.length - 1];
		const lastAgo = currentTick - lastEntry.tick;
        console.log(`  -${String(lastAgo).padStart(3, ' ')}t   | (${String(lastEntry.x).padStart(3)}, ${String(lastEntry.y).padStart(3)}) | (${String(lastEntry.vx).padStart(5)}, ${String(lastEntry.vy).padStart(5)}) | ${String(lastEntry.speed).padStart(4)}/ ${String(lastEntry.targetSpeed || 0).padStart(4)} | ${String(lastEntry.facingDeg).padStart(5)}° -> ${String(lastEntry.desiredDeg).padStart(5)}° | ${String(lastEntry.distToAim || 0).padStart(7)} | ${String(lastEntry.pathOffset || 0).padStart(6)} | ${lastEntry.thrust ? 'ON ' : 'OFF'} | ${lastEntry.safe ? 'YES' : 'NO '}`);
	}

	dumpRacingAsciiMap(room, t.x, t.y, targetCp?.center, bot.path, p.alias);
}

export function dumpRacingAsciiMap(room: Room, botX: number, botY: number, targetCenter?: { x: number, y: number }, path: { x: number, y: number }[] = [], botAlias: string = 'RACER') {
	const map = room.level.rawMap;
	if (!map) return;
	const bx = Math.floor(botX / 32);
	const by = Math.floor(botY / 32);
	const cx = targetCenter ? Math.floor(targetCenter.x / 32) : bx;
	const cy = targetCenter ? Math.floor(targetCenter.y / 32) : by;

	const pathSet = new Set(path.map(node => `${node.x},${node.y}`));

	const minX = 0;
	const maxX = map[0].length - 1;
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
