export interface PathSegment {
    id: string;
    points: { x: number; y: number }[];
    nextIds: string[]; // Format: "segmentId:pointIndex"
}

const DIRS = [
    { dx: 1, dy: 0 },
    { dx: 0, dy: 1 },
    { dx: -1, dy: 0 },
    { dx: 0, dy: -1 }
];

const parseCurve = (hexStr: string) => hexStr.replace(/ /g, '').match(/.{4}/g)!.map(pair => {
    const dx = parseInt(pair.substring(0, 2), 16);
    const dy = parseInt(pair.substring(2, 4), 16);
    return { dx: dx > 127 ? dx - 256 : dx, dy: dy > 127 ? dy - 256 : dy };
});

const CURVES: Record<number, {dx: number, dy: number}[]> = {
    8:  parseCurve("00FF 00FF 00FF 00FF 00FF 00FF 01FF 00FF 01FF 00FF 01FF 01FF 01FF 01FF 0100 01FF 0100 01FF 0100 0100 0100 0100 0100 0100"),
    9:  parseCurve("0100 0100 0100 0100 0100 0100 0101 0100 0101 0100 0101 0101 0101 0101 0001 0101 0001 0101 0001 0001 0001 0001 0001 0001"),
    10: parseCurve("0001 0001 0001 0001 0001 0001 FF01 0001 FF01 0001 FF01 FF01 FF01 FF01 FF00 FF01 FF00 FF01 FF00 FF00 FF00 FF00 FF00 FF00"),
    11: parseCurve("FF00 FF00 FF00 FF00 FF00 FF00 FFFF FF00 FFFF FF00 FFFF FFFF FFFF FFFF 00FF FFFF 00FF FFFF 00FF 00FF 00FF 00FF 00FF 00FF"),
    12: parseCurve("FF00 FF00 FF00 FF00 FF00 FF00 FF01 FF00 FF01 FF00 FF01 FF01 FF01 FF01 0001 FF01 0001 FF01 0001 0001 0001 0001 0001 0001"),
    13: parseCurve("00FF 00FF 00FF 00FF 00FF 00FF FFFF 00FF FFFF 00FF FFFF FFFF FFFF FFFF FF00 FFFF FF00 FFFF FF00 FF00 FF00 FF00 FF00 FF00"),
    14: parseCurve("0100 0100 0100 0100 0100 0100 01FF 0100 01FF 0100 01FF 01FF 01FF 01FF 00FF 01FF 00FF 01FF 00FF 00FF 00FF 00FF 00FF 00FF"),
    15: parseCurve("0001 0001 0001 0001 0001 0001 0101 0001 0101 0001 0101 0101 0101 0101 0100 0101 0100 0101 0100 0100 0100 0100 0100 0100")
};

export class FlyingPathManager {
    public segments = new Map<string, PathSegment>();
    public startMap = new Map<string, string>();
    private globalVisited = new Map<string, string>();

    constructor(map: number[][]) {
        this.buildGraph(map);
    }

    private buildGraph(map: number[][]) {
        const mapHeight = map.length;
        if (mapHeight === 0) return;
        const mapWidth = map[0].length;
        
        for (let y = 0; y < mapHeight; y++) {
            for (let x = 0; x < mapWidth; x++) {
                const tile = map[y][x];
                if (tile >= 0xE4 && tile <= 0xEF) {
                    this.traceFrom(x, y, map);
                }
            }
        }
    }

    private traceFrom(startX: number, startY: number, map: number[][]) {
        const mapHeight = map.length;
        const mapWidth = map[0].length;
        const SCALE = 4; // Translates Amiga 8x8 space to 32x32 view
        const OFFSET = 16; 

        const initialSegId = `${startX},${startY},0,0`;

        if (this.startMap.has(`${startX},${startY}`)) return;
        this.startMap.set(`${startX},${startY}`, initialSegId);

        const queue = [{
            absX: startX * 8,
            absY: startY * 8,
            dir: 0,
            curveFrame: 0,
            segmentId: initialSegId,
            points: [] as {x: number, y: number}[],
            lastEvalX: -1,
            lastEvalY: -1,
            isFirst: true
        }];

        while (queue.length > 0) {
            const state = queue.shift()!;
            if (this.segments.has(state.segmentId)) continue; 

            let ticks = 0;
            let segmentFinished = false;

            while (ticks < 15000 && !segmentFinished) {
                ticks++;

                if (!state.isFirst) {
                    const stateKey = `${state.absX},${state.absY},${state.dir},${state.curveFrame}`;
                    if (this.globalVisited.has(stateKey)) {
                        const targetLink = this.globalVisited.get(stateKey)!;
                        this.segments.set(state.segmentId, { id: state.segmentId, points: state.points, nextIds: [targetLink] });
                        segmentFinished = true;
                        break;
                    }
                    this.globalVisited.set(stateKey, `${state.segmentId}:${state.points.length}`);
                }

                const engineTileX = Math.floor(state.absX / 8);
                const engineTileY = Math.floor(state.absY / 8);

                state.points.push({ x: state.absX * SCALE + OFFSET, y: state.absY * SCALE + OFFSET });

                if (engineTileX < 0 || engineTileX >= mapWidth || engineTileY < 0 || engineTileY >= mapHeight) {
                    this.segments.set(state.segmentId, { id: state.segmentId, points: state.points, nextIds: [] });
                    break;
                }

                if (state.absX % 8 === 0 && state.absY % 8 === 0 && state.curveFrame === 0) {
                    if (state.lastEvalX !== engineTileX || state.lastEvalY !== engineTileY) {
                        state.lastEvalX = engineTileX;
                        state.lastEvalY = engineTileY;

                        const tileId = map[engineTileY][engineTileX];
                        const n = tileId >= 240 ? tileId - 240 : -1;

                        if (n >= 4 && n <= 7) {
                            let branchDirs: number[] = [];
                            if (n === 4) branchDirs = [3, 2];
                            else if (n === 5) branchDirs = [1, 2];
                            else if (n === 6) branchDirs = [0, 3];
                            else if (n === 7) branchDirs = [1, 0];

                            const nextIds = branchDirs.map(d => `${engineTileX},${engineTileY},${d},0`);
                            this.segments.set(state.segmentId, { id: state.segmentId, points: state.points, nextIds });

                            branchDirs.forEach(d => {
                                queue.push({
                                    absX: state.absX, absY: state.absY,
                                    dir: d, curveFrame: 0,
                                    segmentId: `${engineTileX},${engineTileY},${d},0`,
                                    points: [], lastEvalX: engineTileX, lastEvalY: engineTileY, isFirst: true
                                });
                            });
                            segmentFinished = true;
                        } else if (n >= 0) {
                            if (n >= 8 && state.dir !== n) {
                                state.curveFrame = 0;
                            }
                            state.dir = n;
                        }
                    }
                }

                if (!segmentFinished) {
                    if (state.dir <= 3) {
                        state.absX += DIRS[state.dir].dx;
                        state.absY += DIRS[state.dir].dy;
                    } else {
                        const pair = CURVES[state.dir][state.curveFrame];
                        state.absX += pair.dx;
                        state.absY += pair.dy;
                        state.curveFrame = (state.curveFrame + 1) % 24;

                        if (state.curveFrame === 0 && !state.isFirst) {
                            const nextId = `${engineTileX},${engineTileY},${state.dir},0`;
                            this.segments.set(state.segmentId, { id: state.segmentId, points: state.points, nextIds: [nextId] });
                            queue.push({
                                absX: state.absX, absY: state.absY,
                                dir: state.dir, curveFrame: 0,
                                segmentId: nextId, points: [],
                                lastEvalX: state.lastEvalX, lastEvalY: state.lastEvalY, isFirst: true
                            });
                            segmentFinished = true;
                        }
                    }
                }
                state.isFirst = false;

                if (!segmentFinished && !this.segments.has(state.segmentId)) {
                    this.segments.set(state.segmentId, { id: state.segmentId, points: state.points, nextIds: [] });
                }
            }
        }
    }
}

const PATH_CACHE = new Map<number, FlyingPathManager>();

export function getPathManager(levelIndex: number, map: number[][]): FlyingPathManager {
    if (!PATH_CACHE.has(levelIndex)) {
        PATH_CACHE.set(levelIndex, new FlyingPathManager(map));
    }
    return PATH_CACHE.get(levelIndex)!;
}