import type { LevelData } from './core/types';
import { LegacyTileGenerator } from './game/level-generators';
import fs from 'fs';
import path from 'path';

export type LevelCategory = 'mission' | 'race' | 'dogfight';

const SINGLEPLAYER_RACES = [ 50, 51, 53, 57 ];
const MULTIPLAYER_RACES = [ 52, 54, 55, 56, 58, 59, 60, 61, 62, 63 ];
const MULTIPLAYER_DOGFIGHTS = [ 64, 65 ];

export function getLevelCategory(index: number): LevelCategory {
    if (index >= 0 && index <= 49) {
        return 'mission';
    }
    
    // Multiplayer races can easily be single player too (not that we distinguish between it in here).
    if (SINGLEPLAYER_RACES.includes(index) || MULTIPLAYER_RACES.includes(index)) {
        return 'race';
    }

    if(MULTIPLAYER_DOGFIGHTS.includes(index)) {
        return 'dogfight';
    }

    // garbage (illegal levels): 66 - 73 (at 74 we wrap to level 00)
    throw new Error(`Illegal cavern: ${index}`);
}

export function getSiblingLevelRawGrid(index: number): number[][] | undefined {
    const validCount = Math.min(66, orgLevelsData.length);
    if (validCount <= 1) return orgLevelsData[0]?.map_data;
    let siblingIdx = ((index * 37) + 13) % validCount;
    if (siblingIdx === index) {
        siblingIdx = (index + 7) % validCount;
    }
    return orgLevelsData[siblingIdx]?.map_data;
}

let orgLevelsData: any[] = [];
try {
    const rawData = fs.readFileSync(path.join(process.cwd(), 'src/server/data/org-levels.json'), 'utf-8');
    orgLevelsData = JSON.parse(rawData);
    console.log(`Loaded ${orgLevelsData.length} classic levels from JSON.`);
} catch (e) {
    console.warn("Could not load org-levels.json. Did you run the extractor?", e);
}

const compiledLevelCache = new Map<number, LevelData>();

export function getLevelCount(): number {
    return Math.max(1, orgLevelsData.length);
}

export function getLevelData(index: number): LevelData {
    const maxLevels = Math.max(1, orgLevelsData.length);
    let safeIndex = index % maxLevels;
    
    if (safeIndex < 0) {
        safeIndex += maxLevels;
    }
    
    if (!compiledLevelCache.has(safeIndex)) {
        const levelJson = orgLevelsData[safeIndex];
        if (!levelJson || !levelJson.map_data) {
            const dummyGrid = Array.from({length: 20}, () => Array(30).fill(0));
            const generator = new LegacyTileGenerator(`CAVERN ${String(safeIndex).padStart(2, '0')}`, dummyGrid);
            compiledLevelCache.set(safeIndex, generator.generate(safeIndex));
        } else {
            const cleanGrid = levelJson.map_data.map((row: number[]) => [...row]);
            const siblingGrid = getSiblingLevelRawGrid(safeIndex);
            const generator = new LegacyTileGenerator(`CAVERN ${String(safeIndex).padStart(2, '0')}`, cleanGrid, siblingGrid);
            compiledLevelCache.set(safeIndex, generator.generate(safeIndex));
        }
    }

    const cached = compiledLevelCache.get(safeIndex)!;
    return {
        ...cached,
        rawMap: cached.rawMap ? cached.rawMap.map(row => [...row]) : undefined
    };
}
