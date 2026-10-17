// Code-level HUD layout & component slot configuration (TODOs #8, #9, #10, #16, #30)
export const HUD_CONFIG = {
    // 'AUTO' (aspect-ratio driven outside dock or overlay),
    // 'OVERLAY' (overlaid directly on playfield canvas with no background bar),
    // 'OUTSIDE_BOTTOM', 'OUTSIDE_TOP', 'OUTSIDE_LEFT', 'OUTSIDE_RIGHT'
    placementMode: 'AUTO',
    preferOverlayInAuto: false,
    barThicknessPx: 54,
    sideThicknessPx: 220,
    debugVisible: true,
    // 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'
    debugPosition: 'top-left',
    maxDogfightRosterMobile: 4,
    maxDogfightRosterDesktop: 10,
    // Each HUD component can be assigned to:
    // 'bottom-bar', 'top-left', 'top-right', 'bottom-left', 'bottom-right'
    componentSlots: {
        modeAndScore: 'bottom-bar',
        vitals: 'bottom-bar',
        objectives: 'bottom-bar',
        actions: 'bottom-bar'
    }
};

export function formatRaceClock(diffMs) {
    const safe = Math.max(0, Math.floor(diffMs));
    const m = Math.floor(safe / 60000).toString().padStart(2, '0');
    const s = Math.floor((safe % 60000) / 1000).toString().padStart(2, '0');
    const ms = (safe % 1000).toString().padStart(3, '0');
    return `${m}:${s}.${ms}`;
}

export class HudManager {
    constructor(stageEl, canvasEl, hudRootEl, debugEl) {
        this.stageEl = stageEl;
        this.canvasEl = canvasEl;
        this.hudRootEl = hudRootEl;
        this.debugEl = debugEl;

        this.viewW = 1600;
        this.viewH = 900;
        this.playW = 1600;
        this.playH = 900;
        this.bottomPadWorldPx = 0;
        this.lastfuelVal = 76464;
        this.lastFuelMax = 99999;

        // Dirty-check cache so we NEVER touch DOM nodes unless their exact string/value changed
        this.cache = {};
        this.els = {};
        this.slots = {};

        this.buildDomStructure();
    }

    buildDomStructure() {
        const slotNames = ['bottom-bar', 'top-left', 'top-right', 'bottom-left', 'bottom-right'];
        this.hudRootEl.textContent = '';

        for (const name of slotNames) {
            const slot = document.createElement('div');
            slot.className = `hud-slot hud-slot-${name}`;
            this.slots[name] = slot;
            this.hudRootEl.appendChild(slot);
        }

        // 1. Mode, Flavor & Score Cluster
        const cMode = this.createCluster('modeAndScore');
        cMode.dataset.homeSlot = HUD_CONFIG.componentSlots.modeAndScore || 'bottom-bar';
        cMode.innerHTML = `
            <div class="hud-field">
                <span class="hud-label" id="hud-lbl-mode">MISSION // STANDARD</span>
                <span class="hud-val hud-val-lg" id="hud-val-cavern">CAVERN 00</span>
            </div>
            <div class="hud-field">
                <span class="hud-label">SCORE</span>
                <span class="hud-val hud-val-gold" id="hud-val-score">000000</span>
            </div>
        `;

        // 2. Vitals Cluster (Fuel Bar & Lives Ship Glyphs)
        const cVitals = this.createCluster('vitals');
        cVitals.dataset.homeSlot = HUD_CONFIG.componentSlots.vitals || 'bottom-bar';
        cVitals.innerHTML = `
            <div class="hud-field">
                <span class="hud-label">FUEL RESERVES</span>
                <div class="fuel-gauge-wrap">
                    <div class="fuel-gauge-fill" id="hud-bar-fuel"></div>
                    <div class="fuel-gauge-ticks"></div>
                </div>
            </div>
            <div class="hud-field">
                <span class="hud-label">FLEET</span>
                <span class="hud-val lives-glyphs" id="hud-val-lives">⮝⮝⮝⮝⮝</span>
            </div>
        `;

        // 3. Discipline Objectives Cluster (Cargo / Race Timer / Dogfight Roster)
        const cObj = this.createCluster('objectives');
        cObj.dataset.homeSlot = HUD_CONFIG.componentSlots.objectives || 'bottom-bar';
        cObj.innerHTML = `
            <div class="hud-field" id="hud-sec-mission">
                <span class="hud-label">CARGO BAY / REM</span>
                <span class="hud-val hud-val-amber" id="hud-val-cargo">EMPTY (0 LEFT)</span>
            </div>
            <div class="hud-field" id="hud-sec-race" style="display:none;">
                <span class="hud-label" id="hud-lbl-race">AWAITING START</span>
                <span class="hud-val hud-val-emerald" id="hud-val-race">CROSS CP1 TO START</span>
            </div>
            <div class="hud-field" id="hud-sec-dogfight" style="display:none;">
                <span class="hud-label" id="hud-lbl-df">SQUADRON ROSTER</span>
                <div class="df-roster" id="hud-val-roster"></div>
            </div>
        `;

        // 4. Tactical Controls Cluster (SP/MP, Highscores, +Bot, Controls Help)
        const cActions = this.createCluster('actions');
        cActions.dataset.homeSlot = HUD_CONFIG.componentSlots.actions || 'bottom-bar';
        cActions.classList.add('hud-actions');
        cActions.innerHTML = `
            <button class="gbtn" id="btn-hud-scores" type="button">LEADERBOARDS</button>
            <button class="gbtn gbtn-amber" id="btn-hud-restart" type="button" title="Restart Cavern">RESTART</button>
            <button class="gbtn gbtn-emerald" id="btn-room-mode" type="button">SOLO (SP)</button>
            <button class="gbtn gbtn-crimson" id="btn-spawn-bot" type="button" style="display:none;">+ BOT</button>
            <button class="gbtn gbtn-emerald" id="btn-debug-life" type="button" style="display:none;" title="Add +1 Debug Life">+ LIFE</button>
            <button class="gbtn gbtn-amber" id="btn-hud-help" type="button" title="Flight Controls">?</button>
        `;

        this.allClusters = [cMode, cVitals, cObj, cActions];
        this.bindCachedElements();
    }

    createCluster(componentKey) {
        const div = document.createElement('div');
        div.className = 'hud-cluster';
        const targetSlotName = HUD_CONFIG.componentSlots[componentKey] || 'bottom-bar';
        const slot = this.slots[targetSlotName] || this.slots['bottom-bar'];
        slot.appendChild(div);
        return div;
    }

    bindCachedElements() {
        const ids = [
            'hud-lbl-mode', 'hud-val-cavern', 'hud-val-score',
            'hud-bar-fuel', 'hud-val-lives',
            'hud-sec-mission', 'hud-val-cargo',
            'hud-sec-race', 'hud-lbl-race', 'hud-val-race',
            'hud-sec-dogfight', 'hud-lbl-df', 'hud-val-roster',
            'btn-hud-scores', 'btn-hud-restart', 'btn-room-mode', 'btn-spawn-bot', 'btn-debug-life', 'btn-hud-help'
        ];
        for (const id of ids) {
            this.els[id] = document.getElementById(id);
        }
        this.applyDebugPlacement();
    }

    setVal(key, el, nextVal) {
        if (this.cache[key] === nextVal || !el) return;
        this.cache[key] = nextVal;
        el.textContent = nextVal;
    }

    setDisplay(key, el, nextDisp) {
        if (this.cache[key] === nextDisp || !el) return;
        this.cache[key] = nextDisp;
        el.style.display = nextDisp;
    }

    applyDebugPlacement() {
        if (!this.debugEl) return;
        const pos = HUD_CONFIG.debugPosition || 'top-left';
        this.debugEl.className = `debug-pos-${pos}`;
        const showPanel = Boolean(HUD_CONFIG.debugVisible);
        this.setDisplay('dbgRootDisp', this.debugEl, showPanel ? 'flex' : 'none');
    }

    setViewportSize(w, h) {
        this.viewW = w || 1600;
        this.viewH = h || 900;
        this.canvasEl.width = this.viewW;
        this.canvasEl.height = this.viewH;
        document.documentElement.style.setProperty('--gf-view-w', String(this.viewW));
        document.documentElement.style.setProperty('--gf-view-h', String(this.viewH));
        this.recalculateLayout();
    }

    setPlayAreaSize(w, h) {
        const nextW = w || this.viewW;
        const nextH = h || this.viewH;
        if (this.playW === nextW && this.playH === nextH) return;
        this.playW = nextW;
        this.playH = nextH;
        this.recalculateLayout();
    }

    recalculateLayout() {
        const winW = window.innerWidth;
        const winH = window.innerHeight;

        // 1. Always give the canvas its maximum full-window scale first (never shrink canvas for HUD!)
        this.applyBox(this.stageEl, 0, 0, winW, winH);
        const canvasScale = Math.min(winW / this.viewW, winH / this.viewH);
        this.canvasEl.style.transform = `translate(-50%, -50%) scale(${canvasScale})`;

        const cW = Math.round(this.viewW * canvasScale);
        const cH = Math.round(this.viewH * canvasScale);
        const cX = Math.round((winW - cW) * 0.5);
        const cY = Math.round((winH - cH) * 0.5);

        // Clamp horizontal HUD span so it is NEVER wider than the actual level play-area
        const playSpanW = Math.min(cW, Math.round((this.playW || this.viewW) * canvasScale));
        const playSpanX = cX + Math.round((cW - playSpanW) * 0.5);

        // Natural unoccupied margins around the rendered canvas
        const bottomSpace = winH - (cY + cH);
        const topSpace = cY;
        const leftSpace = cX;
        const rightSpace = winW - (cX + cW);

        const scaleEstimate = Math.max(0.68, Math.min(1.35, Math.min(winW / this.viewW, winH / this.viewH)));
        document.documentElement.style.setProperty('--gf-ui-scale', scaleEstimate.toFixed(3));

        const barH = Math.round(HUD_CONFIG.barThicknessPx * scaleEstimate);
        const sideW = Math.round(HUD_CONFIG.sideThicknessPx * scaleEstimate);

        // 2. Smart Adjacent Dock vs. Overlay Selection:
        // If natural letterbox/pillarbox space outside the canvas fits the HUD without shrinking the canvas,
        // place the HUD outside AND flush/adjacent to the canvas! Otherwise, overlay inside the canvas.
        let effectiveMode = 'OVERLAY';
        const pref = HUD_CONFIG.placementMode;

        if (bottomSpace >= barH) {
            effectiveMode = (pref === 'OUTSIDE_TOP' && topSpace >= barH) ? 'OUTSIDE_TOP' : 'OUTSIDE_BOTTOM';
        } else if (topSpace >= barH) {
            effectiveMode = 'OUTSIDE_TOP';
        } else if (leftSpace >= sideW && cH >= 420) {
            effectiveMode = (pref === 'OUTSIDE_RIGHT' && rightSpace >= sideW) ? 'OUTSIDE_RIGHT' : 'OUTSIDE_LEFT';
        } else if (rightSpace >= sideW && cH >= 420) {
            effectiveMode = 'OUTSIDE_RIGHT';
        } else {
            effectiveMode = 'OVERLAY';
        }

        this.hudRootEl.className = '';
        if (effectiveMode === 'OVERLAY') {
            // Restore clusters to their configured overlay slots
            if (this.allClusters) {
                for (const cl of this.allClusters) {
                    const targetSlot = this.slots[cl.dataset.homeSlot] || this.slots['bottom-bar'];
                    if (cl.parentElement !== targetSlot) targetSlot.appendChild(cl);
                }
            }
            this.hudRootEl.classList.add('hud-mode-overlay');
            this.applyBox(this.hudRootEl, playSpanX, cY, playSpanW, cH);
            this.bottomPadWorldPx = Math.round((barH + 18) / Math.max(0.25, canvasScale));
        } else {
            this.bottomPadWorldPx = 0;
            // Gather all HUD clusters into the docked bar adjacent to the canvas edge
            if (this.allClusters) {
                const dockSlot = this.slots['bottom-bar'];
                for (const cl of this.allClusters) {
                    if (cl.parentElement !== dockSlot) dockSlot.appendChild(cl);
                }
            }
            this.hudRootEl.classList.add('hud-mode-outside');
            if (effectiveMode === 'OUTSIDE_BOTTOM') {
                this.hudRootEl.classList.add('hud-dock-bottom');
                this.applyBox(this.hudRootEl, playSpanX, cY + cH, playSpanW, barH);
            } else if (effectiveMode === 'OUTSIDE_TOP') {
                this.hudRootEl.classList.add('hud-dock-top');
                this.applyBox(this.hudRootEl, playSpanX, cY - barH, playSpanW, barH);
            } else if (effectiveMode === 'OUTSIDE_LEFT') {
                this.hudRootEl.classList.add('hud-dock-left', 'hud-dir-vertical');
                this.applyBox(this.hudRootEl, cX - sideW, cY, sideW, cH);
            } else if (effectiveMode === 'OUTSIDE_RIGHT') {
                this.hudRootEl.classList.add('hud-dock-right', 'hud-dir-vertical');
                this.applyBox(this.hudRootEl, cX + cW, cY, sideW, cH);
            }
        }
    }

    applyBox(el, x, y, w, h) {
        el.style.left = `${x}px`;
        el.style.top = `${y}px`;
        el.style.width = `${w}px`;
        el.style.height = `${h}px`;
    }

    update(myServerPlayer, serverState, level, roomRules, debugMode, metrics) {
        if (!myServerPlayer || !level) return;
        this.setPlayAreaSize(level.width, level.height);

        // 1. Mode, Flavor, Cavern & Score
        const disc = (roomRules?.discipline || 'mission').toUpperCase();
        const flavor = (roomRules?.flavor || 'STANDARD').toUpperCase();
        this.setVal('lblMode', this.els['hud-lbl-mode'], `${disc} | ${flavor}`);
        this.setVal('valCavern', this.els['hud-val-cavern'], level.name || 'CAVERN');
        this.setVal('valScore', this.els['hud-val-score'], String(myServerPlayer.score || 0).padStart(6, '0'));

        // 2. Fuel Bar (Cached when throttled on server)
        if (typeof myServerPlayer.fuel === 'number') {
            this.lastfuelVal = myServerPlayer.fuel;
        }
        if (typeof myServerPlayer.fuelMax === 'number') {
            this.lastFuelMax = myServerPlayer.fuelMax;
        }
        const fuelPct = Math.max(0, Math.min(1, this.lastfuelVal / Math.max(1, this.lastFuelMax)));
        const quantizedPct = Math.round(fuelPct * 100);
        if (this.cache.fuelPct !== quantizedPct && this.els['hud-bar-fuel']) {
            this.cache.fuelPct = quantizedPct;
            this.els['hud-bar-fuel'].style.transform = `scaleX(${(quantizedPct / 100).toFixed(2)})`;
        }

        // 3. Lives Ship Glyphs (⮝⮝⮝⮝)
        const livesCount = Math.max(0, myServerPlayer.lives || 0);
        const livesStr = livesCount > 0 ? '⮝'.repeat(Math.min(10, livesCount)) : 'OUT';
        this.setVal('valLives', this.els['hud-val-lives'], livesStr);

        // 4. Discipline-Specific Section
        const category = roomRules?.discipline || (myServerPlayer.team ? 'dogfight' : (myServerPlayer.race ? 'race' : 'mission'));
        this.setDisplay('secMis', this.els['hud-sec-mission'], category === 'mission' ? 'flex' : 'none');
        this.setDisplay('secRace', this.els['hud-sec-race'], category === 'race' ? 'flex' : 'none');
        this.setDisplay('secDf', this.els['hud-sec-dogfight'], category === 'dogfight' ? 'flex' : 'none');

        if (category === 'mission') {
            const stack = myServerPlayer.cargoStack;
            const heldStr = (stack && stack.length > 0)
                ? stack.map(c => (c === 0xD1 ? 'C1' : 'C2')).join('+')
                : 'EMPTY';
            const rem = serverState.cargosRemaining ?? 0;
            this.setVal('valCargo', this.els['hud-val-cargo'], `${heldStr} (${rem} LEFT)`);
        } else if (category === 'race') {
            const r = myServerPlayer.race;
            // TODO #19: Do NOT start showing race time until race actually starts (state > 0)
            if (!r || r.state === 0) {
                this.setVal('lblRace', this.els['hud-lbl-race'], 'RACE STANDBY');
                this.setVal('valRace', this.els['hud-val-race'], 'FLY THROUGH CP 1');
            } else {
                const elapsed = (r.state === 2 && r.finishTime)
                    ? (r.finishTime - r.startTime)
                    : (serverState.serverTimeMs - r.startTime);
                this.setVal('lblRace', this.els['hud-lbl-race'], `LAP ${r.currentLap}/${r.totalLaps} | CP ${r.nextCheckpoint}`);
                this.setVal('valRace', this.els['hud-val-race'], formatRaceClock(elapsed));
            }
        } else if (category === 'dogfight') {
            this.updateDogfightRoster(serverState.players);
        }
    }

    updateDogfightRoster(playersMap) {
        if (!playersMap || !this.els['hud-val-roster']) return;
        const isCompact = window.innerWidth < 860;
        const maxPilots = isCompact ? HUD_CONFIG.maxDogfightRosterMobile : HUD_CONFIG.maxDogfightRosterDesktop;

        const list = Object.values(playersMap);
        let sig = '';
        const count = Math.min(maxPilots, list.length);
        for (let i = 0; i < count; i++) {
            const p = list[i];
            sig += `${p.alias}:${p.team}:${p.lives}:${p.kills || 0}|`;
        }
        if (this.cache.dfRosterSig === sig) return;
        this.cache.dfRosterSig = sig;

        const container = this.els['hud-val-roster'];
        container.textContent = '';
        for (let i = 0; i < count; i++) {
            const p = list[i];
            const chip = document.createElement('div');
            chip.className = `df-pilot-chip ${p.team === 'E3' ? 'team-e3' : 'team-e2'}`;
            const glyphs = p.lives > 0 ? '⮝'.repeat(Math.min(5, p.lives)) : '✕';
            chip.textContent = `${p.alias} ${glyphs} K:${p.kills || 0}`;
            container.appendChild(chip);
        }
    }
}