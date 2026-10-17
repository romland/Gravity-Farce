import type { LevelPrefab } from '../../core/types';
import { getTileCategory } from '../../core/tile-masks';

const BASE_TILES = new Set([0x67, 0x68, 0x69, 0x6A, 0x6B, 0x6C, 0x6D, 0x6E, 0x7C]);
const BARREL_TILES = new Set([0x77, 0x78, 0x79, 0x7A, 0x7B, 0x86, 0x87, 0x88, 0x89, 0x8A, 0x8B, 0x8C, 0x8F]);
const GRAV_WELL_TILES = new Set([0x6F, 0x70, 0x71, 0x72]);
const MAST_TILES = new Set([0x7D, 0x7E, 0x7F, 0x80, 0x81, 0x82, 0x83]);
const RACE_MARKER_TILES = new Set([
    0x3B, 0x3C, 0x3D, 0x3E, 0x3F, 0x40, 0x41, 0x42,
    0x43, 0x44, 0x45, 0x46, 0x47, 0x48, 0x49, 0x4A, 0x4B, 0x4C, 0x4D, 0x4E
]);

export class ClusterPromoter {
    public static extractPrefabs(grid: number[][], tileSize: number = 32): LevelPrefab[] {
        const prefabs: LevelPrefab[] = [];
        const visited = new Set<string>();
        const h = grid.length;
        const w = h > 0 ? grid[0].length : 0;

        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                const key = `${x},${y}`;
                if (visited.has(key)) continue;

                const tid = grid[y][x];
                const family = this.getPrefabFamily(tid);
                if (!family) continue;

                const cluster = this.floodFillCluster(grid, x, y, family, visited);
                prefabs.push(this.clusterToPrefab(cluster, family, tid, tileSize));
            }
        }

        return prefabs;
    }

    private static getPrefabFamily(tid: number): LevelPrefab['kind'] | null {
        if (tid === 0x15 || tid === 0x29) return 'PAD';
        if (BASE_TILES.has(tid)) return 'BASE_STRUCTURE';
        if (BARREL_TILES.has(tid)) return 'BARREL_STACK';
        if (GRAV_WELL_TILES.has(tid)) return 'GRAVITY_EMITTER';
        if (MAST_TILES.has(tid)) return 'ANTENNA_MAST';
        if (RACE_MARKER_TILES.has(tid)) return 'RACE_MARKER';
        if (getTileCategory(tid) === 'TREE') return 'HERO_TREE';
        return null;
    }

    private static floodFillCluster(
        grid: number[][],
        startX: number,
        startY: number,
        family: LevelPrefab['kind'],
        visited: Set<string>
    ): { x: number; y: number; tid: number }[] {
        const cluster: { x: number; y: number; tid: number }[] = [];
        const queue: [number, number][] = [[startX, startY]];
        visited.add(`${startX},${startY}`);

        while (queue.length > 0) {
            const [cx, cy] = queue.shift()!;
            const tid = grid[cy][cx];
            cluster.push({ x: cx, y: cy, tid });

            const neighbors: [number, number][] = family === 'RACE_MARKER'
                ? [] // Race markers are strictly individual 32x32 tiles - never merge!
                : (family === 'PAD'
                    ? [[cx + 1, cy], [cx - 1, cy]] // Pads group strictly horizontally
                    : [[cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]]);

            for (const [nx, ny] of neighbors) {
                if (ny < 0 || ny >= grid.length || nx < 0 || nx >= grid[0].length) continue;
                const nKey = `${nx},${ny}`;
                if (visited.has(nKey)) continue;

                if (this.getPrefabFamily(grid[ny][nx]) === family) {
                    visited.add(nKey);
                    queue.push([nx, ny]);
                }
            }
        }

        return cluster;
    }

    private static clusterToPrefab(
        cluster: { x: number; y: number; tid: number }[],
        kind: LevelPrefab['kind'],
        primaryTileId: number,
        tileSize: number
    ): LevelPrefab {
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const c of cluster) {
            if (c.x < minX) minX = c.x;
            if (c.y < minY) minY = c.y;
            if (c.x > maxX) maxX = c.x;
            if (c.y > maxY) maxY = c.y;
        }

        return {
            kind,
            x: minX * tileSize,
            y: minY * tileSize,
            w: (maxX - minX + 1) * tileSize,
            h: (maxY - minY + 1) * tileSize,
            tileId: primaryTileId
        };
    }
}