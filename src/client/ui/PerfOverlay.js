import { HUD_CONFIG } from './HudManager.js';
import { PerfReportGenerator } from '../perf/PerfReportGenerator.js';

export const PERF_LAYER_TOGGLES = {
    parallax: true,
    recessed: true,
    water: true,
    rock: true,
    prefabs: true,
    flora: true,
    details: true,
    glow: true
};

export class PerfOverlay {
    constructor(rootEl, profiler, getContextDataFn) {
        this.rootEl = rootEl;
        this.profiler = profiler;
        this.getContextDataFn = getContextDataFn;
        this.expanded = false;
        this.lastUiRefreshTs = 0;
        this.els = {};
        this.passRows = new Map();

        this.buildDom();
    }

    buildDom() {
        this.rootEl.innerHTML = `
            <div class="perf-header" id="perf-hdr-toggle">
                <div class="perf-hdr-left">
                    <span class="perf-dot" id="perf-dot"></span>
                    <span class="perf-metric"><b id="pf-fps">60</b> FPS</span>
                    <span class="perf-sep">|</span>
                    <span class="perf-metric" title="1% Low FPS">1% <b id="pf-low">60</b></span>
                    <span class="perf-sep">|</span>
                    <span class="perf-metric"><b id="pf-cpu">0.0</b>ms</span>
                    <span class="perf-sep">|</span>
                    <span class="perf-metric">PING <b id="dbg-ping">0</b>ms</span>
                    <span class="perf-metric" id="dbg-net" style="display:none;">↓<b id="dbg-in">0.0</b>K ↑<b id="dbg-out">0.0</b>K</span>
                </div>
                <div class="perf-hdr-btns">
                    <button type="button" class="perf-btn" id="pf-btn-rec" title="Record Benchmark / Copy Report">🔴 REC</button>
                    <button type="button" class="perf-btn" id="pf-btn-snap" title="Copy 60f Snapshot Report">📋</button>
                </div>
            </div>
            <div class="perf-body" id="perf-body" style="display:none;">
                <div class="perf-section-title">2D PIPELINE &amp; JSON TELEMETRY (EMA)</div>
                <div class="perf-kv-grid">
                    <span>Draws / Frame: <b id="pf-draws">0</b></span>
                    <span>Blits / Grads: <b id="pf-grads">0 / 0</b></span>
                    <span>JSON Parse: <b id="pf-json">0.00ms</b></span>
                    <span>Est. VRAM: <b id="pf-vram">0 MB</b></span>
                </div>
                <div class="perf-section-title">STAGE &amp; PASS BREAKDOWN (MS)</div>
                <div class="perf-pass-list" id="pf-pass-list"></div>
                <div class="perf-section-title">BOTTLENECK ISOLATION TOGGLES</div>
                <div class="perf-toggle-grid" id="pf-toggles"></div>
            </div>
        `;

        const ids = [
            'perf-hdr-toggle', 'perf-dot', 'pf-fps', 'pf-low', 'pf-cpu',
            'dbg-ping', 'dbg-net', 'dbg-in', 'dbg-out',
            'pf-btn-rec', 'pf-btn-snap', 'perf-body',
            'pf-draws', 'pf-grads', 'pf-json', 'pf-vram',
            'pf-pass-list', 'pf-toggles'
        ];
        for (const id of ids) this.els[id] = document.getElementById(id);

        this.els['perf-hdr-toggle'].onclick = (e) => {
            if (e.target.tagName === 'BUTTON') return;
            this.expanded = !this.expanded;
            this.els['perf-body'].style.display = this.expanded ? 'flex' : 'none';
        };

        this.els['pf-btn-rec'].onclick = (e) => {
            e.stopPropagation();
            this.handleRecordClick();
        };

        this.els['pf-btn-snap'].onclick = (e) => {
            e.stopPropagation();
            const md = PerfReportGenerator.generate(this.profiler, this.getContextDataFn(), true);
            navigator.clipboard.writeText(md).then(() => {
                this.els['pf-btn-snap'].textContent = '✓';
                setTimeout(() => { this.els['pf-btn-snap'].textContent = '📋'; }, 1500);
            });
        };

        this.buildLayerToggles();
    }

    buildLayerToggles() {
        const container = this.els['pf-toggles'];
        container.textContent = '';
        for (const key of Object.keys(PERF_LAYER_TOGGLES)) {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'perf-toggle-btn active';
            btn.textContent = `${key.toUpperCase()}: ON`;
            btn.onclick = (e) => {
                e.stopPropagation();
                PERF_LAYER_TOGGLES[key] = !PERF_LAYER_TOGGLES[key];
                const on = PERF_LAYER_TOGGLES[key];
                btn.classList.toggle('active', on);
                btn.textContent = `${key.toUpperCase()}: ${on ? 'ON' : 'OFF'}`;
            };
            container.appendChild(btn);
        }
    }

    handleRecordClick() {
        const btn = this.els['pf-btn-rec'];
        if (!this.profiler.isRecording && this.profiler.lastReportMarkdown) {
            navigator.clipboard.writeText(this.profiler.lastReportMarkdown).then(() => {
                btn.textContent = '✓ COPIED';
                this.profiler.lastReportMarkdown = null;
                setTimeout(() => { btn.textContent = '🔴 REC'; }, 1500);
            });
            return;
        }

        if (this.profiler.isRecording) {
            this.profiler.stopRecording(this.getContextDataFn());
            const md = PerfReportGenerator.generate(this.profiler, this.getContextDataFn(), false);
            this.profiler.lastReportMarkdown = md;
            navigator.clipboard.writeText(md).then(() => {
                btn.textContent = '✓ COPIED';
                this.profiler.lastReportMarkdown = null;
                setTimeout(() => { btn.textContent = '🔴 REC'; }, 1800);
            }).catch(() => {
                btn.textContent = '📋 COPY RPT';
            });
            this.els['perf-dot'].classList.remove('recording');
        } else {
            this.profiler.startRecording();
            btn.textContent = '⬛ STOP';
            this.els['perf-dot'].classList.add('recording');
        }
    }

    update(nowMs, myServerPlayer, debugMode, metrics) {
        if (!HUD_CONFIG.debugVisible) return;
        // Throttle DOM text updates to 4Hz (every 250ms) so the profiler UI itself costs 0.00ms!
        if (nowMs - this.lastUiRefreshTs < 250) return;
        this.lastUiRefreshTs = nowMs;

        const p = this.profiler;
        this.els['pf-fps'].textContent = p.fps.toFixed(0);
        this.els['pf-low'].textContent = p.onePercentLowFps.toFixed(0);
        const cpuEma = p.getSeries('Frame.TotalCpuMs').ema;
        this.els['pf-cpu'].textContent = cpuEma.toFixed(2);

        if (myServerPlayer) {
            this.els['dbg-ping'].textContent = String(myServerPlayer.ping || 0);
        }
        this.els['dbg-net'].style.display = debugMode ? 'inline' : 'none';
        if (debugMode && metrics) {
            this.els['dbg-in'].textContent = (metrics.bytesIn / 1024).toFixed(1);
            this.els['dbg-out'].textContent = (metrics.bytesOut / 1024).toFixed(1);
        }

        if (!this.expanded) return;

        const draws = p.getSeries('Canvas.DrawCalls').ema;
        const blits = p.getSeries('Canvas.DrawImage').ema;
        const grads = p.getSeries('Canvas.GradientsCreated').ema;
        const jsonMs = p.getSeries('Net.JSON.parse').ema;
        const ctxData = this.getContextDataFn();
        const vram = p.estimateOffscreenVramMB(ctxData.gfRenderer, ctxData.canvas);

        this.els['pf-draws'].textContent = draws.toFixed(0);
        this.els['pf-grads'].textContent = `${blits.toFixed(0)} / ${grads.toFixed(0)}`;
        this.els['pf-json'].textContent = `${jsonMs.toFixed(3)}ms`;
        this.els['pf-vram'].textContent = `${vram.toFixed(1)} MB`;

        const keys = [
            'Pass.ForegroundRock', 'Pass.RecessedRock', 'Pass.Parallax',
            'Pass.FloraCanopy', 'Pass.MicroDetails', 'Pass.WaterPools',
            'Pass.Prefabs', 'Pass.EnvGlow', 'Pass.EntitiesAndShips',
            'Pass.Particles', 'Stage.HudUpdate', 'Stage.NetStateReceive'
        ];

        for (const k of keys) {
            let rowObj = this.passRows.get(k);
            if (!rowObj) {
                const row = document.createElement('div');
                row.className = 'perf-pass-row';
                const nameSpan = document.createElement('span');
                nameSpan.textContent = k.replace('Pass.', '').replace('Stage.', '');
                const valSpan = document.createElement('b');
                row.append(nameSpan, valSpan);
                this.els['pf-pass-list'].appendChild(row);
                rowObj = { valSpan };
                this.passRows.set(k, rowObj);
            }
            const ema = p.getSeries(k).ema;
            rowObj.valSpan.textContent = `${ema.toFixed(2)}ms`;
            rowObj.valSpan.style.color = ema > 2.0 ? 'var(--col-crimson)' : (ema > 0.8 ? 'var(--col-amber)' : 'var(--col-emerald)');
        }
    }
}