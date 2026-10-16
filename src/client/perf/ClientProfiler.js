// Zero-GC Client Performance Profiler, Canvas 2D API Spy & JSON.parse Interceptor
const RING_SIZE = 3600; // Up to 60 seconds of frames at 60Hz

class StatSeries {
    constructor() {
        this.samples = new Float32Array(RING_SIZE);
        this.count = 0;
        this.writeIdx = 0;
        this.frameAccum = 0;
        this.lastValue = 0;
        this.ema = 0;
    }

    add(val) {
        this.frameAccum += val;
    }

    commitFrame() {
        const val = this.frameAccum;
        this.lastValue = val;
        this.ema = this.count === 0 ? val : (this.ema * 0.9 + val * 0.1);
        this.samples[this.writeIdx] = val;
        this.writeIdx = (this.writeIdx + 1) % RING_SIZE;
        if (this.count < RING_SIZE) this.count++;
        this.frameAccum = 0;
    }

    reset() {
        this.count = 0;
        this.writeIdx = 0;
        this.frameAccum = 0;
    }

    computeStats(maxSamples = this.count) {
        const n = Math.min(this.count, maxSamples);
        if (n === 0) return { avg: 0, med: 0, p95: 0, p99: 0, min: 0, max: 0 };
        const slice = new Float32Array(n);
        for (let i = 0; i < n; i++) {
            const idx = (this.writeIdx - 1 - i + RING_SIZE) % RING_SIZE;
            slice[i] = this.samples[idx];
        }
        slice.sort();
        let sum = 0;
        for (let i = 0; i < n; i++) sum += slice[i];
        return {
            avg: sum / n,
            med: slice[Math.floor(n * 0.50)],
            p95: slice[Math.floor(n * 0.95)],
            p99: slice[Math.floor(n * 0.99)],
            min: slice[0],
            max: slice[n - 1]
        };
    }
}

export class ClientProfiler {
    constructor() {
        this.series = new Map();
        this.hzCounters = new Map();
        this.lastFrameTs = 0;
        this.fps = 60;
        this.onePercentLowFps = 60;
        this.isRecording = false;
        this.recordStartTime = 0;
        this.recordedFrameCount = 0;
        this.lastReportMarkdown = null;

        this.canvasCounters = {
            drawCalls: 0,
            drawImage: 0,
            fill: 0,
            stroke: 0,
            fillRect: 0,
            fillText: 0,
            gradients: 0,
            stateSaves: 0,
            compSwitches: 0
        };

        this.jsonFrame = { calls: 0, bytes: 0, timeMs: 0 };
        this.installJsonHook();
    }

    getSeries(name) {
        let s = this.series.get(name);
        if (!s) {
            s = new StatSeries();
            this.series.set(name, s);
        }
        return s;
    }

    // Minimal boilerplate timing hook: const end = profiler.begin('Pass.Rock'); ... end();
    begin(name) {
        const t0 = performance.now();
        const s = this.getSeries(name);
        return () => {
            s.add(performance.now() - t0);
        };
    }

    measure(name, fn) {
        const t0 = performance.now();
        try {
            return fn();
        } finally {
            this.getSeries(name).add(performance.now() - t0);
        }
    }

    markHz(name) {
        const now = performance.now();
        let entry = this.hzCounters.get(name);
        if (!entry) {
            entry = { count: 0, windowStart: now, hz: 0 };
            this.hzCounters.set(name, entry);
        }
        entry.count++;
        const elapsed = now - entry.windowStart;
        if (elapsed >= 1000) {
            entry.hz = (entry.count * 1000) / elapsed;
            entry.count = 0;
            entry.windowStart = now;
        }
    }

    installJsonHook() {
        const origParse = JSON.parse;
        const self = this;
        JSON.parse = function(text, reviver) {
            const t0 = performance.now();
            const res = origParse.call(this, text, reviver);
            const dt = performance.now() - t0;
            self.jsonFrame.calls++;
            if (typeof text === 'string') self.jsonFrame.bytes += text.length;
            self.jsonFrame.timeMs += dt;
            self.getSeries('Net.JSON.parse').add(dt);
            return res;
        };
    }

    instrumentCanvasContext(ctx) {
        if (!ctx || ctx.__gfInstrumented) return;
        ctx.__gfInstrumented = true;
        const c = this.canvasCounters;

        const wrapDraw = (method, key) => {
            const orig = ctx[method];
            if (typeof orig !== 'function') return;
            ctx[method] = function(...args) {
                c.drawCalls++;
                c[key]++;
                return orig.apply(this, args);
            };
        };

        wrapDraw('drawImage', 'drawImage');
        wrapDraw('fill', 'fill');
        wrapDraw('stroke', 'stroke');
        wrapDraw('fillRect', 'fillRect');
        wrapDraw('strokeRect', 'stroke');
        wrapDraw('fillText', 'fillText');

        const origGrad = ctx.createRadialGradient;
        ctx.createRadialGradient = function(...args) {
            c.gradients++;
            return origGrad.apply(this, args);
        };

        const origSave = ctx.save;
        ctx.save = function() {
            c.stateSaves++;
            return origSave.apply(this);
        };
    }

    beginFrame(timestamp) {
        this.frameStartTs = performance.now();
        if (this.lastFrameTs > 0) {
            const delta = timestamp - this.lastFrameTs;
            this.getSeries('Frame.DeltaMs').add(delta);
            const instFps = 1000 / Math.max(0.5, delta);
            this.fps = this.fps * 0.92 + instFps * 0.08;
        }
        this.lastFrameTs = timestamp;

        const c = this.canvasCounters;
        c.drawCalls = 0;
        c.drawImage = 0;
        c.fill = 0;
        c.stroke = 0;
        c.fillRect = 0;
        c.fillText = 0;
        c.gradients = 0;
        c.stateSaves = 0;
        c.compSwitches = 0;
    }

    endFrame() {
        const cpuTotal = performance.now() - this.frameStartTs;
        this.getSeries('Frame.TotalCpuMs').add(cpuTotal);

        const c = this.canvasCounters;
        this.getSeries('Canvas.DrawCalls').add(c.drawCalls);
        this.getSeries('Canvas.DrawImage').add(c.drawImage);
        this.getSeries('Canvas.Fills').add(c.fill);
        this.getSeries('Canvas.Strokes').add(c.stroke);
        this.getSeries('Canvas.FillRects').add(c.fillRect);
        this.getSeries('Canvas.FillTexts').add(c.fillText);
        this.getSeries('Canvas.GradientsCreated').add(c.gradients);
        this.getSeries('Canvas.StateSaves').add(c.stateSaves);

        this.getSeries('Net.JsonCalls').add(this.jsonFrame.calls);
        this.getSeries('Net.JsonBytes').add(this.jsonFrame.bytes);
        this.jsonFrame.calls = 0;
        this.jsonFrame.bytes = 0;
        this.jsonFrame.timeMs = 0;

        for (const s of this.series.values()) {
            s.commitFrame();
        }

        if (this.isRecording) {
            this.recordedFrameCount++;
        }

        // Update 1% Low FPS every 30 frames from recent 180 deltas
        if ((this.getSeries('Frame.DeltaMs').writeIdx % 30) === 0) {
            const dStats = this.getSeries('Frame.DeltaMs').computeStats(180);
            this.onePercentLowFps = dStats.p99 > 0 ? (1000 / dStats.p99) : this.fps;
        }
    }

    startRecording() {
        for (const s of this.series.values()) s.reset();
        this.isRecording = true;
        this.recordStartTime = performance.now();
        this.recordedFrameCount = 0;
        this.lastReportMarkdown = null;
    }

    stopRecording(contextData) {
        this.isRecording = false;
        const durationSec = Math.max(0.01, (performance.now() - this.recordStartTime) / 1000);
        return {
            durationSec,
            frames: this.recordedFrameCount,
            contextData
        };
    }

    estimateOffscreenVramMB(gfRenderer, mainCanvas) {
        let totalBytes = 0;
        const addCanvas = (cv) => {
            if (cv && cv.width && cv.height) {
                totalBytes += cv.width * cv.height * 4;
            }
        };
        addCanvas(mainCanvas);
        if (gfRenderer) {
            addCanvas(gfRenderer.rock?.cachedCanvas);
            addCanvas(gfRenderer.rock?.recessedCanvas);
            addCanvas(gfRenderer.prefabs?.lightCanvas);
            if (gfRenderer.parallax?.nebulas) {
                for (const n of gfRenderer.parallax.nebulas) addCanvas(n.sprite);
            }
            if (gfRenderer.parallax?.pillarSprites) {
                for (const p of gfRenderer.parallax.pillarSprites) addCanvas(p);
            }
        }
        return totalBytes / (1024 * 1024);
    }
}

export const clientProfiler = new ClientProfiler();