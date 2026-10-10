export interface Point { x: number; y: number; }
export interface Pad { x: number; y: number; w: number; }
import type { PlayerRaceState } from './ecs';

export interface Inputs {
    up: boolean; left: boolean;
    right: boolean; shoot: boolean;
}

export interface LevelEntity {
    type: string;
    x: number; y: number; w?: number; h?: number;
    props?: any;
}

export interface LevelData {
    name: string;
    width: number;
    height: number;
    ceiling: Point[]; floor: Point[];
    walls: Point[][];
    entities: LevelEntity[];
    rawMap?: number[][];
}

export interface PlayerStats {
    score: number;
    race?: PlayerRaceState;
    uuid?: string;
    alias?: string;
    joinedAt?: number;
    shipType?: 'classic' | 'modern';
}
