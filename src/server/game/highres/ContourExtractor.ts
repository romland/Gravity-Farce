import type { Point } from '../../core/types';

const EDGE_OFFSETS: [number, number][] = [
    [0.5, 0.0], // 0: Top
    [1.0, 0.5], // 1: Right
    [0.5, 1.0], // 2: Bottom
    [0.0, 0.5]  // 3: Left
];

const CELL_SEGMENTS: [number, number][][] = [
    [],                 // 0: 0000
    [[3, 2]],           // 1: 0001 (BL)
    [[2, 1]],           // 2: 0010 (BR)
    [[3, 1]],           // 3: 0011 (BL+BR)
    [[1, 0]],           // 4: 0100 (TR)
    [[3, 0], [1, 2]],   // 5: 0101 (BL+TR saddle)
    [[2, 0]],           // 6: 0110 (BR+TR)
    [[3, 0]],           // 7: 0111 (BL+BR+TR)
    [[0, 3]],           // 8: 1000 (TL)
    [[0, 2]],           // 9: 1001 (TL+BL)
    [[0, 1], [2, 3]],   // 10: 1010 (TL+BR saddle)
    [[0, 1]],           // 11: 1011 (TL+BL+BR)
    [[1, 3]],           // 12: 1100 (TL+TR)
    [[1, 2]],           // 13: 1101 (TL+TR+BL)
    [[2, 3]],           // 14: 1110 (TL+TR+BR)
    []                  // 15: 1111
];

export class ContourExtractor {
    public static extractLoops(solidGrid: number[][], width: number, height: number): Point[][] {
        const isSolid = (x: number, y: number): number => {
            if (x < 0 || x >= width || y < 0 || y >= height) {
                return 1; // Outside level bounds is solid bedrock
            }
            return solidGrid[y][x];
        };

        const segments: [Point, Point][] = [];
        for (let y = -1; y < height; y++) {
            for (let x = -1; x < width; x++) {
                const tl = isSolid(x, y) ? 8 : 0;
                const tr = isSolid(x + 1, y) ? 4 : 0;
                const br = isSolid(x + 1, y + 1) ? 2 : 0;
                const bl = isSolid(x, y + 1) ? 1 : 0;
                const idx = tl | tr | br | bl;

                for (const [e1, e2] of CELL_SEGMENTS[idx]) {
                    const p1 = { x: x + EDGE_OFFSETS[e1][0], y: y + EDGE_OFFSETS[e1][1] };
                    const p2 = { x: x + EDGE_OFFSETS[e2][0], y: y + EDGE_OFFSETS[e2][1] };
                    segments.push([p1, p2]);
                }
            }
        }

        return this.stitchSegments(segments);
    }

    private static stitchSegments(segments: [Point, Point][]): Point[][] {
        const key = (p: Point) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`;
        const startMap = new Map<string, number[]>();

        for (let i = 0; i < segments.length; i++) {
            const k = key(segments[i][0]);
            let list = startMap.get(k);
            if (!list) {
                list = [];
                startMap.set(k, list);
            }
            list.push(i);
        }

        const visited = new Uint8Array(segments.length);
        const loops: Point[][] = [];

        for (let i = 0; i < segments.length; i++) {
            if (visited[i]) continue;
            visited[i] = 1;

            const [p1, p2] = segments[i];
            const loop: Point[] = [p1, p2];
            let curr = p2;
            const startKey = key(p1);

            while (key(curr) !== startKey) {
                const cands = startMap.get(key(curr));
                if (!cands) break;

                let nxt = -1;
                for (const c of cands) {
                    if (!visited[c]) {
                        nxt = c;
                        break;
                    }
                }
                if (nxt === -1) break;

                visited[nxt] = 1;
                curr = segments[nxt][1];
                loop.push(curr);
            }

            if (loop.length >= 3 && key(loop[loop.length - 1]) === startKey) {
                loop.pop();
                loops.push(this.simplifyCollinear(loop));
            }
        }

        return loops;
    }

    private static simplifyCollinear(pts: Point[]): Point[] {
        const n = pts.length;
        if (n < 3) return pts;

        const out: Point[] = [];
        for (let i = 0; i < n; i++) {
            const prev = pts[(i - 1 + n) % n];
            const curr = pts[i];
            const next = pts[(i + 1) % n];
            const cross = (curr.y - prev.y) * (next.x - curr.x) - (curr.x - prev.x) * (next.y - curr.y);
            if (Math.abs(cross) > 1e-5) {
                out.push(curr);
            }
        }
        return out;
    }
}