import fs from 'fs';
import path from 'path';

/**
 * Defines how a record is evaluated against others.
 * 'asc' = Lower is better (e.g., Fastest Lap time in milliseconds)
 * 'desc' = Higher is better (e.g., Highest Score)
 */
export type SortOrder = 'asc' | 'desc';

export interface RecordEntry {
    playerId: string; // Persistent UUID
    alias: string;    // 3-Letter Alias
    fullName?: string; // Future: Profile Name
    password?: string; // Future: Auth Hash
    
    value: number;
    timestamp: number;
    metadata?: any;   // Flexible payload (e.g., { shipType: 'modern', lap: 2 })
}

export interface Leaderboard {
    sort: SortOrder;
    entries: RecordEntry[];
}

/**
 * A generic, JSON-backed persistent data store for game records.
 * Automatically categorizes records by game mode, map, and physics rulesets.
 */
export class RecordManager {
    private dbPath: string;
    private db: Record<string, Leaderboard> = {};

    constructor(filename: string = 'server_records.json') {
        this.dbPath = path.resolve(process.cwd(), filename);
        this.load();
    }

    /**
     * Generates a deterministic hash representing the current physical constraints.
     * Highscores MUST be connected to the settings they were achieved under.
     */
    public generatePhysicsHash(settings: { gravity: number; thrust: number; maxSpeed: number }): string {
        // Simple lightweight string hash for physics vars
        const payload = `${settings.gravity}_${settings.thrust}_${settings.maxSpeed}`;
        let hash = 0;
        for (let i = 0; i < payload.length; i++) {
            hash = Math.imul(31, hash) + payload.charCodeAt(i) | 0;
        }
        return hash.toString(16);
    }

    /**
     * Builds the composite key for strict categorical isolation.
     */
    private getCompositeKey(metric: string, level: number, mode: 'SP' | 'MP', physicsHash: string): string {
        return `${metric}:lvl_${level}:${mode}:phys_${physicsHash}`;
    }

    /**
     * Submits a new record. If it qualifies for the top N of its category, it is saved.
     */
    public submitRecord(
        metric: string, 
        level: number, 
        mode: 'SP' | 'MP', 
        physicsHash: string, 
        sort: SortOrder,
        entry: Omit<RecordEntry, 'timestamp'>,
        limit: number = 10
    ): boolean {
        const key = this.getCompositeKey(metric, level, mode, physicsHash);
        
        if (!this.db[key]) {
            this.db[key] = { sort, entries: [] };
        }

        const board = this.db[key];
        const newEntry: RecordEntry = { ...entry, timestamp: Date.now() };
        
        board.entries.push(newEntry);

        // Sort dynamically based on the metric's requirement
        board.entries.sort((a, b) => {
            return board.sort === 'asc' ? a.value - b.value : b.value - a.value;
        });

        // Enforce board size limit
        if (board.entries.length > limit) {
            board.entries = board.entries.slice(0, limit);
        }

        // If the entry is still in the array after slicing, it made the leaderboard!
        const madeLeaderboard = board.entries.some(e => e === newEntry);
        
        if (madeLeaderboard) {
            this.save();
        }

        return madeLeaderboard;
    }

    public getRecords(metric: string, level: number, mode: 'SP' | 'MP', physicsHash: string): RecordEntry[] {
        const key = this.getCompositeKey(metric, level, mode, physicsHash);
        return this.db[key]?.entries || [];
    }

    private load() {
        if (fs.existsSync(this.dbPath)) {
            this.db = JSON.parse(fs.readFileSync(this.dbPath, 'utf8'));
        }
    }

    private save() {
        fs.writeFileSync(this.dbPath, JSON.stringify(this.db, null, 2));
    }
}

export const recordDB = new RecordManager();
