import fs from 'fs';
import path from 'path';

/**
 * Defines how a record is evaluated against others.
 * 'asc' = Lower is better (e.g., Fastest Lap time in milliseconds)
 * 'desc' = Higher is better (e.g., Highest Score)
 */
export type SortOrder = 'asc' | 'desc' | 'asc_desc' | 'asc_asc' | 'desc_asc' | 'desc_desc';

export interface RecordEntry {
    playerId: string; // Persistent UUID
    alias: string;    // 3-Letter Alias
    fullName?: string; // Future: Profile Name
    password?: string; // Future: Auth Hash
    
    value: number;
    secondaryValue?: number;
    timestamp: number;
    metadata?: any;   // Flexible payload (e.g., { shipType: 'modern', lap: 2 })
}

export interface Leaderboard {
    sort: SortOrder;
    entries: RecordEntry[];
}

export interface SubmitResult {
    isNewPb: boolean;
    rank: number; // 1-based rank. -1 if they didn't make the cut.
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
        limit: number = 100
    ): SubmitResult {
        const key = this.getCompositeKey(metric, level, mode, physicsHash);
        
        if (!this.db[key]) {
            this.db[key] = { sort, entries: [] };
        }

        const board = this.db[key];
        let isNewPb = false;

        // Enforce 1 Entry Per Player (Personal Best)
        const existingIdx = board.entries.findIndex(e => e.playerId === entry.playerId);
        if (existingIdx !== -1) {
            const existing = board.entries[existingIdx];
            
            let isBetter = false;
            if (entry.value !== existing.value) {
                isBetter = board.sort.startsWith('asc') ? entry.value < existing.value : entry.value > existing.value;
            } else {
                const secNew = entry.secondaryValue ?? 0;
                const secOld = existing.secondaryValue ?? 0;
                if (board.sort.endsWith('_asc')) isBetter = secNew < secOld;
                else if (board.sort.endsWith('_desc')) isBetter = secNew > secOld;
            }

            if (isBetter) {
                board.entries[existingIdx] = { ...existing, ...entry, timestamp: Date.now() };
                isNewPb = true;
            }
        } else {
            board.entries.push({ ...entry, timestamp: Date.now() });
            isNewPb = true;
        }

        // Sort dynamically based on the metric's requirement
        board.entries.sort((a, b) => {
            if (a.value !== b.value) {
                return board.sort.startsWith('asc') ? a.value - b.value : b.value - a.value;
            }
            const secA = a.secondaryValue ?? 0;
            const secB = b.secondaryValue ?? 0;
            if (board.sort.endsWith('_asc')) return secA - secB;
            if (board.sort.endsWith('_desc')) return secB - secA;
            
            return a.timestamp - b.timestamp; // Oldest PB wins tiebreakers
        });

        // Enforce board size limit
        if (board.entries.length > limit) {
            board.entries = board.entries.slice(0, limit);
        }

        const finalIdx = board.entries.findIndex(e => e.playerId === entry.playerId);
        const madeLeaderboard = finalIdx !== -1;

        if (madeLeaderboard && isNewPb) {
            this.save();
        }

        return { isNewPb: madeLeaderboard && isNewPb, rank: madeLeaderboard ? finalIdx + 1 : -1 };
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

export function formatTimeMs(diff: number): string {
    let m = Math.floor(diff / 60000).toString().padStart(2, '0');
    let s = Math.floor((diff % 60000) / 1000).toString().padStart(2, '0');
    let ms = Math.floor((diff % 1000) / 10).toString().padStart(2, '0');
    return `${m}:${s}.${ms}`;
}

/**
 * Builds a contextual array for the client UI showing the Top N, plus the player's immediate neighbors.
 */
export function buildLeaderboardContext(
    metric: string, level: number, mode: 'SP' | 'MP', physicsHash: string,
    playerId: string, isNewPb: boolean, formatFn: (e: RecordEntry) => string, topN: number = 5
) {
    const records = recordDB.getRecords(metric, level, mode, physicsHash);
    const pIdx = records.findIndex(e => e.playerId === playerId);
    const results = [];
    
    for (let i = 0; i < Math.min(topN, records.length); i++) {
        results.push({
            rankLabel: `#${i+1}`, alias: records[i].alias, displayValue: formatFn(records[i]),
            isMe: i === pIdx, isNewPb: i === pIdx && isNewPb
        });
    }
    
    if (pIdx >= topN) {
        if (pIdx > topN) {
            results.push({ rankLabel: '...', alias: '...', displayValue: '', isMe: false });
        }
        if (pIdx - 1 >= topN) {
            results.push({ rankLabel: `#${pIdx}`, alias: records[pIdx-1].alias, displayValue: formatFn(records[pIdx-1]), isMe: false });
        }
        results.push({ rankLabel: `#${pIdx+1}`, alias: records[pIdx].alias, displayValue: formatFn(records[pIdx]), isMe: true, isNewPb });
        if (pIdx + 1 < records.length) {
            results.push({ rankLabel: `#${pIdx+2}`, alias: records[pIdx+1].alias, displayValue: formatFn(records[pIdx+1]), isMe: false });
        }
    } else if (pIdx === -1 && records.length > 0) {
         results.push({ rankLabel: '...', alias: 'DID NOT QUALIFY', displayValue: '', isMe: true });
    }
    
    return results;
}