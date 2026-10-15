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

export interface LevelPrefab {
    kind: 'PAD' | 'BASE_STRUCTURE' | 'BARREL_STACK' | 'GRAVITY_EMITTER' | 'ANTENNA_MAST' | 'HERO_TREE' | 'RACE_MARKER';
    x: number;
    y: number;
    w: number;
    h: number;
    tileId: number;
}

export interface FloraAnchor {
    kind: 'VINE' | 'FERN' | 'GLOW_SHROOM' | 'DRIP_EMITTER' | 'BROADLEAF' | 'CAVE_FLOWER';
    x: number;
    y: number;
    nx: number;
    ny: number;
    length: number;
    seed: number;
}

export interface LevelData {
    name: string;
    width: number;
    height: number;
    ceiling: Point[]; floor: Point[];
    walls: Point[][];
    entities: LevelEntity[];
    rawMap?: number[][];
    highRes?: {
        prefabs: LevelPrefab[];
        flora: FloraAnchor[];
        recessedWalls?: Point[][];
        recessedWidth?: number;
        recessedHeight?: number;
    };
}

export interface PlayerStats {
    score: number;
    race?: PlayerRaceState;
    uuid?: string;
    alias?: string;
    isBot?: boolean;
    joinedAt?: number;
    joinedAtTick?: number;
    shipType?: 'classic' | 'modern';
    ip?: string;
    lives?: number;
    shotsFired?: number;
    fuelConsumed?: number;
    homeSpawnX?: number;
    homeSpawnY?: number;
    streakScore?: number;
    streakStartLevel?: number;
    streakLastLevel?: number;
}

export interface BotState {
    active: boolean;
    role: 'pursuit' | 'intercept' | 'flank-high' | 'racer' | 'mission';
    targetId?: string;
    reactionTimer: number;
    state: 'takeoff' | 'evade' | 'attack' | 'roam' | 'seek_cargo' | 'return_base' | 'land_cargo' | 'land_base' | 'race';
    stateTimer: number;
    path: { x: number, y: number }[];
    pathTimer: number;
    pathPending?: boolean;
}
