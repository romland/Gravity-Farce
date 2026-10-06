import type { LevelData } from './types';

export interface LevelGenerator {
    generate(index: number): LevelData;
}