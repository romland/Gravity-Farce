import type { LevelData, Point, LevelEntity } from '../core/types';
import type { LevelGenerator } from '../core/level-generator';

export const TILE_SIZE = 32;

const TILE_DEF: Record<number, { solid?: boolean; pad?: boolean; entity?: Omit<LevelEntity, 'x'|'y'> }> = {
    // Solid Lethal Walls
    0xBD: { solid: true }, 0x16: { solid: true }, 0x19: { solid: true },
    // Landing Pads (Safe Landable Surfaces)
    0x15: { pad: true }, 0x1B: { pad: true },
    0x28: { pad: true }, 0x29: { pad: true },
    // Spawns
    0x73: { entity: { type: 'spawn', props: { player: 1 } } },
    0x31: { entity: { type: 'spawn', props: { player: 2 } } },
    0x32: { entity: { type: 'spawn', props: { player: 3 } } },
    // Turrets & Objects
    // 0x74: { entity: { type: 'turret', props: { orientUp: false, homing: false } } },
    // 0x75: { entity: { type: 'turret', props: { orientUp: true, homing: false } } },
    0x76: { entity: { type: 'turret', props: { orientUp: true, homing: true } } },
    // Triggers / Gravity Wells
    0xCC: { entity: { type: 'trigger', props: { id: 0xCC } } },
    0xCF: { entity: { type: 'trigger', props: { id: 0xCF } } }
};

class GreedyMesher {
    constructor(private grid: number[][]) {}

    public mesh(matchFn: (tile: number) => boolean): Point[][] {
        const polys: Point[][] = [];
        const visited = new Set<string>();

        for (let y = 0; y < this.grid.length; y++) {
            for (let x = 0; x < this.grid[y].length; x++) {
                if (matchFn(this.grid[y][x]) && !visited.has(`${x},${y}`)) {
                    const w = this.getMeshWidth(x, y, matchFn, visited);
                    const h = this.getMeshHeight(x, y, w, matchFn, visited);
                    
                    this.markVisited(x, y, w, h, visited);
                    polys.push(this.createRect(x, y, w, h));
                }
            }
        }
        return polys;
    }

    private getMeshWidth(startX: number, y: number, matchFn: (tile: number) => boolean, visited: Set<string>): number {
        let w = 0;
        while (startX + w < this.grid[y].length && matchFn(this.grid[y][startX + w]) && !visited.has(`${startX + w},${y}`)) {
            w++;
        }
        return w;
    }

    private getMeshHeight(x: number, startY: number, w: number, matchFn: (tile: number) => boolean, visited: Set<string>): number {
        let h = 1;
        while (startY + h < this.grid.length && this.canExpandRow(x, startY + h, w, matchFn, visited)) {
            h++;
        }
        return h;
    }

    private canExpandRow(x: number, y: number, w: number, matchFn: (tile: number) => boolean, visited: Set<string>): boolean {
        for (let dx = 0; dx < w; dx++) {
            if (!matchFn(this.grid[y][x + dx]) || visited.has(`${x + dx},${y}`)) {
                return false;
            }
        }
        return true;
    }

    private markVisited(x: number, y: number, w: number, h: number, visited: Set<string>) {
        for (let dy = 0; dy < h; dy++) {
            for (let dx = 0; dx < w; dx++) {
                visited.add(`${x + dx},${y + dy}`);
            }
        }
    }

    private createRect(x: number, y: number, w: number, h: number): Point[] {
        const px = x * TILE_SIZE;
        const py = y * TILE_SIZE;
        const pw = w * TILE_SIZE;
        const ph = h * TILE_SIZE;
        
        return [ 
            { x: px, y: py }, 
            { x: px + pw, y: py }, 
            { x: px + pw, y: py + ph }, 
            { x: px, y: py + ph }, 
            { x: px, y: py } 
        ];
    }
}

class EntityExtractor {
    constructor(private grid: number[][]) {}

    public extract(pads: LevelEntity[]): LevelEntity[] {
        const entities: LevelEntity[] = [];
        for (let y = 0; y < this.grid.length; y++) {
            for (let x = 0; x < this.grid[y].length; x++) {
                const tile = this.grid[y][x];
                const def = TILE_DEF[tile]?.entity;
                if (def) {
                    entities.push(this.buildEntity(def, x, y, pads));
                }
            }
        }
        return entities;
    }

    private buildEntity(def: Omit<LevelEntity, 'x'|'y'>, x: number, y: number, pads: LevelEntity[]): LevelEntity {
        if (def.type === 'spawn') return this.buildSpawn(def, x, y, pads);
        if (def.type === 'turret') return this.buildTurret(def, x, y);
        
        return { 
            ...def, 
            x: x * TILE_SIZE + TILE_SIZE / 2, 
            y: y * TILE_SIZE + TILE_SIZE / 2 
        };
    }

    private buildSpawn(def: Omit<LevelEntity, 'x'|'y'>, gridX: number, gridY: number, pads: LevelEntity[]): LevelEntity {
        const posX = gridX * TILE_SIZE + TILE_SIZE / 2;
        const posY = gridY * TILE_SIZE + TILE_SIZE / 2;
        const pad = this.findNearestPad(posX, posY, pads);

        if (!pad || !pad.w) {
            return { ...def, x: posX, y: gridY * TILE_SIZE - 14 };
        }

        const pNum = def.props?.player || 1;
        const isWide = pad.w >= 48;
        const adjustedX = isWide ? (pNum === 1 ? pad.x + 24 : pad.x + pad.w - 24) : pad.x + pad.w / 2;

        return { ...def, x: adjustedX, y: pad.y - 14 };
    }

    private buildTurret(def: Omit<LevelEntity, 'x'|'y'>, gridX: number, gridY: number): LevelEntity {
        const isUp = def.props?.orientUp;
        return { 
            ...def, 
            x: gridX * TILE_SIZE + TILE_SIZE / 2, 
            y: isUp ? (gridY + 1) * TILE_SIZE : gridY * TILE_SIZE 
        };
    }

    private findNearestPad(x: number, y: number, pads: LevelEntity[]): LevelEntity | null {
        let nearest: LevelEntity | null = null;
        let minDist = Infinity;
        
        for (const pad of pads) {
            if (!pad.w) continue;
            const padCenterX = pad.x + pad.w / 2;
            const dist = Math.hypot(x - padCenterX, y - pad.y);
            
            if (dist < minDist) {
                minDist = dist;
                nearest = pad;
            }
        }
        return nearest;
    }
}

export class LegacyTileGenerator implements LevelGenerator {
    private mesher: GreedyMesher;
    private extractor: EntityExtractor;

    constructor(private name: string, private grid: number[][]) {
        this.mesher = new GreedyMesher(grid);
        this.extractor = new EntityExtractor(grid);
    }

    generate(index: number): LevelData {
        const walls = this.mesher.mesh(t => !!TILE_DEF[t]?.solid);
        const rawPads = this.mesher.mesh(t => !!TILE_DEF[t]?.pad);
        
        const pads = rawPads.map((p, idx) => this.polyToPadEntity(p, idx === rawPads.length - 1));
        const entities = this.extractor.extract(pads);

        return { 
            name: this.name, 
            width: this.grid[0].length * TILE_SIZE, 
            height: this.grid.length * TILE_SIZE,
            ceiling: [], 
            floor: [], 
            walls,
            entities: [...pads, ...entities] 
        };
    }

    private polyToPadEntity(poly: Point[], isEndPad: boolean): LevelEntity {
        // poly[0] is top-left, poly[2] is bottom-right
        return {
            type: 'pad',
            x: poly[0].x,
            y: poly[0].y,
            w: poly[2].x - poly[0].x,
            h: poly[2].y - poly[0].y,
            props: { isEndPad }
        };
    }
}
