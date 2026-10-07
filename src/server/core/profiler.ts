export class ServerProfiler {
    private tickTimes: number[] = [];
    private tickStart: number = 0;
    private reportIntervalMs: number;

    constructor(reportIntervalMs: number = 10000) {
        this.reportIntervalMs = reportIntervalMs;
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

        console.log(`[PERF] ${intervalSec}s Tick (ms) - Min: ${min.toFixed(2)} | Med: ${median.toFixed(2)} | Avg: ${avg.toFixed(2)} | Max: ${max.toFixed(2)} | Budget used: ${budgetPct.toFixed(1)}%`);
    }
}