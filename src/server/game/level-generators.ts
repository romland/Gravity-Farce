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
    0xE2: { entity: { type: 'spawn', props: { player: 1 } } },
    // 0x31: { entity: { type: 'spawn', props: { player: 2 } } }, // TODO: Verify P2 on grid
    // 0x32: { entity: { type: 'spawn', props: { player: 3 } } }, // TODO: Verify P3 on grid
    // Turrets & Objects
    // 0x74: { entity: { type: 'turret', props: { orientUp: false, homing: false } } },
    // 0x75: { entity: { type: 'turret', props: { orientUp: true, homing: false } } },
    // 0x76: { entity: { type: 'turret', props: { orientUp: true, homing: true } } },
    // Triggers / Gravity Wells
    0xCC: { entity: { type: 'trigger', props: { id: 0xCC } } },
    0xCF: { entity: { type: 'trigger', props: { id: 0xCF } } }
};
/*
0x01    right side diagonal rock
0x02    some rock dent / hole
0x03    some rock dent / hole
0x04    right side sloped rock
0x05    right side sloped rock
0x06    right side rock / some rock dent / hole
0x07    right side rock / some rock dent / hole
0x08    some rock dent / hole
0x09    vertical left thin rock start
0x0A    some right side rock
0x0B    diagonal left rock
0x0C    vertical left thin rock with spike
0x0D    some rock
0x0E    rock dent at bottom
0x0F    some rock
0x10    horizontal thinner rock transitioning to upper rock / ?? rock
0x11    some rock
0x12    horizontal rock transitioning to thinner upper rock
0x13    rock slope up?
0x14    some rock
0x15    Base pad
0x16    full rock
0x17
0x18    vertical left thin rock end
0x19    full rock with spike
0x1A    right side rock
0x1B    teal brick 2x2
0x1C    teal brick
0x1D    teal brick
0x1E    teal brick 2 + bottom left 1
0x1F    teal brick
0x20
0x21
0x22
0x23
0x24    teal brick 1 bottom right
0x25    some teal brick
0x26    some teal brick
0x27    some teal brick
0x28
0x29    Landing pad
0x2A    Tree
0x2B    Tree
0x2C    Tree
0x2D    Tree
0x2E    Tree
0x2F
0x30
0x31    Tree part
0x32    Enemy: Tank path (spawn?)
0x33    Enemy: Tank path
0x34    Tree left bottom
0x35    Tree left mid
0x36    Tree left top
0x37    Tree right mid
0x38    Tree right top
0x39    Tree related?
0x3A    Tree
0x3B    Race: Blinking checkpoint 1
0x3C    Race: Blinking checkpoint 2
0x3D    Race: Blinking checkpoint 3
0x3E    Race: Blinking checkpoint 4
0x3F    Race: Blinking checkpoint 5
0x40    Race: Blinking checkpoint 6
0x41    Race: Blinking checkpoint 7
0x42    Race: Blinking checkpoint 8
0x43    Race: Bottom checkpoint number holder
0x44    Race: Bottom checkpoint number holder
0x45    Race: Bottom checkpoint number holder
0x46    Race: Left-side checkpoint number holder
0x47    Race: Left-side checkpoint number holder
0x48    Race: Left-side checkpoint number holder
0x49    Race: Top checkpoint number holder (3)
0x4A    Race: Top checkpoint number holder (2)
0x4B    Race: Top checkpoint number holder (1)
0x4C    Race: Right-side checkpoint number holder
0x4D    Race: Right-side checkpoint number holder
0x4E    Race: Right-side checkpoint number holder
0x4F
0x50
0x51
0x52
0x53
0x54
0x55
0x56
0x57
0x58
0x59
0x5A
0x5B
0x5C
0x5D
0x5E    right side rock
0x5F    right side rock
0x60    right side rock
0x61    some right side rock
0x62    some right side rock
0x63    some right side rock
0x64    some top-side rock
0x65    some top-side rock
0x66    some top-side rock
0x67    Decorative base
0x68    Decorative base
0x69    Decorative base
0x6A    Decorative base
0x6B    Decorative base
0x6C    Decorative base
0x6D    Decorative base
0x6E    Decorative base
0x6F
0x70
0x71
0x72
0x73    bottom thin rock?
0x74    vertical left thin rock
0x75    horizontal thinner upper rock
0x76    right side rock
0x77    Teal decorative boxes/barrels
0x78
0x79    Teal decorative boxes/barrels
0x7A    Teal decorative boxes/barrels
0x7B    Teal decorative boxes/barrels
0x7C
0x7D    Blinking pole
0x7E    Blinking pole
0x7F
0x80
0x81
0x82    blinking pole bottom (smaller than the other?)
0x83    blinking pole top (smaller than the other?)
0x84
0x85
0x86    Teal decorative boxes/barrels
0x87    Teal decorative boxes/barrels
0x88    Teal decorative boxes/barrels
0x89    Teal decorative boxes/barrels
0x8A    Teal decorative boxes/barrels
0x8B    Teal decorative boxes/barrels
0x8C
0x8D
0x8E
0x8F    Teal decorative boxes/barrels
...
0xD1    Pickup package / objective
0xDA    Race objective 1 (invisible start line)
0xDB    Race objective 2 (invisible checkpoint line)
0xDC    Race objective 3 (invisible checkpoint line)
0xDD    Race objective 4 (invisible checkpoint line)
0xDE    Race objective 5 (invisible checkpoint line)
0xDF    Race objective 6 (invisible checkpoint line)
0xE0    Race objective 7 (invisible checkpoint line)
0xE1    Race objective 8 (invisible checkpoint line)

0xE2    Multi-player P1 race start
0xE3    Multi-player P2 race start (for some reason I also see this on a single player level. Not sure why)

0xE7    Enemy path
0xF0    Enemy path
0xF1    Enemy path
0xF2    Enemy path
0xF3    Enemy path
0xF8    Enemy path
0xF9    Enemy path
0xFA    Enemy path
0xFB    Enemy path
*/

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
