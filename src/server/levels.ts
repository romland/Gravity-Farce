import type { LevelData } from './core/types';
import { LegacyTileGenerator } from './game/level-generators';
import fs from 'fs';
import path from 'path';

function createPRNG(seed: number) {
    return function() {
        let t = seed += 0x6D2B79F5;
        t = Math.imul(t ^ t >>> 15, t | 1);
        t ^= t + Math.imul(t ^ t >>> 7, t | 61);
        return ((t ^ t >>> 14) >>> 0) / 4294967296;
    }
}

let orgLevelsData: any[] = [];
try {
    const rawData = fs.readFileSync(path.join(process.cwd(), 'src/server/data/org-levels.json'), 'utf-8');
    orgLevelsData = JSON.parse(rawData);
    console.log(`Loaded ${orgLevelsData.length} classic levels from JSON.`);
} catch (e) {
    console.warn("Could not load org-levels.json. Did you run the extractor?", e);
}

export function getLevelData(index: number): LevelData {
    const maxLevels = Math.max(1, orgLevelsData.length);
    let safeIndex = index % maxLevels;
    
    if (safeIndex < 0) {
        safeIndex += maxLevels;
    }
    
    const levelJson = orgLevelsData[safeIndex];
    const generator = new LegacyTileGenerator(`CAVERN ${String(safeIndex).padStart(2, '0')}`, levelJson.map_data);
    return generator.generate(safeIndex);
}
