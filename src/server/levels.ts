import type { LevelData } from './core/types';
import { LegacyTileGenerator } from './game/level-generators';
import fs from 'fs';
import path from 'path';

export type LevelCategory = 'mission' | 'race' | 'dogfight';

const SINGLEPLAYER_RACES = [ 50, 57 ];
const MULTIPLAYER_RACES = [ 54, 55, 56, 58, 59, 60, 61, 62, 63 ];
const MULTIPLAYER_DOGFIGHTS = [ 64, 65 ];

export function getLevelCategory(index: number): LevelCategory {
    if (index >= 0 && index <= 49) {
        return 'mission';
    }
    
    if (SINGLEPLAYER_RACES.includes(index) || MULTIPLAYER_RACES.includes(index)) {
        // Actually only two pure single player races.
        // But! Multiplayer races can easily be single player too.
        return 'race';
    }

    if(MULTIPLAYER_DOGFIGHTS.includes(index)) {
        return 'dogfight';
    }

    // garbage (illegal levels): 66 - 73 (at 74 we wrap to level 00)
    throw new Error(`Illegal cavern: ${index}`);
}

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
