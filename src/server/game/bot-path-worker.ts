import { Worker } from 'worker_threads';
import { TILE_DICTIONARY } from '../core/tiles';
import type { LevelData } from '../core/types';
import type { CheckpointGate } from './bot-utils';

export interface PathJobRequest {
    jobId: number;
    kind: 'target' | 'gate' | 'roam';
    roomId: number;
    sx: number;
    sy: number;
    tx?: number;
    ty?: number;
    gate?: CheckpointGate;
    futureGate?: CheckpointGate;
}

export interface PathJobResult {
    jobId: number;
    path: { x: number; y: number }[];
    reachedTarget?: boolean;
}

const WORKER_SCRIPT = `
const { parentPort } = require('worker_threads');

const levels = new Map();
let solidSet = new Set();

function lineIntersect(x1, y1, x2, y2, x3, y3, x4, y4) {
    const den = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
    if (den === 0) return false;
    const t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / den;
    const u = -((x1 - x2) * (y1 - y3) - (y1 - y2) * (x1 - x3)) / den;
    return (t > 0 && t < 1 && u > 0 && u < 1);
}

function raycastWalls(p1, p2, walls) {
    if (!walls) return false;
    for (let w = 0; w < walls.length; w++) {
        const line = walls[w];
        for (let i = 0; i < line.length - 1; i++) {
            if (lineIntersect(p1.x, p1.y, p2.x, p2.y, line[i].x, line[i].y, line[i + 1].x, line[i + 1].y)) {
                return true;
            }
        }
    }
    return false;
}

function hasClearPath(p1, p2, walls) {
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len;
    const ny = dx / len;
    const margin = 18;

    if (raycastWalls(p1, p2, walls)) return false;
    if (raycastWalls({ x: p1.x + nx * margin, y: p1.y + ny * margin }, { x: p2.x + nx * margin, y: p2.y + ny * margin }, walls)) return false;
    if (raycastWalls({ x: p1.x - nx * margin, y: p1.y - ny * margin }, { x: p2.x - nx * margin, y: p2.y - ny * margin }, walls)) return false;
    return true;
}

function prunePath(rawPath, walls, botPos) {
    if (rawPath.length === 0) return [];
    if (rawPath.length <= 2) return [...rawPath];

    let startIdx = 0;
    if (botPos) {
        for (let i = Math.min(rawPath.length - 1, 8); i >= 0; i--) {
            const nodePos = { x: rawPath[i].x * 32 + 16, y: rawPath[i].y * 32 + 16 };
            if (hasClearPath(botPos, nodePos, walls)) {
                startIdx = i;
                break;
            }
        }
    }

    const pruned = [rawPath[startIdx]];
    let current = startIdx;

    while (current < rawPath.length - 1) {
        let next = rawPath.length - 1;
        while (next > current + 1) {
            const p1 = { x: rawPath[current].x * 32 + 16, y: rawPath[current].y * 32 + 16 };
            const p2 = { x: rawPath[next].x * 32 + 16, y: rawPath[next].y * 32 + 16 };
            if (hasClearPath(p1, p2, walls)) break;
            next--;
        }
        pruned.push(rawPath[next]);
        current = next;
    }
    return pruned;
}

function heapPush(heap, node) {
    heap.push(node);
    let idx = heap.length - 1;
    while (idx > 0) {
        const parent = (idx - 1) >> 1;
        if (heap[parent].f <= heap[idx].f) break;
        const tmp = heap[parent];
        heap[parent] = heap[idx];
        heap[idx] = tmp;
        idx = parent;
    }
}

function heapPop(heap) {
    const top = heap[0];
    const bottom = heap.pop();
    if (heap.length > 0) {
        heap[0] = bottom;
        let idx = 0;
        const len = heap.length;
        while (true) {
            const left = (idx << 1) + 1;
            const right = left + 1;
            let smallest = idx;
            if (left < len && heap[left].f < heap[smallest].f) smallest = left;
            if (right < len && heap[right].f < heap[smallest].f) smallest = right;
            if (smallest === idx) break;
            const tmp = heap[idx];
            heap[idx] = heap[smallest];
            heap[smallest] = tmp;
            idx = smallest;
        }
    }
    return top;
}

function runAStar(map, sx, sy, isGoalFn, heuristicFn, maxIter) {
    if (!map || map.length === 0) return [];
    const h = map.length;
    const w = map[0].length;
    const startX = Math.max(0, Math.min(w - 1, Math.floor(sx / 32)));
    const startY = Math.max(0, Math.min(h - 1, Math.floor(sy / 32)));

    const open = [];
    const closed = new Uint8Array(w * h);
    const gScore = new Float32Array(w * h);
    gScore.fill(Infinity);
    const cameFrom = new Int32Array(w * h);
    cameFrom.fill(-1);

    const startIdx = startY * w + startX;
    gScore[startIdx] = 0;
    heapPush(open, { x: startX, y: startY, f: 0, g: 0 });

    let iterations = 0;
    let closestIdx = startIdx;
    let minH = Infinity;

    const dirs = [
        [1, 0], [-1, 0], [0, 1], [0, -1],
        [1, 1], [-1, -1], [1, -1], [-1, 1]
    ];

    while (open.length > 0 && iterations < maxIter) {
        iterations++;
        const current = heapPop(open);
        const cIdx = current.y * w + current.x;
        if (closed[cIdx]) continue;
        if (isGoalFn(current.x, current.y)) {
            closestIdx = cIdx;
            break;
        }
        closed[cIdx] = 1;

        for (let d = 0; d < 8; d++) {
            const nx = current.x + dirs[d][0];
            const ny = current.y + dirs[d][1];
            if (ny < 0 || ny >= h || nx < 0 || nx >= w) continue;
            const nIdx = ny * w + nx;
            if (closed[nIdx]) continue;
            if (solidSet.has(map[ny][nx])) continue;

            if (nx !== current.x && ny !== current.y) {
                if (solidSet.has(map[current.y][nx]) || solidSet.has(map[ny][current.x])) continue;
            }

            let wallPenalty = 0;
            for (let dy = -2; dy <= 2; dy++) {
                const ry = ny + dy;
                if (ry < 0 || ry >= h) continue;
                for (let dx = -2; dx <= 2; dx++) {
                    const rx = nx + dx;
                    if (rx < 0 || rx >= w) continue;
                    if (solidSet.has(map[ry][rx])) {
                        wallPenalty += (dx * dx + dy * dy) <= 2 ? 8 : 3;
                    }
                }
            }

            const g = current.g + 1;
            if (g < gScore[nIdx]) {
                gScore[nIdx] = g;
                cameFrom[nIdx] = cIdx;
                const hVal = heuristicFn(nx, ny);
                if (hVal < minH) {
                    minH = hVal;
                    closestIdx = nIdx;
                }
                heapPush(open, { x: nx, y: ny, f: g + hVal + wallPenalty, g });
            }
        }
    }

    const path = [];
    let curr = closestIdx;
    while (cameFrom[curr] !== -1) {
        path.unshift({ x: curr % w, y: Math.floor(curr / w) });
        curr = cameFrom[curr];
    }
    return path;
}

parentPort.on('message', (msg) => {
    if (msg.type === 'init_solids') {
        solidSet = new Set(msg.solids);
        return;
    }
    if (msg.type === 'sync_level') {
        levels.set(msg.roomId, { rawMap: msg.rawMap, walls: msg.walls });
        return;
    }
    if (msg.type === 'remove_room') {
        levels.delete(msg.roomId);
        return;
    }
    if (msg.type === 'tile_update') {
        const lvl = levels.get(msg.roomId);
        if (lvl && lvl.rawMap && lvl.rawMap[msg.y]) {
            lvl.rawMap[msg.y][msg.x] = msg.tile;
        }
        return;
    }
    if (msg.type === 'job') {
        const req = msg.req;
        const lvl = levels.get(req.roomId);
        if (!lvl || !lvl.rawMap) {
            parentPort.postMessage({ jobId: req.jobId, path: [], reachedTarget: false });
            return;
        }
        const { rawMap, walls } = lvl;

        if (req.kind === 'target') {
            const endX = Math.floor(req.tx / 32);
            const endY = Math.floor(req.ty / 32);
            const raw = runAStar(
                rawMap,
                req.sx,
                req.sy,
                (x, y) => x === endX && y === endY,
                (x, y) => Math.abs(x - endX) + Math.abs(y - endY),
                6000
            );
            const last = raw[raw.length - 1];
            const reachedTarget = Boolean(last && last.x === endX && last.y === endY);
            const pruned = prunePath(raw, walls, { x: req.sx, y: req.sy });
            parentPort.postMessage({ jobId: req.jobId, path: pruned, reachedTarget });
        } else if (req.kind === 'gate' && req.gate) {
            const gateSet = new Set(req.gate.tiles.map(t => t.x + ',' + t.y));
            const raw1 = runAStar(
                rawMap,
                req.sx,
                req.sy,
                (x, y) => gateSet.has(x + ',' + y),
                (x, y) => {
                    let best = Infinity;
                    for (let i = 0; i < req.gate.tiles.length; i++) {
                        const gt = req.gate.tiles[i];
                        const d = Math.abs(x - gt.x) + Math.abs(y - gt.y);
                        if (d < best) best = d;
                    }
                    return best;
                },
                4000
            );
            const pruned1 = prunePath(raw1, walls, { x: req.sx, y: req.sy });
            let finalPath = pruned1;

            if (req.futureGate && raw1.length > 0) {
                const lastNode = raw1[raw1.length - 1];
                const fSet = new Set(req.futureGate.tiles.map(t => t.x + ',' + t.y));
                const raw2 = runAStar(
                    rawMap,
                    lastNode.x * 32 + 16,
                    lastNode.y * 32 + 16,
                    (x, y) => fSet.has(x + ',' + y),
                    (x, y) => {
                        let best = Infinity;
                        for (let i = 0; i < req.futureGate.tiles.length; i++) {
                            const gt = req.futureGate.tiles[i];
                            const d = Math.abs(x - gt.x) + Math.abs(y - gt.y);
                            if (d < best) best = d;
                        }
                        return best;
                    },
                    4000
                );
                const pruned2 = prunePath(raw2, walls);
                finalPath = [...pruned1, ...pruned2.slice(1)];
            }
            parentPort.postMessage({ jobId: req.jobId, path: finalPath, reachedTarget: true });
        } else if (req.kind === 'roam') {
            const startX = Math.floor(req.sx / 32);
            const startY = Math.floor(req.sy / 32);
            let outPath = [];
            for (let attempt = 0; attempt < 8; attempt++) {
                const angle = Math.random() * Math.PI * 2;
                const radius = 12 + Math.floor(Math.random() * 10);
                const rx = Math.max(1, Math.min(rawMap[0].length - 2, startX + Math.round(Math.cos(angle) * radius)));
                const ry = Math.max(1, Math.min(rawMap.length - 2, startY + Math.round(Math.sin(angle) * radius)));
                if (!solidSet.has(rawMap[ry]?.[rx])) {
                    const raw = runAStar(
                        rawMap,
                        req.sx,
                        req.sy,
                        (x, y) => x === rx && y === ry,
                        (x, y) => Math.abs(x - rx) + Math.abs(y - ry),
                        4000
                    );
                    if (raw.length > 0 && raw[raw.length - 1].x === rx && raw[raw.length - 1].y === ry) {
                        outPath = prunePath(raw, walls, { x: req.sx, y: req.sy });
                        break;
                    }
                }
            }
            parentPort.postMessage({ jobId: req.jobId, path: outPath, reachedTarget: true });
        }
    }
});
`;

class BotPathWorkerPool {
    private worker: Worker;
    private nextJobId = 1;
    private callbacks = new Map<number, (res: PathJobResult) => void>();
    private syncedRooms = new Set<number>();

    constructor() {
        this.worker = new Worker(WORKER_SCRIPT, { eval: true });
        const solids = Object.values(TILE_DICTIONARY)
            .filter(t => t.solid)
            .map(t => t.id);
        this.worker.postMessage({ type: 'init_solids', solids });

        this.worker.on('message', (res: PathJobResult) => {
            const cb = this.callbacks.get(res.jobId);
            if (cb) {
                this.callbacks.delete(res.jobId);
                cb(res);
            }
        });
    }

    public syncLevel(roomId: number, level: LevelData, force: boolean = false) {
        if (!force && this.syncedRooms.has(roomId)) return;
        if (!level.rawMap) return;
        this.syncedRooms.add(roomId);
        this.worker.postMessage({
            type: 'sync_level',
            roomId,
            rawMap: level.rawMap,
            walls: level.walls
        });
    }

    public removeRoom(roomId: number) {
        this.syncedRooms.delete(roomId);
        this.worker.postMessage({ type: 'remove_room', roomId });
    }

    public notifyTileUpdate(roomId: number, x: number, y: number, tile: number) {
        this.worker.postMessage({ type: 'tile_update', roomId, x, y, tile });
    }

    public enqueue(req: Omit<PathJobRequest, 'jobId'>, cb: (res: PathJobResult) => void) {
        const jobId = this.nextJobId++;
        this.callbacks.set(jobId, cb);
        this.worker.postMessage({
            type: 'job',
            req: { ...req, jobId }
        });
    }
}

export const botPathWorker = new BotPathWorkerPool();