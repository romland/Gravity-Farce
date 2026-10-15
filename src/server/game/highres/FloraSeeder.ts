import type { FloraAnchor } from '../../core/types';
import type { SmoothedVertex } from './ContourSmoother';
import { TILE_DICTIONARY } from '../../core/tiles';

export const FLORA_SEED_CONFIG = {
    vertexStep: 2,
    vineMinNormalY: 0.60,
    vineMinFertility: 0.35,
    vineSpawnChance: 0.34,
    vineBaseLength: 42,
    vineVarLength: 95,
    dripMinNormalY: 0.88,
    dripSpawnThreshold: 0.96,
    floorMaxNormalY: -0.60,
    floorMinFertility: 0.38,
    floorSpawnChance: 0.30,
    shroomChance: 0.12,
    flowerChance: 0.19,
    broadleafChance: 0.25,
    floorBaseLength: 32,
    floorVarLength: 54
};

export class FloraSeeder {
    private static hash32(levelIndex: number, x: number, y: number): number {
        let h = (levelIndex * 374761393) ^ (Math.floor(x * 10) * 668265263) ^ (Math.floor(y * 10) * 2147483647);
        h = Math.imul(h ^ (h >>> 13), 1274126177);
        return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
    }

    private static fertilityNoise(x: number, y: number, levelIndex: number): number {
        const s1 = Math.sin(x * 0.045 + levelIndex * 1.7) * Math.cos(y * 0.045 - levelIndex * 0.9);
        const s2 = Math.sin(x * 0.11 - y * 0.08 + levelIndex);
        return (s1 * 0.65 + s2 * 0.35 + 1.0) * 0.5;
    }

    private static clampLengthToAir(
        wx: number,
        wy: number,
        dirY: number,
        desiredLength: number,
        rawMap?: number[][]
    ): number {
        if (!rawMap || rawMap.length === 0) return desiredLength;
        const mapH = rawMap.length;
        const mapW = rawMap[0].length;
        const tx = Math.floor(wx / 32);
        if (tx < 0 || tx >= mapW) return 0;

        let maxLen = 0;
        for (let d = 12; d <= desiredLength; d += 8) {
            const probeY = wy + dirY * d;
            const ty = Math.floor(probeY / 32);
            if (ty < 0 || ty >= mapH) break;
            const tid = rawMap[ty]?.[tx] ?? 0;
            if (TILE_DICTIONARY[tid]?.solid || TILE_DICTIONARY[tid]?.pad) break;
            maxLen = d;
        }
        return maxLen;
    }

    public static generateFlora(
        smoothedLoops: SmoothedVertex[][],
        levelIndex: number,
        scaleToWorld: number = 4,
        rawMap?: number[][]
    ): FloraAnchor[] {
        const anchors: FloraAnchor[] = [];
        const cfg = FLORA_SEED_CONFIG;

        for (const loop of smoothedLoops) {
            const m = loop.length;
            for (let i = 0; i < m; i += cfg.vertexStep) {
                const v = loop[i];
                if (v.pinned) continue;

                const fertility = this.fertilityNoise(v.x, v.y, levelIndex);
                const rng = this.hash32(levelIndex, v.x, v.y);
                const wx = Number((v.x * scaleToWorld).toFixed(1));
                const wy = Number((v.y * scaleToWorld).toFixed(1));

                // Ceiling Hanging Vines (Outward normal pointing down into cavern air: ny > 0.60)
                if (v.ny > cfg.vineMinNormalY && fertility > cfg.vineMinFertility && rng < cfg.vineSpawnChance) {
                    const rawLen = Math.round((cfg.vineBaseLength + rng * cfg.vineVarLength) * (0.8 + fertility * 0.7));
                    const length = this.clampLengthToAir(wx, wy, 1, rawLen, rawMap);
                    if (length < 20) continue;
                    anchors.push({
                        kind: 'VINE',
                        x: wx,
                        y: wy,
                        nx: Number(v.nx.toFixed(2)),
                        ny: Number(v.ny.toFixed(2)),
                        length,
                        seed: Number((rng * 100).toFixed(2))
                    });
                }
                // Ceiling Water Drip Emitters
                else if (v.ny > cfg.dripMinNormalY && rng > cfg.dripSpawnThreshold) {
                    anchors.push({
                        kind: 'DRIP_EMITTER',
                        x: wx,
                        y: wy,
                        nx: 0,
                        ny: 1,
                        length: 0,
                        seed: Number((rng * 100).toFixed(2))
                    });
                }
                // Floor / Ledge Bioluminescent Spore Fronds & Cave Moss (Outward normal pointing up: ny < -0.60)
                else if (v.ny < cfg.floorMaxNormalY && fertility > cfg.floorMinFertility && rng < cfg.floorSpawnChance) {
                    let kind: FloraAnchor['kind'] = 'FERN';
                    if (rng < cfg.shroomChance) {
                        kind = 'GLOW_SHROOM';
                    } else if (rng < cfg.flowerChance) {
                        kind = 'CAVE_FLOWER';
                    } else if (rng < cfg.broadleafChance) {
                        kind = 'BROADLEAF';
                    }
                    const rawLen = Math.round(cfg.floorBaseLength + rng * cfg.floorVarLength);
                    const length = this.clampLengthToAir(wx, wy, -1, rawLen, rawMap);
                    if (length < 16) continue;
                    anchors.push({
                        kind,
                        x: wx,
                        y: wy,
                        nx: Number(v.nx.toFixed(2)),
                        ny: Number(v.ny.toFixed(2)),
                        length,
                        seed: Number((rng * 100).toFixed(2))
                    });
                }
            }
        }

        return anchors;
    }
}