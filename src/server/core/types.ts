export interface Point { x: number; y: number; }
export interface Pad { x: number; y: number; w: number; }

export interface Inputs {
    up: boolean; left: boolean;
    right: boolean; shoot: boolean;
}

export interface LevelData {
    name: string;
    ceiling: Point[]; floor: Point[];
    startPad: Pad; endPad: Pad;
    turrets: { x: number; y: number; orientUp: boolean }[];
}