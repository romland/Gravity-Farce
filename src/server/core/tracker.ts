import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { Worker } from 'worker_threads';

export type TrackEventType = 
    | { type: 'death'; x: number; y: number }
    | { type: 'cargo_delivered'; typeId: number }
    | { type: 'powerup_taken'; typeId: number; x: number; y: number }
    | { type: 'fuel_taken'; amount: number; x: number; y: number }
    | { type: 'game_start'; levelIndex: number; category: string }
    | { type: 'enemy_killed'; enemyCategory: 'turret' | 'tank' | 'flying'; enemyTypeId: number; contributors: Record<string, number> }
    | { type: 'game_end'; reason: 'completed' | 'abandoned' }
    | { type: 'lap_completed'; lapNum: number; lapTime: number }
    | { type: 'race_completed'; totalTime: number; lapTimes: number[] };

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
        raceStats?: { totalTime: number; lapTimes: number[] };
        pingSummary?: { min: number; max: number; avg: number; med: number };
        _pingSamples?: number[]; // Internal tracking, removed before save
    }>;
    replayData?: any;
}

const REPLAY_WORKER_CODE = `
const { parentPort } = require('worker_threads');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

parentPort.on('message', (msg) => {
    try {
        const { entry, useGzip } = msg;
        const dir = path.resolve(process.cwd(), 'data/replays');
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        const ext = useGzip ? '.gfr' : '.json';
        const filepath = path.join(dir, entry.gameUuid + ext);
        
        let outData;
        if (useGzip) {
            outData = zlib.gzipSync(JSON.stringify(entry));
        } else {
            outData = JSON.stringify(entry, null, 2);
        }
        fs.writeFileSync(filepath, outData);
        parentPort.postMessage({ success: true, uuid: entry.gameUuid });
    } catch (e) {
        parentPort.postMessage({ success: false, error: e.message });
    }
});
`;

const replayWorker = new Worker(REPLAY_WORKER_CODE, { eval: true });

export class GameTracker {
    public uuid: string;
    private entry: LogEntry;
    private isActive: boolean = true;
    public isCompleted: boolean = false;
    public hasHighscore: boolean = false;
    
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
            playerStats: {},
            replayData: { seed: Date.now(), initialCargoCount: 0, frames: [] }
        };
        this.logEvent(undefined, { type: 'game_start', levelIndex, category });
    }

    public initPlayer(playerId: string, uuid: string, alias: string) {
        if (!this.entry.playerStats[playerId]) {
            this.entry.playerStats[playerId] = { uuid, alias, deaths: 0, powerupsTaken: 0, fuelTaken: 0, cargoDelivered: 0, fuelConsumed: 0, shotsFired: 0, _pingSamples: [] };
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
            if (event.type === 'race_completed') {
                stats.raceStats = { totalTime: event.totalTime, lapTimes: [...event.lapTimes] };
            }
        }
    }

    public logHighscore(playerId: string, metric: string, value: number, isNewPb: boolean) {
        if (!this.isActive || !this.entry.playerStats[playerId]) return;
        const { uuid, alias } = this.entry.playerStats[playerId];
        this.entry.highscores.push({ playerId, uuid, alias, metric, value, isNewPb });
        if (isNewPb) this.hasHighscore = true;
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

    public logPing(playerId: string, ping: number) {
        if (this.isActive && this.entry.playerStats[playerId]?._pingSamples) {
            this.entry.playerStats[playerId]._pingSamples!.push(ping);
        }
    }

    public logReplayFrame(frameData: any) {
        if (this.isActive) this.entry.replayData.frames.push(frameData);
    }

    public finishAndSave() {
        if (!this.isActive) return;
        this.isActive = false;
        
        if (!this.isCompleted) return; // Discard failed attempts

        this.entry.endedAt = Date.now();
        this.entry.durationMs = this.entry.endedAt - this.entry.startedAt;
        this.entry.events.push({ timestamp: this.entry.endedAt, event: { type: 'game_end', reason: 'completed' } });
        
        // Calculate ping summaries and strip raw array before saving
        for (const stats of Object.values(this.entry.playerStats)) {
            if (stats._pingSamples && stats._pingSamples.length > 0) {
                const samples = stats._pingSamples.sort((a, b) => a - b);
                const min = samples[0];
                const max = samples[samples.length - 1];
                const avg = Math.round(samples.reduce((a, b) => a + b, 0) / samples.length);
                const mid = Math.floor(samples.length / 2);
                const med = samples.length % 2 === 0 ? Math.round((samples[mid - 1] + samples[mid]) / 2) : samples[mid];
                
                stats.pingSummary = { min, max, avg, med };
            }
            delete stats._pingSamples;
        }
        
        const logPath = path.resolve(process.cwd(), 'data/game_log.jsonl');
        const dir = path.dirname(logPath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        
        fs.appendFileSync(logPath, JSON.stringify(this.entry) + '\n');

        if (this.hasHighscore) {
            replayWorker.postMessage({ entry: this.entry, useGzip: !this.entry.isDebug });
        }
    }
}
