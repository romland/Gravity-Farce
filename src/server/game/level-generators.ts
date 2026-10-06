import type { LevelData, Point, LevelEntity } from '../core/types';
import type { LevelGenerator } from '../core/level-generator';
import { TILE_DICTIONARY } from '../core/tiles';

export const TILE_SIZE = 32;

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
                const def = TILE_DICTIONARY[tile]?.entity;
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
        return { 
            ...def, 
            x: gridX * TILE_SIZE + TILE_SIZE / 2, 
            y: gridY * TILE_SIZE + TILE_SIZE / 2 
        };
    }

    private buildTurret(def: Omit<LevelEntity, 'x'|'y'>, gridX: number, gridY: number): LevelEntity {
        const isUp = def.props?.orientUp;
        return { 
            ...def, 
            x: gridX * TILE_SIZE + TILE_SIZE / 2, 
            y: isUp ? (gridY + 1) * TILE_SIZE : gridY * TILE_SIZE 
        };
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
        const walls = this.mesher.mesh(t => !!TILE_DICTIONARY[t]?.solid);
        const rawPads = this.mesher.mesh(t => !!TILE_DICTIONARY[t]?.pad);
        
        const pads = rawPads.map((p, idx) => this.polyToPadEntity(p, idx === rawPads.length - 1));
        const entities = this.extractor.extract(pads);

        return { 
            name: this.name, 
            width: this.grid[0].length * TILE_SIZE, 
            height: this.grid.length * TILE_SIZE,
            ceiling: [], 
            floor: [], 
            walls,
            entities: [...pads, ...entities],
            rawMap: this.grid
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
