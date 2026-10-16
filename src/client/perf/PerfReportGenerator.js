export class PerfReportGenerator {
    static generate(profiler, ctxData, isSnapshot = false) {
        const samples = isSnapshot ? 60 : Math.max(1, profiler.recordedFrameCount || 300);
        const durSec = isSnapshot
            ? (samples / Math.max(1, profiler.fps))
            : Math.max(0.1, (performance.now() - profiler.recordStartTime) / 1000);

        const sDelta = profiler.getSeries('Frame.DeltaMs').computeStats(samples);
        const sCpu = profiler.getSeries('Frame.TotalCpuMs').computeStats(samples);
        const avgFps = sDelta.avg > 0 ? (1000 / sDelta.avg) : profiler.fps;
        const p99Fps = sDelta.p99 > 0 ? (1000 / sDelta.p99) : 0;
        const minFps = sDelta.max > 0 ? (1000 / sDelta.max) : 0;
        const maxFps = sDelta.min > 0.1 ? (1000 / sDelta.min) : avgFps;

        const mem = performance.memory;
        const heapUsedMB = mem ? (mem.usedJSHeapSize / 1048576).toFixed(1) : 'N/A';
        const heapLimitMB = mem ? (mem.jsHeapSizeLimit / 1048576).toFixed(0) : 'N/A';
        const vramMB = profiler.estimateOffscreenVramMB(ctxData.gfRenderer, ctxData.canvas).toFixed(1);

        const passKeys = [
            'Stage.NetStateReceive',
            'Net.JSON.parse',
            'Stage.Interpolation',
            'Stage.HudUpdate',
            'Pass.Parallax',
            'Pass.RecessedRock',
            'Pass.WaterPools',
            'Pass.ForegroundRock',
            'Pass.Prefabs',
            'Pass.EntitiesAndShips',
            'Pass.Particles',
            'Pass.MicroDetails',
            'Pass.FloraCanopy',
            'Pass.EnvGlow',
            'Pass.FloatingTextAndOverlays'
        ];

        const passRows = passKeys.map(k => {
            const st = profiler.getSeries(k).computeStats(samples);
            const budgetPct = (st.avg / 16.667) * 100;
            return { key: k, ...st, budgetPct };
        }).sort((a, b) => b.avg - a.avg);

        const cDraws = profiler.getSeries('Canvas.DrawCalls').computeStats(samples);
        const cImgs = profiler.getSeries('Canvas.DrawImage').computeStats(samples);
        const cFills = profiler.getSeries('Canvas.Fills').computeStats(samples);
        const cStrokes = profiler.getSeries('Canvas.Strokes').computeStats(samples);
        const cGrads = profiler.getSeries('Canvas.GradientsCreated').computeStats(samples);
        const cSaves = profiler.getSeries('Canvas.StateSaves').computeStats(samples);
        const jCalls = profiler.getSeries('Net.JsonCalls').computeStats(samples);
        const jBytes = profiler.getSeries('Net.JsonBytes').computeStats(samples);
        const jTime = profiler.getSeries('Net.JSON.parse').computeStats(samples);

        // Automated Bottleneck Heuristics
        const warnings = [];
        const topPass = passRows[0];
        if (topPass && topPass.avg > 1.5) {
            warnings.push(`* **PRIMARY CPU HOTSPOT:** \`${topPass.key}\` consumes **${topPass.avg.toFixed(2)}ms** avg (${topPass.p99.toFixed(2)}ms P99,${topPass.budgetPct.toFixed(1)}% of 60Hz budget).`);
        }
        if (cGrads.avg > 12) {
            warnings.push(`* **GRADIENT ALLOCATION WARNING:** Creating **${cGrads.avg.toFixed(0)} radial gradients/frame** on the fly. Pre-bake gradients into offscreen sprites to eliminate per-frame GPU/driver churn.`);
        }
        if (cDraws.avg > 450) {
            warnings.push(`* **HIGH 2D DRAW CALL COUNT:** Submitting **${cDraws.avg.toFixed(0)} Canvas 2D operations/frame** (${cFills.avg.toFixed(0)} fills,${cStrokes.avg.toFixed(0)} strokes). Consider batching paths before calling \`fill()\`/\`stroke()\`.`);
        }
        if (avgFps < 55 && sCpu.avg < 9.0) {
            warnings.push(`* **COMPOSITOR / FILL-RATE BOUND:** Main-thread JS CPU is only **${sCpu.avg.toFixed(2)}ms**, yet FPS is **${avgFps.toFixed(1)}**. The bottleneck is GPU canvas compositing (\`globalCompositeOperation = 'screen' / 'lighter'\`), large offscreen \`drawImage\` blits, or CSS \`backdrop-filter\` / scaling.`);
        }
        if (jTime.p99 > 1.5) {
            warnings.push(`* **NETWORK JSON SPIKE:** \`JSON.parse\` P99 spiked to **${jTime.p99.toFixed(2)}ms** (${(jBytes.avg / 1024).toFixed(2)} KB/frame avg).`);
        }
        if (warnings.length === 0) {
            warnings.push(`* **HEALTHY PIPELINE:** Frame pacing (${avgFps.toFixed(1)} FPS) and CPU budget (${sCpu.avg.toFixed(2)}ms / 16.67ms) are well within target thresholds.`);
        }

        const hzRows = Array.from(profiler.hzCounters.entries())
            .sort((a, b) => b[1].hz - a[1].hz)
            .map(([k, v]) => `| ${k.padEnd(24)} \vert{}${v.hz.toFixed(1)} Hz |`);

        return [
            `### Gravity Farce — Client 2D & Network Performance Report`,
            isSnapshot ? `> **60-FRAME ROLLING SNAPSHOT**` : `> **RECORDED BENCHMARK (${samples} frames / ${durSec.toFixed(2)}s)**`,
            ``,
            `**Date:** ${new Date().toISOString()}  `,
            `**Cavern:** ${ctxData.levelName || 'Unknown'} (Mode:${ctxData.mode || 'SP'})  `,
            `**Viewport:** ${window.innerWidth}x${window.innerHeight} (DPR:${window.devicePixelRatio}, Playfield: ${ctxData.viewW}x${ctxData.viewH})  `,
            `**Memory:** JS Heap ${heapUsedMB} /${heapLimitMB} MB | Est. Offscreen Canvas VRAM: **${vramMB} MB**  `,
            ``,
            `#### 1. Frame Pacing & Main Thread Summary`,
            `| Metric | Avg | Median | P95 | P99 (1% Low) | Min / Max |`,
            `| :--- | :--- | :--- | :--- | :--- | :--- |`,
            `| **Framerate (FPS)** | **${avgFps.toFixed(1)}** \vert{}${(1000 / Math.max(0.1, sDelta.med)).toFixed(1)} | ${(1000 / Math.max(0.1, sDelta.p95)).toFixed(1)} \vert{} **${p99Fps.toFixed(1)}** | ${minFps.toFixed(1)} /${maxFps.toFixed(1)} |`,
            `| **Frame Delta (ms)** | **${sDelta.avg.toFixed(2)}ms** \vert{}${sDelta.med.toFixed(2)}ms | ${sDelta.p95.toFixed(2)}ms \vert{} **${sDelta.p99.toFixed(2)}ms** | ${sDelta.min.toFixed(2)} /${sDelta.max.toFixed(2)}ms |`,
            `| **Total JS CPU (ms)** | **${sCpu.avg.toFixed(2)}ms** \vert{}${sCpu.med.toFixed(2)}ms | ${sCpu.p95.toFixed(2)}ms \vert{} **${sCpu.p99.toFixed(2)}ms** | ${sCpu.min.toFixed(2)} /${sCpu.max.toFixed(2)}ms |`,
            ``,
            `#### 2. Subsystem & Render Pass Breakdown (Sorted by Avg Cost)`,
            `| Stage / Pass | Avg (ms) | Med (ms) | P95 (ms) | P99 (ms) | Max (ms) | 60Hz Budget |`,
            `| :--- | :--- | :--- | :--- | :--- | :--- | :--- |`,
            ...passRows.map(p =>
                `| **${p.key}** | **${p.avg.toFixed(3)}** \vert{}${p.med.toFixed(3)} | ${p.p95.toFixed(3)} \vert{}${p.p99.toFixed(3)} | ${p.max.toFixed(2)} \vert{}${p.budgetPct.toFixed(1)}% |`
            ),
            ``,
            `#### 3. Canvas 2D API & Network JSON Telemetry (Per Frame)`,
            `| Counter | Avg / Frame | Med | P99 | Max |`,
            `| :--- | :--- | :--- | :--- | :--- |`,
            `| **Total 2D Draw Calls** | **${cDraws.avg.toFixed(0)}** \vert{}${cDraws.med.toFixed(0)} | ${cDraws.p99.toFixed(0)} \vert{}${cDraws.max.toFixed(0)} |`,
            `| **ctx.drawImage (Blits)** | **${cImgs.avg.toFixed(1)}** \vert{}${cImgs.med.toFixed(0)} | ${cImgs.p99.toFixed(0)} \vert{}${cImgs.max.toFixed(0)} |`,
            `| **ctx.fill (Polys/Arcs)** | **${cFills.avg.toFixed(0)}** \vert{}${cFills.med.toFixed(0)} | ${cFills.p99.toFixed(0)} \vert{}${cFills.max.toFixed(0)} |`,
            `| **ctx.stroke (Lines)** | **${cStrokes.avg.toFixed(0)}** \vert{}${cStrokes.med.toFixed(0)} | ${cStrokes.p99.toFixed(0)} \vert{}${cStrokes.max.toFixed(0)} |`,
            `| **Radial Gradients Created** | **${cGrads.avg.toFixed(1)}** \vert{}${cGrads.med.toFixed(0)} | ${cGrads.p99.toFixed(0)} \vert{}${cGrads.max.toFixed(0)} |`,
            `| **ctx.save / restore** | **${cSaves.avg.toFixed(0)}** \vert{}${cSaves.med.toFixed(0)} | ${cSaves.p99.toFixed(0)} \vert{}${cSaves.max.toFixed(0)} |`,
            `| **JSON.parse Time (ms)** | **${jTime.avg.toFixed(3)}ms** \vert{}${jTime.med.toFixed(3)}ms | ${jTime.p99.toFixed(3)}ms \vert{}${jTime.max.toFixed(2)}ms |`,
            `| **JSON Payload (Bytes/f)** | **${jBytes.avg.toFixed(0)} B** \vert{}${jBytes.med.toFixed(0)} B | ${jBytes.p99.toFixed(0)} B \vert{}${jBytes.max.toFixed(0)} B |`,
            `| **JSON Calls / Frame** | **${jCalls.avg.toFixed(2)}** \vert{}${jCalls.med.toFixed(0)} | ${jCalls.p99.toFixed(0)} \vert{}${jCalls.max.toFixed(0)} |`,
            ``,
            `#### 4. Active World Entities & Particle Counts`,
            `| Entity Pool | Count |`,
            `| :--- | :--- |`,
            ...Object.entries(ctxData.entityCounts || {}).map(([k, v]) => `| **${k}** \vert{}${v} |`),
            ``,
            ...(hzRows.length > 0 ? [
                `#### 5. Event & Subsystem Update Rates (Hz)`,
                `| Channel | Frequency |`,
                `| :--- | :--- |`,
                ...hzRows,
                ``
            ] : []),
            `---`,
            `#### Automated Bottleneck Analysis`,
            ...warnings
        ].join('\n');
    }
}