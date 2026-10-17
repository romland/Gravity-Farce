import fs from 'fs';
import path from 'path';
import { SERVER_CONFIG } from './config';

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
    private pvpPairHistory: Record<string, number[]> = {};

    constructor(filename: string = 'data/server_records.json') {
        this.dbPath = path.resolve(process.cwd(), filename);
        this.load();
    }

    /**
     * Generates a deterministic hash representing the current physical constraints.
     * Highscores MUST be connected to the settings they were achieved under.
     */
    public generatePhysicsHash(settings: {
        gravity: number;
        thrust: number;
        maxSpeed: number;
        shipScale?: number;
        lethalRacingEnemies?: boolean;
        raceBumpModifier?: number;
        botCount?: number;
    }): string {
        // Simple lightweight string hash for physics vars
        const scalePart = settings.shipScale && settings.shipScale !== 1.0 ? `_scale_${settings.shipScale}` : '';
        const payload = `${settings.gravity}_${settings.thrust}_${settings.maxSpeed}${scalePart}${settings.botCount ? `_bots_${settings.botCount}` : ''}`;
        let hash = 0;
        for (let i = 0; i < payload.length; i++) {
            hash = Math.imul(31, hash) + payload.charCodeAt(i) | 0;
        }
        return hash.toString(16);
    }

    /**
     * Builds the composite key for strict categorical isolation.
     */
    private getCompositeKey(metric: string, level: number, mode: 'SP' | 'MP', physicsHash: string, isBotPilot: boolean = false): string {
        return `${metric}:lvl_${level}:${mode}:phys_${physicsHash}${isBotPilot ? ':bot' : ''}`;
    }

    /**
     * Submits a new record. If it qualifies for the top N of its category, it is saved.
     * NOTE ON maxEntriesPerPlayer (TODO 5):
     * For individual level speedruns/laps, we allow up to 3 entries per pilot so they can see
     * their consistency. However, for 5-Lives Streaks and 50-Cavern Campaign runs, we enforce
     * maxEntriesPerPlayer = 1 so a single long 9-level streak does not flood the leaderboard
     * with 3 separate entries from the same pilot/run.
     */
    public submitRecord(
        metric: string, 
        level: number, 
        mode: 'SP' | 'MP', 
        physicsHash: string, 
        sort: SortOrder,
        entry: Omit<RecordEntry, 'timestamp'>,
        limit: number = 100,
        isBotPilot: boolean = false,
        maxEntriesPerPlayer: number = 3
    ): SubmitResult {
        const key = this.getCompositeKey(metric, level, mode, physicsHash, isBotPilot);
        
        if (!this.db[key]) {
            this.db[key] = { sort, entries: [] };
        }

        const board = this.db[key];
        // Overwrite cached sort order so metric definition changes auto-heal
        board.sort = sort;
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

        if (playerEntries.length < maxEntriesPerPlayer) {
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
            const bestPlayerEntry = playerEntries[0];
            const worstPlayerEntry = playerEntries[playerEntries.length - 1];
            if (maxEntriesPerPlayer === 1) {
                // Keep strictly ONE entry per player on Campaign & Streak leaderboards
                if (isBetterThan(entry, bestPlayerEntry)) {
                    board.entries = board.entries.filter(e => e.playerId !== entry.playerId);
                    board.entries.push(newEntry);
                }
            } else if (isBetterThan(entry, worstPlayerEntry)) {
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

    public getRecords(metric: string, level: number, mode: 'SP' | 'MP', physicsHash: string, isBotPilot: boolean = false): RecordEntry[] {
        if (metric === 'sp_dogfight') {
            const merged: RecordEntry[] = [];
            const seen = new Set<string>();
            for (let b = 0; b <= 32; b++) {
                const bHash = getActivePhysicsHash(b);
                const bKey = this.getCompositeKey(metric, level, mode, bHash, isBotPilot);
                const list = this.db[bKey]?.entries;
                if (list) {
                    for (const entry of list) {
                        const uid = `${entry.playerId}_${entry.timestamp}_${entry.value}`;
                        if (!seen.has(uid)) {
                            seen.add(uid);
                            merged.push(entry);
                        }
                    }
                }
            }
            merged.sort((a, b) => {
                if (a.value !== b.value) return b.value - a.value;
                const secA = a.secondaryValue ?? 0;
                const secB = b.secondaryValue ?? 0;
                if (secA !== secB) return secA - secB;
                return a.timestamp - b.timestamp;
            });
            return merged;
        }
        const key = this.getCompositeKey(metric, level, mode, physicsHash, isBotPilot);
        return this.db[key]?.entries || [];
    }

    public getPlayerBestLapRecord(level: number, mode: 'SP' | 'MP', physicsHash: string, playerId: string, isBotPilot: boolean = false): RecordEntry | undefined {
        const entries = this.getRecords('fastest_lap', level, mode, physicsHash, isBotPilot).filter(e => e.playerId === playerId);
        if (entries.length === 0) return undefined;
        return entries.reduce((best, cur) => (cur.value < best.value ? cur : best), entries[0]);
    }

    public updatePlayerBestLapSplits(level: number, mode: 'SP' | 'MP', physicsHash: string, playerId: string, timestamp: number, splits: Record<number, number>, isBotPilot: boolean = false) {
        const entries = this.getRecords('fastest_lap', level, mode, physicsHash, isBotPilot);
        const rec = entries.find(e => e.playerId === playerId && e.timestamp === timestamp);
        if (rec) {
            rec.metadata = { ...(rec.metadata || {}), splits };
            this.save();
        }
    }

    /**
     * Aggregates a pilot's personal bests across all 50 mission caverns (0-49)
     * and updates the three Campaign Mastery leaderboards (Score, Blitz Time, Eco Fuel).
     */
    public recalculateCampaignMastery(
        mode: 'SP' | 'MP',
        physicsHash: string,
        playerId: string,
        alias: string,
        isBotPilot: boolean = false,
        botCount: number = 0
    ) {
        let cavernsScored = 0;
        let totalBestScore = 0;
        let totalTimeForScore = 0;

        let cavernsTimed = 0;
        let totalFastestTime = 0;

        let cavernsEco = 0;
        let totalLeastFuel = 0;

        for (let lvl = 0; lvl <= 49; lvl++) {
            // 1. Best Score per cavern (Primary: Score DESC, Secondary: Time ASC)
            const scoreEntries = this.getRecords('sp_level_best', lvl, mode, physicsHash, isBotPilot).filter(e => e.playerId === playerId);
            if (scoreEntries.length > 0) {
                const bestS = scoreEntries.reduce((best, cur) => {
                    if (cur.value !== best.value) return cur.value > best.value ? cur : best;
                    return (cur.secondaryValue ?? Infinity) < (best.secondaryValue ?? Infinity) ? cur : best;
                }, scoreEntries[0]);
                cavernsScored++;
                totalBestScore += bestS.value;
                totalTimeForScore += (bestS.secondaryValue ?? 0);
            }

            // 2. Fastest Completion Time per cavern
            const fastEntries = this.getRecords('sp_fastest', lvl, mode, physicsHash, isBotPilot).filter(e => e.playerId === playerId);
            if (fastEntries.length > 0) {
                const bestF = fastEntries.reduce((best, cur) => (cur.value < best.value ? cur : best), fastEntries[0]);
                cavernsTimed++;
                totalFastestTime += bestF.value;
            }

            // 3. Least Fuel Consumed per cavern
            const ecoEntries = this.getRecords('sp_eco', lvl, mode, physicsHash, isBotPilot).filter(e => e.playerId === playerId);
            if (ecoEntries.length > 0) {
                const bestE = ecoEntries.reduce((best, cur) => (cur.value < best.value ? cur : best), ecoEntries[0]);
                cavernsEco++;
                totalLeastFuel += bestE.value;
            }
        }

        const rCampScore = cavernsScored > 0
            ? this.submitRecord('campaign_score', 0, mode, physicsHash, 'desc_asc', {
                playerId, alias, value: totalBestScore, secondaryValue: totalTimeForScore,
                metadata: { cavernsCleared: cavernsScored, botCount }
            }, 100, isBotPilot, 1)
            : { isNewPb: false, rank: -1, timestamp: undefined };

        const rCampTime = cavernsTimed > 0
            ? this.submitRecord('campaign_time', 0, mode, physicsHash, 'desc_asc', {
                playerId, alias, value: cavernsTimed, secondaryValue: totalFastestTime,
                metadata: { cavernsCleared: cavernsTimed, botCount }
            }, 100, isBotPilot, 1)
            : { isNewPb: false, rank: -1, timestamp: undefined };

        const rCampFuel = cavernsEco > 0
            ? this.submitRecord('campaign_fuel', 0, mode, physicsHash, 'desc_asc', {
                playerId, alias, value: cavernsEco, secondaryValue: totalLeastFuel,
                metadata: { cavernsCleared: cavernsEco, botCount }
            }, 100, isBotPilot, 1)
            : { isNewPb: false, rank: -1, timestamp: undefined };

        return {
            score: { ...rCampScore, totalScore: totalBestScore, totalTime: totalTimeForScore, caverns: cavernsScored },
            time: { ...rCampTime, caverns: cavernsTimed, totalTime: totalFastestTime },
            fuel: { ...rCampFuel, caverns: cavernsEco, totalFuel: totalLeastFuel }
        };
    }

    /**
     * Computes a pilot's display Combat Rating with gentle time-decay after 14 days of inactivity
     * toward the 1000 CR baseline so the Top Gun board stays fresh over months/years.
     */
    public getDecayedCombatRating(rawRating: number, lastActiveTimestamp: number): number {
        const daysInactive = (Date.now() - (lastActiveTimestamp || Date.now())) / (1000 * 60 * 60 * 24);
        if (daysInactive <= 14) return Math.round(rawRating);
        const decayDays = Math.min(90, daysInactive - 14);
        const decayed = 1000 + (rawRating - 1000) * Math.pow(0.992, decayDays);
        return Math.round(decayed);
    }

    /**
     * Updates anti-rigging PvP Dogfight Combat Rating (Elo-lite with 24h pairwise diminishing returns
     * and minimum engagement floor).
     */
    public processDogfightPvpOutcome(
        winnerId: string,
        winnerAlias: string,
        loserId: string,
        loserAlias: string,
        engaged: boolean,
        physicsHash: string,
        replayId: string,
        winnerIsBotPilot: boolean = false,
        loserIsBotPilot: boolean = false
    ): { winnerRating: number; loserRating: number; winnerDelta: number; loserDelta: number; note?: string } {
        const keyW = this.getCompositeKey('dogfight_rating', 0, 'MP', physicsHash, winnerIsBotPilot);
        const keyL = this.getCompositeKey('dogfight_rating', 0, 'MP', physicsHash, loserIsBotPilot);
        if (!this.db[keyW]) this.db[keyW] = { sort: 'desc', entries: [] };
        if (!this.db[keyL]) this.db[keyL] = { sort: 'desc', entries: [] };

        const findOrInit = (board: Leaderboard, pid: string, alias: string): RecordEntry => {
            let rec = board.entries.find(e => e.playerId === pid);
            if (!rec) {
                rec = { playerId: pid, alias, value: 1000, timestamp: Date.now(), metadata: { wins: 0, losses: 0, replayId } };
                board.entries.push(rec);
            }
            return rec;
        };

        const recW = findOrInit(this.db[keyW], winnerId, winnerAlias);
        const recL = findOrInit(this.db[keyL], loserId, loserAlias);
        const curW = this.getDecayedCombatRating(recW.value, recW.timestamp);
        const curL = this.getDecayedCombatRating(recL.value, recL.timestamp);

        if (!engaged || winnerId === loserId) {
            return {
                winnerRating: curW,
                loserRating: curL,
                winnerDelta: 0,
                loserDelta: 0,
                note: 'UNRATED: OPPONENT DID NOT MEET COMBAT ENGAGEMENT FLOOR'
            };
        }

        const now = Date.now();
        const windowMs = 24 * 60 * 60 * 1000;
        const pairKey = `${winnerId}_vs_${loserId}`;
        const recent = (this.pvpPairHistory[pairKey] || []).filter(ts => now - ts < windowMs);
        const scales = [1.0, 0.5, 0.25, 0.1, 0.0];
        const mult = scales[Math.min(recent.length, scales.length - 1)];
        recent.push(now);
        this.pvpPairHistory[pairKey] = recent;

        const expectedW = 1 / (1 + Math.pow(10, (curL - curW) / 400));
        const rawDelta = Math.max(2, Math.round(32 * (1 - expectedW) * mult));
        const delta = mult === 0 ? 0 : rawDelta;

        recW.alias = winnerAlias;
        recW.value = curW + delta;
        recW.timestamp = now;
        recW.metadata = { ...(recW.metadata || {}), wins: (recW.metadata?.wins || 0) + 1, replayId };

        recL.alias = loserAlias;
        recL.value = Math.max(800, curL - delta);
        recL.timestamp = now;
        recL.metadata = { ...(recL.metadata || {}), losses: (recL.metadata?.losses || 0) + 1, replayId };

        this.db[keyW].entries.sort((a, b) => b.value - a.value);
        this.db[keyL].entries.sort((a, b) => b.value - a.value);
        this.save();

        return {
            winnerRating: recW.value,
            loserRating: recL.value,
            winnerDelta: delta,
            loserDelta: -delta,
            note: mult === 0 ? 'DIMINISHING RETURNS: 24H CAP REACHED AGAINST THIS OPPONENT' : undefined
        };
    }

    private load() {
        if (fs.existsSync(this.dbPath)) {
            this.db = JSON.parse(fs.readFileSync(this.dbPath, 'utf8'));
        }
    }

    private save() {
        const dir = path.dirname(this.dbPath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        fs.writeFileSync(this.dbPath, JSON.stringify(this.db, null, 2));
    }
}

export const recordDB = new RecordManager();

export function getActivePhysicsHash(botCount: number = 0): string {
/*

TODO add:
    SERVER_CONFIG.lethalRacingEnemies: false, // Configurable toggle for race course hazards
    SERVER_CONFIG.raceBumpModifier: 0.6, // Modifier for the bump force

*/
    const shipScale = SERVER_CONFIG.shipScale || 1.0;
    return SERVER_CONFIG.useClassicPhysics 
        ? recordDB.generatePhysicsHash({
            gravity: 0.010,
            thrust: 0.070,
            maxSpeed: 7.5,
            shipScale,
            lethalRacingEnemies: SERVER_CONFIG.lethalRacingEnemies,
            raceBumpModifier: SERVER_CONFIG.raceBumpModifier,
            botCount
        }) // Classic constants
        : recordDB.generatePhysicsHash({
            gravity: 0.010,
            thrust: 0.070,
            maxSpeed: 7.5,
            shipScale,
            lethalRacingEnemies: SERVER_CONFIG.lethalRacingEnemies,
            raceBumpModifier: SERVER_CONFIG.raceBumpModifier,
            botCount
        }); // Modern constants (preserved previous classic baseline)
}

export function formatTimeMs(diff: number): string {
    let m = Math.floor(diff / 60000).toString().padStart(2, '0');
    let s = Math.floor((diff % 60000) / 1000).toString().padStart(2, '0');
    let ms = Math.floor(diff % 1000).toString().padStart(3, '0');
    return `${m}:${s}.${ms}`;
}

export function getRelativeTimeStr(timestamp: number): string {
    if (!timestamp) return "";
    const seconds = Math.floor((Date.now() - timestamp) / 1000);
    if (seconds < 60) return "now";
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes} minute${minutes !== 1 ? 's' : ''} ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours} hour${hours !== 1 ? 's' : ''} ago`;
    const days = Math.floor(hours / 24);
    if (days < 30) return `${days} day${days !== 1 ? 's' : ''} ago`;
    const months = Math.floor(days / 30);
    if (months < 12) return `${months} month${months !== 1 ? 's' : ''} ago`;
    const years = Math.floor(days / 365);
    return `${years} year${years !== 1 ? 's' : ''} ago`;
}

/**
 * Builds a contextual array for the client UI showing the Top N, plus the player's immediate neighbors.
 */
export function buildLeaderboardContext(
    metric: string, level: number, mode: 'SP' | 'MP', physicsHash: string,
    playerId: string, isNewPb: boolean, 
    arg7: number | undefined | ((e: RecordEntry) => string), 
    arg8?: ((e: RecordEntry) => string) | number,
    arg9: number = 10,
    currentRun?: { value: number, secondaryValue?: number, alias: string },
    isBotPilot: boolean = false
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

    const records = recordDB.getRecords(metric, level, mode, physicsHash, isBotPilot);
    let recordsCopy = [...records];

    let pIdx = newEntryTimestamp !== undefined
        ? recordsCopy.findIndex(e => e.playerId === playerId && e.timestamp === newEntryTimestamp)
        : recordsCopy.findIndex(e => e.playerId === playerId);
        
    // If the run didn't qualify for the DB (e.g., worse than 3rd PB), inject it temporarily 
    // into the rendering array so the player can implicitly see where they would have ranked
    if (pIdx === -1 && currentRun && newEntryTimestamp !== undefined) {
        const tempEntry: RecordEntry = {
            playerId, alias: currentRun.alias, value: currentRun.value, secondaryValue: currentRun.secondaryValue, timestamp: newEntryTimestamp
        };
        recordsCopy.push(tempEntry);
        
        const key = recordDB['getCompositeKey'](metric, level, mode, physicsHash, isBotPilot);
        const sort = recordDB['db'][key]?.sort || 'asc';
        
        recordsCopy.sort((a, b) => {
            if (a.value !== b.value) {
                return sort.startsWith('asc') ? a.value - b.value : b.value - a.value;
            }
            const secA = a.secondaryValue ?? 0;
            const secB = b.secondaryValue ?? 0;
            if (sort.endsWith('_asc')) return secA - secB;
            if (sort.endsWith('_desc')) return secB - secA;
            return a.timestamp - b.timestamp;
        });
        pIdx = recordsCopy.findIndex(e => e.playerId === playerId && e.timestamp === newEntryTimestamp);
    }

    const results = [];
    
    for (let i = 0; i < Math.min(topN, recordsCopy.length); i++) {
        const rec = recordsCopy[i];
        const isMe = rec.playerId === playerId;
        const isThisNewPb = isMe && isNewPb && rec.timestamp === newEntryTimestamp;
        const isCurrentRun = isMe && rec.timestamp === newEntryTimestamp;
        const ageStr = (i === 0 && rec.timestamp) ? getRelativeTimeStr(rec.timestamp) : undefined;
        
        results.push({
            rank: i + 1, rankLabel: `#${i+1}`, alias: rec.alias, ageStr, displayValue: formatFn(rec),
            isMe, isNewPb: isThisNewPb, isCurrentRun, replayId: rec.metadata?.replayId
        });
    }
    
    if (pIdx >= topN) {
        if (pIdx > topN) {
            results.push({ rank: -1, rankLabel: '...', alias: '...', displayValue: '', isMe: false, isNewPb: false, isCurrentRun: false, replayId: undefined });
        }
        if (pIdx - 1 >= topN) {
            const rec = recordsCopy[pIdx-1];
            results.push({ rank: pIdx, rankLabel: `#${pIdx}`, alias: rec.alias, displayValue: formatFn(rec), isMe: rec.playerId === playerId, isNewPb: false, isCurrentRun: false, replayId: rec.metadata?.replayId });
        }
        const recMe = recordsCopy[pIdx];
        results.push({ rank: pIdx + 1, rankLabel: `#${pIdx+1}`, alias: recMe.alias, displayValue: formatFn(recMe), isMe: true, isNewPb: isNewPb && (newEntryTimestamp === undefined || recMe.timestamp === newEntryTimestamp), isCurrentRun: true, replayId: recMe.metadata?.replayId });
        if (pIdx + 1 < recordsCopy.length) {
            const recNext = recordsCopy[pIdx+1];
            results.push({ rank: pIdx + 2, rankLabel: `#${pIdx+2}`, alias: recNext.alias, displayValue: formatFn(recNext), isMe: recNext.playerId === playerId, isNewPb: false, isCurrentRun: false, replayId: recNext.metadata?.replayId });
        }
    }

    while (results.length < topN) {
        const idx = results.length;
        results.push({
            rank: idx + 1,
            rankLabel: `#${idx + 1}`,
            alias: '---',
            displayValue: '--------',
            isMe: false, isNewPb: false, isCurrentRun: false, replayId: undefined
        });
    }

    return results;
}
