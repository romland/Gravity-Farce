import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

export type TrackEventType = 
    | { type: 'death'; x: number; y: number }
    | { type: 'cargo_delivered'; typeId: number }
    | { type: 'powerup_taken'; typeId: number; x: number; y: number }
    | { type: 'fuel_taken'; amount: number; x: number; y: number }
    | { type: 'game_start'; levelIndex: number; category: string }
    | { type: 'enemy_killed'; enemyCategory: 'turret' | 'tank' | 'flying'; enemyTypeId: number; contributors: Record<string, number> }
    | { type: 'game_end'; reason: 'completed' | 'abandoned' };

export interface LogEntry {
    gameUuid: string;
    levelIndex: number;
    category: string;
    mode: 'SP' | 'MP';
    physicsHash: string;
    isDebug: boolean;
    startedAt: number;
    endedAt: number;
    durationMs: number;
    highscores: { playerId: string; uuid: string; alias: string; metric: string; value: number; isNewPb: boolean }[];
    events: { timestamp: number; playerId?: string; event: TrackEventType }[];
    playerStats: Record<string, {
        uuid: string;
        alias: string;
        deaths: number;
        powerupsTaken: number;
        fuelTaken: number;
        cargoDelivered: number;
        fuelConsumed: number;
        shotsFired: number;
    }>;
}

export class GameTracker {
    public uuid: string;
    private entry: LogEntry;
    private isActive: boolean = true;
    public isCompleted: boolean = false;
    
    constructor(levelIndex: number, category: string, mode: 'SP' | 'MP', physicsHash: string, isDebug: boolean) {
        this.uuid = crypto.randomUUID();
        this.entry = {
            gameUuid: this.uuid,
            levelIndex,
            category,
            mode,
            physicsHash,
            isDebug,
            startedAt: Date.now(),
            endedAt: 0,
            durationMs: 0,
            highscores: [],
            events: [],
            playerStats: {}
        };
        this.logEvent(undefined, { type: 'game_start', levelIndex, category });
    }

    public initPlayer(playerId: string, uuid: string, alias: string) {
        if (!this.entry.playerStats[playerId]) {
            this.entry.playerStats[playerId] = { uuid, alias, deaths: 0, powerupsTaken: 0, fuelTaken: 0, cargoDelivered: 0, fuelConsumed: 0, shotsFired: 0 };
        }
    }

    public logEvent(playerId: string | undefined, event: TrackEventType) {
        if (!this.isActive) return;
        this.entry.events.push({ timestamp: Date.now(), playerId, event });
        
        if (playerId && this.entry.playerStats[playerId]) {
            const stats = this.entry.playerStats[playerId];
            if (event.type === 'death') stats.deaths++;
            if (event.type === 'powerup_taken') stats.powerupsTaken++;
            if (event.type === 'fuel_taken') stats.fuelTaken++;
            if (event.type === 'cargo_delivered') stats.cargoDelivered++;
        }
    }

    public logHighscore(playerId: string, metric: string, value: number, isNewPb: boolean) {
        if (!this.isActive || !this.entry.playerStats[playerId]) return;
        const { uuid, alias } = this.entry.playerStats[playerId];
        this.entry.highscores.push({ playerId, uuid, alias, metric, value, isNewPb });
    }

    public updatePlayerFuelConsumed(playerId: string, consumed: number) {
        if (this.entry.playerStats[playerId]) {
            this.entry.playerStats[playerId].fuelConsumed = Math.max(this.entry.playerStats[playerId].fuelConsumed, consumed);
        }
    }

    public updatePlayerShots(playerId: string, shotsFired: number) {
        if (this.entry.playerStats[playerId]) {
            this.entry.playerStats[playerId].shotsFired = Math.max(this.entry.playerStats[playerId].shotsFired, shotsFired);
        }
    }

    public finishAndSave() {
        if (!this.isActive) return;
        this.isActive = false;
        
        if (!this.isCompleted) return; // Discard failed attempts

        this.entry.endedAt = Date.now();
        this.entry.durationMs = this.entry.endedAt - this.entry.startedAt;
        this.entry.events.push({ timestamp: this.entry.endedAt, event: { type: 'game_end', reason: 'completed' } });
        
        const logPath = path.resolve(process.cwd(), 'data/game_log.jsonl');
        const dir = path.dirname(logPath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        
        fs.appendFileSync(logPath, JSON.stringify(this.entry) + '\n');
    }
}