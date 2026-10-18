import os from 'os';

export interface ServerTelemetrySnapshot {
    activeRoomsNow: number;
    roomsCreated10s: number;
    roomsCreated5m: number;
    roomsCreated60m: number;
    activePlayers10s: number;
    activePlayers5m: number;
    activePlayers60m: number;
    pings: number[];
}

export class ServerProfiler {
    private tickTimes: number[] = [];
    private tickStart: number = 0;
    private reportIntervalMs: number;
    private telemetryProvider?: () => ServerTelemetrySnapshot;

    constructor(reportIntervalMs: number = 10000, telemetryProvider?: () => ServerTelemetrySnapshot) {
        this.reportIntervalMs = reportIntervalMs;
        this.telemetryProvider = telemetryProvider;
        setInterval(() => this.report(), this.reportIntervalMs);
    }

    public begin() {
        this.tickStart = performance.now();
    }

    public end() {
        this.tickTimes.push(performance.now() - this.tickStart);
    }

    private report() {
        if (this.tickTimes.length === 0) return;

        // splice(0) safely clears the array while returning the elements to process
        const times = this.tickTimes.splice(0, this.tickTimes.length).sort((a, b) => a - b);
        
        const min = times[0];
        const max = times[times.length - 1];
        const avg = times.reduce((a, b) => a + b, 0) / times.length;
        
        const mid = Math.floor(times.length / 2);
        const median = times.length % 2 === 0 
            ? (times[mid - 1] + times[mid]) / 2 
            : times[mid];

        const budgetPct = (avg / 16.66) * 100;
        const intervalSec = this.reportIntervalMs / 1000;
        const nowIso = new Date().toISOString();

        console.log(`[PERF ${nowIso}] ${intervalSec}s Tick (ms) - Min: ${min.toFixed(2)} | Med: ${median.toFixed(2)} | Avg: ${avg.toFixed(2)} | Max: ${max.toFixed(2)} | Budget used: ${budgetPct.toFixed(1)}%`);
        this.logSystemStats();
    }

    private logSystemStats() {
        const mem = process.memoryUsage();
        const freeMem = os.freemem() / (1024 * 1024);
        const totalMem = os.totalmem() / (1024 * 1024);
        const heapUsed = mem.heapUsed / (1024 * 1024);
        const load = os.loadavg();

        console.log(`       Heap: ${heapUsed.toFixed(1)}MB | OS Free: ${freeMem.toFixed(1)}MB / ${totalMem.toFixed(1)}MB | Load (1/5/15m): ${load[0].toFixed(2)}, ${load[1].toFixed(2)}, ${load[2].toFixed(2)}`);
        if (this.telemetryProvider) {
            const snap = this.telemetryProvider();
            let pingStr = 'n/a';
            if (snap.pings.length > 0) {
                const sorted = [...snap.pings].sort((a, b) => a - b);
                const pMin = sorted[0];
                const pMax = sorted[sorted.length - 1];
                const pAvg = Math.round(sorted.reduce((a, b) => a + b, 0) / sorted.length);
                const pMed = sorted[Math.floor(sorted.length * 0.5)];
                const p95 = sorted[Math.floor(sorted.length * 0.95)];
                pingStr = `n=${sorted.length} Min:${pMin} Med:${pMed} Avg:${pAvg} P95:${p95} Max:${pMax}ms`;
            }
            console.log(`       Rooms [Active Now: ${snap.activeRoomsNow} | Created 10s/5m/1h: ${snap.roomsCreated10s}/${snap.roomsCreated5m}/${snap.roomsCreated60m}] | Active Pilots (10s/5m/1h): ${snap.activePlayers10s}/${snap.activePlayers5m}/${snap.activePlayers60m} | Ping: ${pingStr}`);
        }
    }
}
