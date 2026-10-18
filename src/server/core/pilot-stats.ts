// src/server/core/pilot-stats.ts
import fs from 'fs';
import path from 'path';

export interface CavernPilotStats {
    attemptsStarted: number;
    failedAttempts: number;
    completions: number;
    deaths: number;
    lastPlayedAt: number;
}

export interface ActiveStreakState {
    levelIndex: number;
    startLevel: number;
    lives: number;
    score: number;
    streakReplays: string[];
    updatedAt: number;
}

export interface PilotProfileStats {
    uuid: string;
    alias: string;
    pendingLevel?: number;
    pendingStartedAt?: number;
    activeStreak?: ActiveStreakState;
    caverns: Record<number, CavernPilotStats>;
}

export class PilotStatsManager {
    private dbPath: string;
    private deathsPath: string;
    private profiles: Record<string, PilotProfileStats> = {};
    private deathLocations: Record<number, { x: number; y: number }[]> = {};

    constructor(filename: string = 'data/pilot_stats.json') {
        this.dbPath = path.resolve(process.cwd(), filename);
        this.deathsPath = path.resolve(process.cwd(), 'data/death_locations.json');
        this.load();
    }

    private getOrCreateProfile(uuid: string, alias: string): PilotProfileStats {
        let prof = this.profiles[uuid];
        if (!prof) {
            prof = { uuid, alias, caverns: {} };
            this.profiles[uuid] = prof;
        } else if (alias && alias !== 'UNK') {
            prof.alias = alias;
        }
        return prof;
    }

    private getOrCreateCavern(prof: PilotProfileStats, levelIndex: number): CavernPilotStats {
        let cav = prof.caverns[levelIndex];
        if (!cav) {
            cav = {
                attemptsStarted: 0,
                failedAttempts: 0,
                completions: 0,
                deaths: 0,
                lastPlayedAt: Date.now()
            };
            prof.caverns[levelIndex] = cav;
        }
        return cav;
    }

    /**
     * Resolves any dangling unfinished attempt as a failed attempt,
     * then registers a new active/pending attempt for `levelIndex`.
     */
    public beginAttempt(uuid: string, alias: string, levelIndex: number) {
        if (!uuid) return;
        const prof = this.getOrCreateProfile(uuid, alias);

        if (prof.pendingLevel !== undefined) {
            const prevCav = this.getOrCreateCavern(prof, prof.pendingLevel);
            prevCav.failedAttempts++;
            prof.pendingLevel = undefined;
            prof.pendingStartedAt = undefined;
        }

        const curCav = this.getOrCreateCavern(prof, levelIndex);
        curCav.attemptsStarted++;
        curCav.lastPlayedAt = Date.now();
        prof.pendingLevel = levelIndex;
        prof.pendingStartedAt = Date.now();
        this.save();
    }

    /**
     * Marks the current pending attempt on `levelIndex` as completed so it is not counted as failed.
     */
    public completeAttempt(uuid: string, alias: string, levelIndex: number) {
        if (!uuid) return;
        const prof = this.getOrCreateProfile(uuid, alias);
        const curCav = this.getOrCreateCavern(prof, levelIndex);
        curCav.completions++;
        curCav.lastPlayedAt = Date.now();

        if (prof.pendingLevel === levelIndex) {
            prof.pendingLevel = undefined;
            prof.pendingStartedAt = undefined;
        }
        this.save();
    }

    /**
     * Explicitly flushes any pending unfinished attempt into `failedAttempts` (e.g. on Game Over).
     */
    public flushPendingAsFailed(uuid: string, alias: string) {
        if (!uuid) return;
        const prof = this.getOrCreateProfile(uuid, alias);
        if (prof.pendingLevel !== undefined) {
            const prevCav = this.getOrCreateCavern(prof, prof.pendingLevel);
            prevCav.failedAttempts++;
            prof.pendingLevel = undefined;
            prof.pendingStartedAt = undefined;
            this.save();
        }
    }

    public recordDeath(uuid: string, alias: string, levelIndex: number, x?: number, y?: number) {
        if (typeof x === 'number' && typeof y === 'number' && (x !== 0 || y !== 0)) {
            if (!this.deathLocations[levelIndex]) {
                this.deathLocations[levelIndex] = [];
            }
            this.deathLocations[levelIndex].push({
                x: Math.round(x),
                y: Math.round(y)
            });
            this.saveDeathLocations();
        }
        if (!uuid) return;
        const prof = this.getOrCreateProfile(uuid, alias);
        const curCav = this.getOrCreateCavern(prof, levelIndex);
        curCav.deaths++;
        curCav.lastPlayedAt = Date.now();
        this.save();
    }

    public saveActiveStreak(uuid: string, alias: string, streak: ActiveStreakState | undefined) {
        if (!uuid) return;
        const prof = this.getOrCreateProfile(uuid, alias);
        prof.activeStreak = streak;
        this.save();
    }

    public getActiveStreak(uuid: string): ActiveStreakState | undefined {
        if (!uuid) return undefined;
        return this.profiles[uuid]?.activeStreak;
    }

    public getCavernStats(uuid: string, levelIndex: number): CavernPilotStats {
        const prof = this.profiles[uuid];
        return prof?.caverns?.[levelIndex] || {
            attemptsStarted: 0,
            failedAttempts: 0,
            completions: 0,
            deaths: 0,
            lastPlayedAt: 0
        };
    }

    private load() {
        if (fs.existsSync(this.dbPath)) {
            try {
                this.profiles = JSON.parse(fs.readFileSync(this.dbPath, 'utf8'));
            } catch (e) {
                console.error('Failed to parse pilot_stats.json, starting fresh.', e);
            }
        }
        if (fs.existsSync(this.deathsPath)) {
            try {
                this.deathLocations = JSON.parse(fs.readFileSync(this.deathsPath, 'utf8'));
            } catch (e) {
                console.error('Failed to parse death_locations.json, starting fresh.', e);
            }
        }
    }

    private save() {
        const dir = path.dirname(this.dbPath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        fs.writeFileSync(this.dbPath, JSON.stringify(this.profiles, null, 2));
    }

    private saveDeathLocations() {
        const dir = path.dirname(this.deathsPath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        fs.writeFileSync(this.deathsPath, JSON.stringify(this.deathLocations));
    }
}

export const pilotStatsDB = new PilotStatsManager();
