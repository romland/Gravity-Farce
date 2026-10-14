import type { Point } from '../../core/types';
import { getTileCategory } from '../../core/tile-masks';

export interface SmoothedVertex {
    x: number;
    y: number;
    pinned: boolean;
    nx: number;
    ny: number;
}

interface WorkingVertex {
    x: number;
    y: number;
    origX: number;
    origY: number;
    pinned: boolean;
}

export class ContourSmoother {
    public static isVertexPinned(pt: Point, mapData: number[][], tilesW: number, tilesH: number): boolean {
        if (pt.x <= 0.5 || pt.x >= tilesW * 8 - 0.5 || pt.y <= 0.5 || pt.y >= tilesH * 8 - 0.5) {
            return true;
        }
        for (const dy of [-0.5, 0.5]) {
            for (const dx of [-0.5, 0.5]) {
                const tx = Math.floor((pt.x + dx) / 8.0);
                const ty = Math.floor((pt.y + dy) / 8.0);
                if (tx >= 0 && tx < tilesW && ty >= 0 && ty < tilesH) {
                    const cat = getTileCategory(mapData[ty][tx]);
                    if (cat === 'PAD' || cat === 'BRICK') {
                        return true;
                    }
                }
            }
        }
        return false;
    }

    public static smoothLoop(
        loop: Point[],
        mapData: number[][],
        tilesW: number,
        tilesH: number,
        iterations: number = 3
    ): SmoothedVertex[] {
        const dense = this.subdivideLoop(loop, mapData, tilesW, tilesH);
        this.applyLaplacian(dense, iterations);
        return this.applyMicroDisplacement(dense);
    }

    private static subdivideLoop(loop: Point[], mapData: number[][], tilesW: number, tilesH: number): WorkingVertex[] {
        const dense: WorkingVertex[] = [];
        const n = loop.length;

        for (let i = 0; i < n; i++) {
            const p1 = loop[i];
            const p2 = loop[(i + 1) % n];
            const dist = Math.hypot(p2.x - p1.x, p2.y - p1.y);
            const steps = Math.max(1, Math.ceil(dist / 1.5));

            const p1Pinned = this.isVertexPinned(p1, mapData, tilesW, tilesH);
            const p2Pinned = this.isVertexPinned(p2, mapData, tilesW, tilesH);
            const segPinned = p1Pinned && p2Pinned;

            for (let s = 0; s < steps; s++) {
                const t = s / steps;
                const px = p1.x + (p2.x - p1.x) * t;
                const py = p1.y + (p2.y - p1.y) * t;
                const pinned = s === 0 ? p1Pinned : (segPinned || this.isVertexPinned({ x: px, y: py }, mapData, tilesW, tilesH));
                dense.push({ x: px, y: py, origX: px, origY: py, pinned });
            }
        }
        return dense;
    }

    private static applyLaplacian(dense: WorkingVertex[], iterations: number) {
        const m = dense.length;
        for (let iter = 0; iter < iterations; iter++) {
            const nextX = new Float64Array(m);
            const nextY = new Float64Array(m);

            for (let i = 0; i < m; i++) {
                const curr = dense[i];
                if (curr.pinned) {
                    nextX[i] = curr.x;
                    nextY[i] = curr.y;
                    continue;
                }
                const prev = dense[(i - 1 + m) % m];
                const next = dense[(i + 1) % m];

                let nx = 0.25 * prev.x + 0.5 * curr.x + 0.25 * next.x;
                let ny = 0.25 * prev.y + 0.5 * curr.y + 0.25 * next.y;

                const dx = nx - curr.origX;
                const dy = ny - curr.origY;
                const d = Math.hypot(dx, dy);
                if (d > 0.55) {
                    nx = curr.origX + (dx / d) * 0.55;
                    ny = curr.origY + (dy / d) * 0.55;
                }
                nextX[i] = nx;
                nextY[i] = ny;
            }

            for (let i = 0; i < m; i++) {
                dense[i].x = nextX[i];
                dense[i].y = nextY[i];
            }
        }
    }

    private static applyMicroDisplacement(dense: WorkingVertex[]): SmoothedVertex[] {
        const m = dense.length;
        const out: SmoothedVertex[] = [];

        for (let i = 0; i < m; i++) {
            const curr = dense[i];
            const prev = dense[(i - 1 + m) % m];
            const next = dense[(i + 1) % m];

            const tx = next.x - prev.x;
            const ty = next.y - prev.y;
            const tlen = Math.hypot(tx, ty) || 1.0;
            const nx = -ty / tlen;
            const ny = tx / tlen;

            if (curr.pinned) {
                out.push({ x: curr.x, y: curr.y, pinned: true, nx, ny });
                continue;
            }

            const jitter = Math.sin(curr.origX * 1.7 + curr.origY * 2.3) * Math.cos(curr.origX * 3.1 - curr.origY * 1.3) * 0.22;
            out.push({
                x: curr.x + nx * jitter,
                y: curr.y + ny * jitter,
                pinned: false,
                nx,
                ny
            });
        }

        return out;
    }
}