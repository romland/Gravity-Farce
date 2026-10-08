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
    timestamp?: number;
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

        const playerEntries = board.entries.filter(e => e.playerId === entry.playerId);
        const isBetterThan = (newItem: { value: number; secondaryValue?: number }, oldItem: { value: number; secondaryValue?: number }) => {
            if (newItem.value !== oldItem.value) {
                return board.sort.startsWith('asc') ? newItem.value < oldItem.value : newItem.value > oldItem.value;
            }
            const secNew = newItem.secondaryValue ?? 0;
            const secOld = oldItem.secondaryValue ?? 0;
            if (board.sort.endsWith('_asc')) return secNew < secOld;
            if (board.sort.endsWith('_desc')) return secNew > secOld;
            return false;
        };

        // Determine if this submission beats the player's previous personal best
        if (playerEntries.length === 0) {
            isNewPb = true;
        } else {
            let bestExisting = playerEntries[0];
            for (const pe of playerEntries) {
                if (isBetterThan(pe, bestExisting)) {
                    bestExisting = pe;
                }
            }
            if (isBetterThan(entry, bestExisting)) {
                isNewPb = true;
            }
        }

        const newTimestamp = Date.now();
        const newEntry: RecordEntry = { ...entry, timestamp: newTimestamp };

        if (playerEntries.length < 3) {
            board.entries.push(newEntry);
        } else {
            playerEntries.sort((a, b) => {
                if (a.value !== b.value) {
                    return board.sort.startsWith('asc') ? a.value - b.value : b.value - a.value;
                }
                const secA = a.secondaryValue ?? 0;
                const secB = b.secondaryValue ?? 0;
                if (board.sort.endsWith('_asc')) return secA - secB;
                if (board.sort.endsWith('_desc')) return secB - secA;
                return a.timestamp - b.timestamp;
            });
            const worstPlayerEntry = playerEntries[playerEntries.length - 1];
            if (isBetterThan(entry, worstPlayerEntry)) {
                const idx = board.entries.indexOf(worstPlayerEntry);
                if (idx !== -1) board.entries.splice(idx, 1);
                board.entries.push(newEntry);
            }
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

        const finalIdx = board.entries.findIndex(e => e.playerId === entry.playerId && e.timestamp === newTimestamp);
        const madeLeaderboard = finalIdx !== -1;

        if (madeLeaderboard) {
            this.save();
        }

        return { isNewPb: madeLeaderboard && isNewPb, rank: madeLeaderboard ? finalIdx + 1 : -1, timestamp: newTimestamp };
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
    playerId: string, isNewPb: boolean, 
    arg7: number | undefined | ((e: RecordEntry) => string), 
    arg8?: ((e: RecordEntry) => string) | number, 
    arg9: number = 10
) {
    let newEntryTimestamp: number | undefined = undefined;
    let formatFn: (e: RecordEntry) => string = x => String(x.value);
    let topN = arg9;

    if (typeof arg7 === 'function') {
        formatFn = arg7;
        if (typeof arg8 === 'number') topN = arg8;
    } else {
        newEntryTimestamp = arg7;
        if (typeof arg8 === 'function') formatFn = arg8;
    }

    const records = recordDB.getRecords(metric, level, mode, physicsHash);
    const pIdx = newEntryTimestamp !== undefined
        ? records.findIndex(e => e.playerId === playerId && e.timestamp === newEntryTimestamp)
        : records.findIndex(e => e.playerId === playerId);
        
    const results = [];
    
    for (let i = 0; i < Math.min(topN, records.length); i++) {
        const rec = records[i];
        const isMe = rec.playerId === playerId;
        const isThisNewPb = isMe && isNewPb && rec.timestamp === newEntryTimestamp;
        results.push({
            rankLabel: `#${i+1}`, alias: rec.alias, displayValue: formatFn(rec),
            isMe, isNewPb: isThisNewPb
        });
    }
    
    if (pIdx >= topN) {
        if (pIdx > topN) {
            results.push({ rankLabel: '...', alias: '...', displayValue: '', isMe: false, isNewPb: false });
        }
        if (pIdx - 1 >= topN) {
            const rec = records[pIdx-1];
            results.push({ rankLabel: `#${pIdx}`, alias: rec.alias, displayValue: formatFn(rec), isMe: rec.playerId === playerId, isNewPb: false });
        }
        const recMe = records[pIdx];
        results.push({ rankLabel: `#${pIdx+1}`, alias: recMe.alias, displayValue: formatFn(recMe), isMe: true, isNewPb: isNewPb && (newEntryTimestamp === undefined || recMe.timestamp === newEntryTimestamp) });
        if (pIdx + 1 < records.length) {
            const recNext = records[pIdx+1];
            results.push({ rankLabel: `#${pIdx+2}`, alias: recNext.alias, displayValue: formatFn(recNext), isMe: recNext.playerId === playerId, isNewPb: false });
        }
    } else if (pIdx === -1 && records.length > 0) {
         results.push({ rankLabel: '...', alias: 'DID NOT QUALIFY', displayValue: '', isMe: true, isNewPb: false });
    }

    while (results.length < topN) {
        const idx = results.length;
        results.push({
            rankLabel: `#${idx + 1}`,
            alias: '---',
            displayValue: '--------',
            isMe: false,
            isNewPb: false
        });
    }

    return results;
}
