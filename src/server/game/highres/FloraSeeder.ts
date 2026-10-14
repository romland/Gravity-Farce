import type { FloraAnchor } from '../../core/types';
import type { SmoothedVertex } from './ContourSmoother';

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

    public static generateFlora(
        smoothedLoops: SmoothedVertex[][],
        levelIndex: number,
        scaleToWorld: number = 4
    ): FloraAnchor[] {
        const anchors: FloraAnchor[] = [];

        for (const loop of smoothedLoops) {
            const m = loop.length;
            for (let i = 0; i < m; i += 2) {
                const v = loop[i];
                if (v.pinned) continue;

                const fertility = this.fertilityNoise(v.x, v.y, levelIndex);
                const rng = this.hash32(levelIndex, v.x, v.y);
                const wx = Number((v.x * scaleToWorld).toFixed(1));
                const wy = Number((v.y * scaleToWorld).toFixed(1));

                // Ceiling Hanging Vines (Outward normal pointing down into cavern air: ny > 0.65)
                if (v.ny > 0.60 && fertility > 0.35 && rng < 0.34) {
                    const length = Math.round((42 + rng * 95) * (0.8 + fertility * 0.7));
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
                else if (v.ny > 0.88 && rng > 0.96) {
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
                // Floor / Ledge Bioluminescent Spore Fronds & Cave Moss (Outward normal pointing up: ny < -0.65)
                else if (v.ny < -0.60 && fertility > 0.38 && rng < 0.30) {
                    anchors.push({
                        kind: rng < 0.12 ? 'GLOW_SHROOM' : 'FERN',
                        x: wx,
                        y: wy,
                        nx: Number(v.nx.toFixed(2)),
                        ny: Number(v.ny.toFixed(2)),
                        length: Math.round(32 + rng * 54),
                        seed: Number((rng * 100).toFixed(2))
                    });
                }
            }
        }

        return anchors;
    }
}