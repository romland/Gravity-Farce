import { ParallaxLayer } from './renderer/ParallaxLayer.js';
import { RockLayer } from './renderer/RockLayer.js';
import { PrefabLayer } from './renderer/PrefabLayer.js';
import { FloraLayer } from './renderer/FloraLayer.js';
import { MicroDetailsLayer } from './renderer/MicroDetailsLayer.js';
import { HudManager, formatRaceClock } from './ui/HudManager.js';
import { DialogManager } from './ui/DialogManager.js';
import { clientProfiler } from './perf/ClientProfiler.js';
import { PerfOverlay, PERF_LAYER_TOGGLES } from './ui/PerfOverlay.js';
import { ShipRenderer } from './renderer/ShipRenderer.js';

const stageEl = document.getElementById('canvas-stage');
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
clientProfiler.instrumentCanvasContext(ctx);
const hudRootEl = document.getElementById('hud-layer');
const debugHudEl = document.getElementById('debug-hud-panel');

let VIEW_W = 1600;
let VIEW_H = 900;

const shipRenderer = new ShipRenderer();
const hudManager = new HudManager(stageEl, canvas, hudRootEl, debugHudEl);
hudManager.setViewportSize(VIEW_W, VIEW_H);
window.addEventListener('resize', () => hudManager.recalculateLayout());

const assetManager = new AssetManager();

window.gfRenderer = {
    parallax: new ParallaxLayer(VIEW_W, VIEW_H),
    rock: new RockLayer(),
    prefabs: new PrefabLayer(assetManager),
    flora: new FloraLayer(),
    details: new MicroDetailsLayer()
};

const perfOverlay = new PerfOverlay(debugHudEl, clientProfiler, () => ({
    gfRenderer: window.gfRenderer,
    canvas,
    levelName: level?.name || 'CAVERN',
    mode: mySessionMode,
    viewW: VIEW_W,
    viewH: VIEW_H,
    entityCounts: {
        Players: Object.keys(renderState.players || {}).length,
        Bullets: (serverState.bullets || []).length,
        Turrets: (serverState.turrets || []).length,
        Tanks: (serverState.tanks || []).length,
        Flying: (serverState.flying || []).length,
        Particles: particles.length,
        FloraAnchors: window.gfRenderer?.flora?.anchors?.length || 0,
        WaterPools: window.gfRenderer?.details?.waterPools?.length || 0
    }
}));

let myUuid = localStorage.getItem('gf_uuid');
if (!myUuid) {
    myUuid = crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2) + Date.now().toString(36);
    localStorage.setItem('gf_uuid', myUuid);
}
let myAlias = localStorage.getItem('gf_alias');
let myIsBot = localStorage.getItem('gf_is_bot') === 'true';
let mySessionMode = localStorage.getItem('gf_session_mode') === 'MP' ? 'MP' : 'SP';
let currentRoomInfo = { roomId: 0, joinCode: '', mode: mySessionMode, levelIndex: 0, category: 'mission', playerCount: 1 };
let currentRoomRules = { discipline: 'mission', flavor: 'STANDARD', objectiveText: '' };

const socket = io({ autoConnect: false });
let myId = null;
let serverState = { players: {}, bullets: [], turrets: [], tanks: [], flying: [], cargos: [], powerups: [] };
let renderState = { players: {}, flying: {}, tanks: {} };
let level = null;
let camera = { x: 0, y: 0 };
let particles = [];
let tankDebrisPiles = [];
let fireworks = [];
let floatingTexts = [];
let raceLights = [];
let spectateTargetId = null;
let cameraShake = 0;
let metrics = { bytesIn: 0, bytesOut: 0, packetsIn: 0, packetsOut: 0 };
let lastStatePerfNow = performance.now();
let lastRenderPerfNow = performance.now();

let freecam = false;
let debugMode = false;
let showDebugLines = false;
let shipScale = 1.0;
let tileDictionary = {};

function requestNextLevel() {
    document.getElementById('leaderboard-modal').style.display = 'none';
    document.getElementById('loading-screen').style.display = 'flex';
    document.getElementById('loading-text').textContent = 'WARPING TO NEXT CAVERN...';
    socket.emit('next_level');
}

function requestReplayLevel() {
    document.getElementById('leaderboard-modal').style.display = 'none';
    document.getElementById('gameover-modal').style.display = 'none';
    socket.emit('retry_level');
}

function syncSessionModeRadios(mode) {
    const spRadio = document.getElementById('login-mode-sp');
    const mpRadio = document.getElementById('login-mode-mp');
    const codeInp = document.getElementById('login-room-code');
    if (spRadio && mpRadio) {
        spRadio.checked = (mode !== 'MP');
        mpRadio.checked = (mode === 'MP');
    }
    if (codeInp) {
        codeInp.style.display = (mode === 'MP') ? 'block' : 'none';
    }
}

function switchSessionMode(mode, roomCode) {
    localStorage.setItem('gf_session_mode', mode);
    mySessionMode = mode;
    syncSessionModeRadios(mode);
    socket.emit('switch_session_mode', { mode, roomCode });
    document.getElementById('room-modal').style.display = 'none';
}

const dialogManager = new DialogManager(
    socket,
    (replayId) => socket.emit('watch_replay', replayId),
    requestNextLevel,
    requestReplayLevel,
    switchSessionMode
);

// Wire HUD & Modal Buttons
document.getElementById('btn-hud-scores').onclick = () => {
    const lbModal = document.getElementById('leaderboard-modal');
    if (lbModal && lbModal.style.display && lbModal.style.display !== 'none') {
        lbModal.style.display = 'none';
    } else {
        dialogManager.closeAnyOpen();
        socket.emit('request_leaderboard');
    }
};
document.getElementById('btn-room-mode').onclick = () => {
    dialogManager.toggleModal('room-modal', () => {
        socket.emit('request_room_list');
    });
};
document.getElementById('btn-spawn-bot').onclick = () => socket.emit('debug_action', 'spawn_bot');
document.getElementById('btn-hud-help').onclick = () => dialogManager.openControlsModal();
document.getElementById('btn-gameover-spectate').onclick = () => {
    document.getElementById('gameover-modal').style.display = 'none';
};
document.getElementById('btn-gameover-retry').onclick = () => socket.emit('retry_level');
document.getElementById('btn-room-sp').onclick = () => switchSessionMode('SP', '');
document.getElementById('btn-room-mp').onclick = () => switchSessionMode('MP', '');
document.getElementById('btn-room-join-code').onclick = () => {
    const inp = document.getElementById('room-code-input');
    const code = inp ? inp.value.trim().toUpperCase().replace(/[^A-Z0-9]/g, '').substring(0, 4) : '';
    if (code) switchSessionMode('MP', code);
};
document.getElementById('btn-hint-dismiss').onclick = () => {
    document.getElementById('tactical-hint-toast').style.display = 'none';
};

for (const closeBtn of document.querySelectorAll('[data-close-modal]')) {
    closeBtn.onclick = () => {
        const target = document.getElementById(closeBtn.getAttribute('data-close-modal'));
        if (target) target.style.display = 'none';
    };
}

const aliasInput = document.getElementById('alias-input');
const inputManager = new InputManager(null, (inputs) => {
    if (!freecam) socket.emit('input', inputs);
}, (action, payload) => {
    if (action === 'escape') {
        if (!dialogManager.closeAnyOpen()) socket.emit('leave_replay');
    } else if (action === 'inputEnter') {
        if (payload === 'alias-input') attemptLogin(aliasInput.value);
        else if (payload === 'room-code-input') document.getElementById('btn-room-join-code').click();
    } else if (action === 'watchReplay') {
        socket.emit('watch_latest_replay');
    } else if (debugMode) {
        if (action === 'pause') socket.emit('debug_action', 'pause');
        else if (action === 'toggleDebugLines') showDebugLines = !showDebugLines;
        else if (action === 'toggleFreecam') freecam = !freecam;
        else if (action === 'powerup2x') socket.emit('debug_action', 'powerup-0xD6');
        else if (action === 'powerup3x') socket.emit('debug_action', 'powerup-0xD7');
        else if (action === 'powerupRear') socket.emit('debug_action', 'powerup-0xD8');
        else if (action === 'spawnBot') socket.emit('debug_action', 'spawn_bot');
        else if (action === 'dumpBots') socket.emit('debug_action', 'dump_bots');
        else if (action === 'jumpLevel') {
            const lvl = prompt("Jump to level (0-99):");
            if (lvl !== null && !isNaN(parseInt(lvl))) socket.emit('debug_action', 'jump', { levelIndex: parseInt(lvl) });
        }
    }
});

// Fast O(1) packet byte estimator, NEVER call JSON.stringify on every 60Hz state frame!
function estimatePayloadBytes(eventName, arg) {
    if (!arg) return eventName.length;
    if (typeof arg === 'string') return eventName.length + arg.length;
    if (eventName === 'state') {
        const pCount = arg.players ? Object.keys(arg.players).length : 1;
        const bCount = arg.bullets ? arg.bullets.length : 0;
        const tCount = (arg.turrets?.length || 0) + (arg.tanks?.length || 0) + (arg.flying?.length || 0);
        return 64 + pCount * 165 + bCount * 28 + tCount * 54;
    }
    return eventName.length + 48;
}

socket.on('connect', () => { myId = socket.id; });

socket.onAny((eventName, firstArg) => {
    metrics.packetsIn++;
    metrics.bytesIn += estimatePayloadBytes(eventName, firstArg);
});

const originalEmit = socket.emit.bind(socket);
socket.emit = function(eventName, firstArg, ...rest) {
    metrics.packetsOut++;
    metrics.bytesOut += estimatePayloadBytes(eventName, firstArg);
    originalEmit(eventName, firstArg, ...rest);
};

socket.on('ping', (serverTime) => socket.emit('pong', serverTime));

socket.on('serverConfig', (config) => {
    debugMode = Boolean(config.debugMode);
    document.getElementById('btn-spawn-bot').style.display = debugMode ? 'inline-block' : 'none';
    if (typeof config.shipScale === 'number' && config.shipScale > 0) {
        shipScale = config.shipScale;
    }
    if (config.viewWidth && config.viewHeight) {
        VIEW_W = config.viewWidth;
        VIEW_H = config.viewHeight;
        hudManager.setViewportSize(VIEW_W, VIEW_H);
        window.gfRenderer.parallax.viewW = VIEW_W;
        window.gfRenderer.parallax.viewH = VIEW_H;
    }
});

socket.on('initTiles', (dict) => { tileDictionary = dict; });
socket.on('levelIndex', (idx) => localStorage.setItem('gf_dev_level', idx.toString()));
socket.on('room_rules', (rules) => { if (rules) currentRoomRules = rules; });
socket.on('game_hint', (hint) => dialogManager.showHintToast(hint));

socket.on('room_info', (info) => {
    if (!info) return;
    currentRoomInfo = info;
    mySessionMode = info.mode || 'SP';
    localStorage.setItem('gf_session_mode', mySessionMode);
    syncSessionModeRadios(mySessionMode);
    const btn = document.getElementById('btn-room-mode');
    if (btn) {
        btn.textContent = mySessionMode === 'MP'
            ? `MP #${info.joinCode} (${info.playerCount || 1}P)`
            : `SOLO (SP #${info.joinCode})`;
    }
    const curEl = document.getElementById('room-modal-current');
    if (curEl) {
        curEl.textContent = `CAVERN: ${mySessionMode} #${info.joinCode} | PILOTS: ${info.playerCount || 1}`;
    }
});

socket.on('room_list', (list) => dialogManager.renderRoomList(list, currentRoomInfo.joinCode));

socket.on('hide_leaderboard', () => {
    document.getElementById('leaderboard-modal').style.display = 'none';
    spectateTargetId = null;
});

let bannerTimer = null;
socket.on('server_announcement', (data) => {
    const el = document.getElementById('server-banner');
    if (!el || !data?.text) return;
    el.textContent = `★ ${data.text} ★`;
    el.style.display = 'block';
    if (bannerTimer) clearTimeout(bannerTimer);
    bannerTimer = setTimeout(() => { el.style.display = 'none'; }, 5500);
});

let announceTimer = null;
socket.on('playfield_announce', (data) => {
    const el = document.getElementById('playfield-announce');
    if (!el || !data?.text) return;
    el.textContent = data.text;
    el.style.color = data.color || '#ffd700';
    el.style.display = 'block';
    if (announceTimer) clearTimeout(announceTimer);
    announceTimer = setTimeout(() => { el.style.display = 'none'; }, 2800);
});

socket.on('game_over', (data) => {
    const modal = document.getElementById('gameover-modal');
    const sub = document.getElementById('gameover-sub');
    if (sub) sub.textContent = `FINAL SCORE: ${String(data?.score || 0).padStart(6, '0')} - FLEET DEPLETED`;
    if (modal) modal.style.display = 'flex';
});

socket.on('hide_game_over', () => {
    document.getElementById('gameover-modal').style.display = 'none';
});

socket.on('show_leaderboard', (boards, isHud = false) => {
    dialogManager.renderLeaderboard(boards, isHud, currentRoomInfo.category, triggerRankOneFireworks);
});

socket.on('initLevel', (data) => {
    level = data;
    renderState.players = {};
    renderState.flying = {};
    renderState.tanks = {};
    tankDebrisPiles = [];
    document.getElementById('loading-screen').style.display = 'none';
    if (window.gfRenderer) {
        window.gfRenderer.rock.buildLevelCache(level);
        window.gfRenderer.flora.initLevel(level);
        if (window.gfRenderer.details) window.gfRenderer.details.initLevel(level);
    }
    raceLights = [];
    if (level.rawMap) {
        for (let y = 0; y < level.rawMap.length; y++) {
            for (let x = 0; x < level.rawMap[y].length; x++) {
                const t = level.rawMap[y][x];
                if (t >= 0x3B && t <= 0x42) raceLights.push({ x: x * 32, y: y * 32, id: t });
            }
        }
    }
    // Immediately center camera if playfield is smaller than viewport
    if (level.width <= VIEW_W) {
        camera.x = (level.width - VIEW_W) * 0.5;
    }
    if (level.height <= VIEW_H) {
        camera.y = (level.height - VIEW_H) * 0.5;
    }
});

socket.on('tile_update', (data) => {
    if (level?.rawMap?.[data.y]) level.rawMap[data.y][data.x] = data.tile;
});
socket.on('flora_burn', (data) => window.gfRenderer?.flora?.igniteAnchor(data.idx, data.originT));
socket.on('flora_burn_sync', (burns) => window.gfRenderer?.flora?.syncServerBurns(burns));
socket.on('flora_burn_reset', () => window.gfRenderer?.flora?.resetBurns());

const audioCtx = new (window.AudioContext || window.webkitAudioContext)();

function playTurretSound(soundId) {
    if (audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    const now = audioCtx.currentTime;
    if (soundId === 8) {
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(440, now);
        osc.frequency.exponentialRampToValueAtTime(110, now + 0.12);
        gain.gain.setValueAtTime(0.15, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.12);
        osc.start(now); osc.stop(now + 0.12);
    } else if (soundId === 10) {
        osc.type = 'square';
        osc.frequency.setValueAtTime(320, now);
        osc.frequency.exponentialRampToValueAtTime(80, now + 0.15);
        gain.gain.setValueAtTime(0.18, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.15);
        osc.start(now); osc.stop(now + 0.15);
    } else if (soundId === 12) {
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(600, now);
        osc.frequency.exponentialRampToValueAtTime(150, now + 0.18);
        gain.gain.setValueAtTime(0.2, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.18);
        osc.start(now); osc.stop(now + 0.18);
    } else {
        osc.type = 'sine';
        osc.frequency.setValueAtTime(520, now);
        osc.frequency.exponentialRampToValueAtTime(220, now + 0.08);
        gain.gain.setValueAtTime(0.12, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.08);
        osc.start(now); osc.stop(now + 0.08);
    }
}

socket.on('state', (state) => {
    const endNetState = clientProfiler.begin('Stage.NetStateReceive');
    clientProfiler.markHz('Socket.StateIn');
    const recvNow = performance.now();
    serverState = state;
    if (state.events) {
        for (const ev of state.events) {
            if (ev.type === 'poof') {
                const handled = window.gfRenderer?.details?.onBulletImpact(ev.x, ev.y, level, window.gfRenderer.rock, window.gfRenderer.flora);
                if (!handled) spawnParticles(ev.x, ev.y, 0, 0, '#ffffff', 5, 10);
            } else if (ev.type === 'turret_explosion') {
                spawnParticles(ev.x, ev.y, 0, 0, '#ffaa00', 40, 50);
                spawnParticles(ev.x, ev.y, 0, 0, '#ff0000', 20, 30);
                spawnParticles(ev.x, ev.y, 0, 0, '#ffffff', 10, 20);
                const dist = Math.hypot(ev.x - (camera.x + VIEW_W / 2), ev.y - (camera.y + VIEW_H / 2));
                if (dist < 800) { cameraShake = Math.max(cameraShake, 10 * (1 - dist / 800)); inputManager.vibrate(150, 0.4 * (1 - dist / 800), 0.4 * (1 - dist / 800)); }
                window.gfRenderer?.flora?.triggerShock(ev.x, ev.y, 160, 1.0);
                window.gfRenderer?.details?.onExplosion(ev.x, ev.y, 0, 0, level, window.gfRenderer.rock, window.gfRenderer.flora, 0.85);
            } else if (ev.type === 'large_explosion') {
                spawnLargeExplosion(ev.x, ev.y, ev.vx || 0, ev.vy || 0);
                const dist = Math.hypot(ev.x - (camera.x + VIEW_W / 2), ev.y - (camera.y + VIEW_H / 2));
                if (dist < 800) { cameraShake = Math.max(cameraShake, 18 * (1 - dist / 800)); inputManager.vibrate(300, 0.8 * (1 - dist / 800), 0.8 * (1 - dist / 800)); }
                window.gfRenderer?.flora?.triggerShock(ev.x, ev.y, 200, 1.0);
                window.gfRenderer?.details?.onExplosion(ev.x, ev.y, ev.vx || 0, ev.vy || 0, level, window.gfRenderer.rock, window.gfRenderer.flora, 1.0);
            } else if (ev.type === 'tank_debris') {
                // 0x000368B6: Tank death leaves a persistent wreckage pile on the cavern floor
                tankDebrisPiles.push({
                    x: ev.x,
                    y: ev.y,
                    seed: Math.random() * 100
                });
            } else if (ev.type === 'sound') {
                playTurretSound(ev.soundId);
                if (ev.soundId === 10) {
                    const dist = Math.hypot(ev.x - (camera.x + VIEW_W / 2), ev.y - (camera.y + VIEW_H / 2));
                    if (dist < 800) inputManager.vibrate(100, 0.5 * (1 - dist / 800), 0.2 * (1 - dist / 800));
                }
            } else if (ev.type === 'floating_text') {
                floatingTexts.push({ text: ev.text, x: ev.x, y: ev.y, color: ev.color || '#fff', life: 60, maxLife: 60 });
            }
        }
    }

    for (const id in serverState.players) {
        const s = serverState.players[id];
        const r = renderState.players[id];
        if (!r) {
            renderState.players[id] = { ...s, authX: s.x, authY: s.y, authAngle: s.angle, fuel: s.fuel ?? 76464 };
        } else {
            if (typeof s.fuel === 'number') r.fuel = s.fuel;
            else s.fuel = r.fuel;
            if (!r.isDead && s.isDead) {
                spawnLargeExplosion(s.x, s.y, s.vx, s.vy);
                const dist = Math.hypot(s.x - (camera.x + VIEW_W / 2), s.y - (camera.y + VIEW_H / 2));
                if (dist < 800) cameraShake = Math.max(cameraShake, 25 * (1 - dist / 800));
                window.gfRenderer?.flora?.triggerShock(s.x, s.y, 200, 1.0);
                window.gfRenderer?.details?.onExplosion(s.x, s.y, r.vx || s.vx || 0, r.vy || s.vy || 0, level, window.gfRenderer.rock, window.gfRenderer.flora, 1.0);
                if (id === myId) {
                    inputManager.vibrate(600, 1.0, 1.0);
                    inputManager.forceReset();
                }
            }
            const dist = Math.hypot(r.x - s.x, r.y - s.y);
            if ((r.isDead && !s.isDead) || dist > 120) {
                r.x = s.x;
                r.y = s.y;
                r.angle = s.angle;
            }
            r.authX = s.x;
            r.authY = s.y;
            r.authAngle = s.angle;
        }
    }
    lastStatePerfNow = recvNow;

    for (const id in renderState.players) {
        if (!serverState.players[id]) {
            renderState.players[id].missingFrames = (renderState.players[id].missingFrames || 0) + 1;
            if (renderState.players[id].missingFrames > 30) delete renderState.players[id];
        } else {
            renderState.players[id].missingFrames = 0;
        }
    }

    // Track flying enemies & tanks in renderState for sub-tick interpolation (for that silky feel on high freq panels)
    const seenFlying = new Set();
    for (const f of (serverState.flying || [])) {
        const key = f.id ?? f.debugId;
        seenFlying.add(key);
        const rf = renderState.flying[key];
        if (!rf || Math.hypot(rf.x - f.x, rf.y - f.y) > 96) {
            renderState.flying[key] = { ...f };
        } else {
            rf.authX = f.x; rf.authY = f.y; rf.vx = f.vx || 0; rf.vy = f.vy || 0;
            rf.angle = f.angle; rf.active = f.active;
        }
    }
    for (const k in renderState.flying) if (!seenFlying.has(Number(k)) && !seenFlying.has(k)) delete renderState.flying[k];

    const seenTanks = new Set();
    for (const tk of (serverState.tanks || [])) {
        const key = tk.id ?? tk.debugId;
        seenTanks.add(key);
        const rt = renderState.tanks[key];
        if (!rt || Math.hypot(rt.x - tk.x, rt.y - tk.y) > 96) {
            renderState.tanks[key] = { ...tk };
        } else {
            rt.authX = tk.x; rt.authY = tk.y; rt.vx = tk.vx || 0; rt.vy = tk.vy || 0;
            rt.active = tk.active;
        }
    }
    for (const k in renderState.tanks) if (!seenTanks.has(Number(k)) && !seenTanks.has(k)) delete renderState.tanks[k];
    endNetState();
});

function spawnParticles(x, y, vx, vy, color, count, lifeSpan) {
    for (let i = 0; i < count; i++) {
        const angle = Math.random() * Math.PI * 2;
        const speed = Math.random() * 4;
        particles.push({
            x, y,
            vx: vx + Math.cos(angle) * speed,
            vy: vy + Math.sin(angle) * speed,
            life: lifeSpan * (0.5 + Math.random() * 0.5),
            color,
            size: Math.random() * 2 + 1
        });
    }
}

function spawnLargeExplosion(x, y, vx, vy) {
    spawnParticles(x, y, vx, vy, '#f80', 60, 80);
    spawnParticles(x, y, vx, vy, '#f00', 40, 60);
    spawnParticles(x, y, vx, vy, '#fff', 30, 40);
}

function triggerRankOneFireworks() {
    const colors = ['#ffd700', '#00f2fe', '#ff4b2b', '#7dffaa', '#ff7eb3', '#ffffff'];
    for (let b = 0; b < 5; b++) {
        setTimeout(() => {
            const bx = VIEW_W * (0.2 + Math.random() * 0.6);
            const by = VIEW_H * (0.18 + Math.random() * 0.35);
            const baseColor = colors[b % colors.length];
            for (let i = 0; i < 52; i++) {
                const ang = (Math.PI * 2 * i) / 52 + (Math.random() - 0.5) * 0.12;
                const spd = 2.5 + Math.random() * 6.5;
                const maxLife = 70 + Math.floor(Math.random() * 40);
                fireworks.push({
                    x: bx, y: by,
                    vx: Math.cos(ang) * spd,
                    vy: Math.sin(ang) * spd - 1.2,
                    life: maxLife, maxLife,
                    color: i % 5 === 0 ? '#ffffff' : baseColor,
                    size: 1.8 + Math.random() * 1.8
                });
            }
        }, b * 320);
    }
}

function updateAndDrawFireworks(ctx, dt60 = 1.0) {
    if (fireworks.length === 0) return;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'lighter';
    for (let i = fireworks.length - 1; i >= 0; i--) {
        const fw = fireworks[i];
        fw.x += fw.vx * dt60;
        fw.y += fw.vy * dt60;
        fw.vx *= Math.pow(0.965, dt60);
        fw.vy = fw.vy * Math.pow(0.965, dt60) + 0.11 * dt60;
        fw.life -= dt60;
        if (fw.life <= 0) { fireworks.splice(i, 1); continue; }
        ctx.globalAlpha = Math.pow(fw.life / fw.maxLife, 1.4);
        ctx.fillStyle = fw.color;
        ctx.beginPath();
        ctx.arc(fw.x, fw.y, fw.size, 0, Math.PI * 2);
        ctx.fill();
    }
    ctx.restore();
}

function updateAndDrawParticles(ctx, dt60 = 1.0) {
    ctx.globalCompositeOperation = 'lighter';
    for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.x += p.vx * dt60;
        p.y += p.vy * dt60;
        p.vx *= Math.pow(0.98, dt60);
        p.vy *= Math.pow(0.98, dt60);
        p.life -= dt60;
        if (p.life <= 0) { particles.splice(i, 1); continue; }
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';
}

function lerp(start, end, amt) { return (1 - amt) * start + amt * end; }
function lerpAngle(a, b, amt) {
    let d = b - a;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    return a + d * amt;
}

function drawShip(p, isMe) {
    shipRenderer.drawShip(ctx, p, isMe, debugMode, showDebugLines, shipScale);
}

function drawTurret(t) {
    if (!t.active) return;
    const w = t.width || 28;
    const h = t.height || 28;
    ctx.save();
    ctx.translate(Math.round(t.x), Math.round(t.y));
    const tileId = t.type || 0xAF;
    if (tileId === 0xB6) ctx.rotate(Math.PI);
    else if (tileId === 0xB7) ctx.rotate(Math.PI / 2);
    else if (tileId === 0xB8) ctx.rotate(-Math.PI / 2);

    ctx.fillStyle = '#333';
    ctx.strokeStyle = '#555';
    ctx.fillRect(-15, 0, 30, 8);
    ctx.strokeRect(-15, 0, 30, 8);

    ctx.fillStyle = '#666';
    if (tileId === 0xBA || tileId === 0xB4 || tileId === 0xB5 || tileId === 0xB9) {
        ctx.fillRect(-10, -12, 4, 12); ctx.fillRect(-5, -16, 4, 16); ctx.fillRect(-2, -18, 4, 18); ctx.fillRect(1, -16, 4, 16); ctx.fillRect(6, -12, 4, 12);
        ctx.fillStyle = '#f44'; ctx.fillRect(-2, -20, 4, 2);
    } else if (tileId === 0xAF || tileId === 0xB0 || tileId === 0xAE) {
        ctx.fillRect(-8, -12, 4, 12); ctx.fillRect(-2, -16, 4, 16); ctx.fillRect(4, -12, 4, 12);
        ctx.fillStyle = '#f44'; ctx.fillRect(-2, -18, 4, 2);
    } else {
        ctx.fillRect(-4, -16, 8, 16);
        ctx.fillStyle = '#f44'; ctx.fillRect(-4, -18, 8, 2);
    }
    ctx.restore();
    if (debugMode && showDebugLines) {
        ctx.strokeStyle = 'rgba(255, 0, 255, 0.8)';
        ctx.strokeRect(Math.round(t.x - w / 2), Math.round(t.y - h / 2), w, h);
    }
}

function drawTank(t) {
    if (!t.active) return;
    const w = t.width || 32;
    const h = t.height || 24;
    ctx.save();
    ctx.translate(t.x, t.y);
    ctx.fillStyle = '#8a8a8a';
    ctx.fillRect(-w / 2, -h / 2, w, h);
    ctx.fillStyle = '#ff4b2b';
    ctx.fillRect(-w / 4, -h / 4, w / 2, h / 2);
    ctx.restore();
    if (debugMode && showDebugLines) {
        ctx.fillStyle = '#0f0';
        ctx.font = '10px monospace';
        if (t.debugId !== undefined) ctx.fillText(`ID:${t.debugId} (TANK)`, Math.round(t.x), Math.round(t.y - h / 2 - 10));
        ctx.strokeStyle = 'rgba(255, 0, 255, 0.8)';
        ctx.strokeRect(Math.round(t.x - w / 2), Math.round(t.y - h / 2), w, h);
    }
}

function drawTankDebris(d) {
    ctx.save();
    ctx.translate(Math.round(d.x), Math.round(d.y + 12));
    // Charred chassis base & twisted turret scraps (16x12 Amiga tank footprint scaled to 64x24)
    ctx.fillStyle = '#24201e';
    ctx.strokeStyle = '#4a3f39';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(-26, 12);
    ctx.lineTo(-20, -2);
    ctx.lineTo(-8, -7);
    ctx.lineTo(4, -3);
    ctx.lineTo(14, -8);
    ctx.lineTo(25, 4);
    ctx.lineTo(28, 12);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#7a3020';
    ctx.fillRect(-10, 1, 14, 6);
    ctx.fillStyle = '#3b3532';
    ctx.fillRect(6, -1, 12, 8);
    ctx.restore();
}

function drawFlyingEnemy(t) {
    if (!t.active) return;
    const w = t.width || 96;
    const h = t.height || 64;
    const rx = t.x;
    const ry = t.y;
    ctx.save();
    ctx.translate(rx, ry);
    ctx.rotate(t.angle);
    const img = assetManager.get('0x' + t.enemyType.toString(16).toUpperCase());
    if (img) {
        ctx.drawImage(img, -w / 2, -h / 2, w, h);
    } else {
        ctx.fillStyle = '#ff8800';
        ctx.beginPath(); ctx.moveTo(w / 2, 0); ctx.lineTo(-w / 2, h / 2); ctx.lineTo(-w / 2, -h / 2); ctx.closePath(); ctx.fill();
    }
    ctx.restore();
    if (debugMode && showDebugLines) {
        ctx.fillStyle = '#0f0';
        ctx.font = '10px monospace';
        if (t.debugId !== undefined) ctx.fillText(`ID:${t.debugId} (0x${t.enemyType.toString(16).toUpperCase()})`, rx, ry - h / 2 - 10);
        ctx.strokeStyle = 'rgba(255, 0, 255, 0.8)';
        ctx.strokeRect(rx - w / 2, ry - h / 2, w, h);
    }
}

function drawCargo(c) {
    ctx.save();
    ctx.translate(Math.round(c.x), Math.round(c.y));
    const size = c.weight === 2 ? 24 : 18;
    const isLarge = c.weight === 2;
    ctx.fillStyle = isLarge ? '#2c1e14' : '#1e2417';
    ctx.strokeStyle = isLarge ? '#e67e22' : '#f1c40f';
    ctx.lineWidth = 1.5;
    ctx.fillRect(-size / 2, -size / 2, size, size);
    ctx.strokeRect(-size / 2, -size / 2, size, size);
    ctx.fillStyle = isLarge ? '#f39c12' : '#f1c40f';
    ctx.font = '10px Aldrich, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(isLarge ? 'C2' : 'C1', 0, 1);
    ctx.restore();
}

function drawPowerup(p) {
    ctx.save();
    ctx.translate(Math.round(p.x), Math.round(p.y));
    let label = 'PWR';
    let color = '#3498db';
    if (p.typeId === 0xD0) { label = 'FUEL'; color = '#e67e22'; }
    else if (p.typeId === 0xD5) { label = 'PWR'; color = '#e74c3c'; }
    else if (p.typeId === 0xD6) { label = '2X'; color = '#2ecc71'; }
    else if (p.typeId === 0xD7) { label = '3X'; color = '#9b59b6'; }
    else if (p.typeId === 0xD8) { label = 'UTL'; color = '#f39c12'; }

    ctx.fillStyle = 'rgba(10, 14, 20, 0.9)';
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(0, 0, 10, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#ffffff';
    ctx.font = '9px Aldrich, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, 0, 1);
    ctx.restore();
}

// Keep global debug helper intact (ImpNote 6)
window.printEnemyPathMap = function() {
    if (!level || !level.rawMap) return;
    let out = `\n--- ENEMY PATH DEBUG MAP: ${level.name} ---\n`;
    for (let y = 0; y < level.rawMap.length; y++) {
        let rowStr = "";
        for (let x = 0; x < level.rawMap[y].length; x++) {
            const t = level.rawMap[y][x];
            if (t >= 0xE4 && t <= 0xFF) rowStr += t.toString(16).toUpperCase();
            else if (t >= 0x32 && t <= 0x3A) rowStr += "T" + (t - 0x32);
            else if (tileDictionary[t]?.solid) rowStr += "██";
            else if (t >= 0xAE && t <= 0xCB) rowStr += "~~";
            else if (t === 0x0) rowStr += "  ";
            else rowStr += "..";
        }
        if (rowStr.match(/[EFT][0-9A-F]/)) out += `${y.toString().padStart(3, '0')} | ${rowStr}\n`;
    }
    console.log(out);
};

let _gameLoopCrashed = false;
function gameLoop(timestamp = performance.now()) {
    if (_gameLoopCrashed) return;
    requestAnimationFrame(gameLoop);
    try {
        const nowPerf = performance.now();
        const rawDeltaMs = nowPerf - lastRenderPerfNow;
        // Guard against duplicate sub-millisecond RAF dispatches
        if (rawDeltaMs < 1.0) return;

        clientProfiler.beginFrame();
        clientProfiler.markHz('Engine.RenderLoop');
        inputManager.updateGamepad();

        const dtSec = Math.min(0.05, Math.max(0.001, (nowPerf - lastRenderPerfNow) * 0.001));
        lastRenderPerfNow = nowPerf;
        const dt60 = dtSec * 60.0; // 1.0 at 60Hz, 0.4167 at 144Hz
        const subTick = freecam ? 0 : Math.min(1.25, Math.max(0, (nowPerf - lastStatePerfNow) / (1000 / 60)));
        const timeSec = nowPerf * 0.001;

        let renderCamX = camera.x;
        let renderCamY = camera.y;
        if (cameraShake > 0.1) {
            renderCamX += (Math.random() - 0.5) * cameraShake;
            renderCamY += (Math.random() - 0.5) * cameraShake;
            cameraShake *= Math.pow(0.9, dt60);
        }
        if (window.gfRenderer && PERF_LAYER_TOGGLES.parallax) {
            clientProfiler.measure('Pass.Parallax', () => {
                window.gfRenderer.parallax.draw(ctx, { x: renderCamX, y: renderCamY }, timeSec);
            });
        } else {
            ctx.fillStyle = '#050505';
            ctx.fillRect(0, 0, VIEW_W, VIEW_H);
        }
        if (!level) {
            clientProfiler.endFrame();
            return;
        }

        const endInterp = clientProfiler.begin('Stage.Interpolation');
        const blendFactor = 1.0 - Math.pow(1.0 - 0.38, dt60);
        for (const id in serverState.players) {
            const s = serverState.players[id];
            const r = renderState.players[id];
            if (r) {
                // Sub-tick velocity dead-reckoning for silky 60+Hz freq. motion between 60Hz server packets
                const predX = (!s.isDead && !s.isLanded) ? (s.x + (s.vx || 0) * subTick) : s.x;
                const predY = (!s.isDead && !s.isLanded) ? (s.y + (s.vy || 0) * subTick) : s.y;
                const dist = Math.hypot(r.x - predX, r.y - predY);
                if ((r.isDead && !s.isDead) || dist > 120) {
                    r.x = predX;
                    r.y = predY;
                    r.angle = s.angle;
                } else {
                    const posBlend = id === myId ? 1.0 : blendFactor;
                    const rotBlend = id === myId ? (1.0 - Math.pow(1.0 - 0.45, dt60)) : blendFactor;
                    r.x = lerp(r.x, predX, posBlend);
                    r.y = lerp(r.y, predY, posBlend);
                    r.angle = lerpAngle(r.angle, s.angle, rotBlend);
                }
                r.isDead = s.isDead;
                r.isLanded = s.isLanded;
                r.vx = s.vx; r.vy = s.vy;
                r.inputs = s.inputs;
                r.score = s.score;
                if (typeof s.fuel === 'number') r.fuel = s.fuel;
                r.cargoStack = s.cargoStack;
                r.race = s.race;
                r.alias = s.alias;
                r.team = s.team;
                r.lives = s.lives;
                r.kills = s.kills; r.deaths = s.deaths; r.unforcedErrors = s.unforcedErrors;
                r.isBot = s.isBot; r.botState = s.botState; r.botPath = s.botPath;
            }
        }
        for (const k in renderState.flying) {
            const rf = renderState.flying[k];
            const predX = (rf.authX ?? rf.x) + (rf.vx || 0) * subTick;
            const predY = (rf.authY ?? rf.y) + (rf.vy || 0) * subTick;
            rf.x = lerp(rf.x, predX, blendFactor);
            rf.y = lerp(rf.y, predY, blendFactor);
        }
        for (const k in renderState.tanks) {
            const rt = renderState.tanks[k];
            const predX = (rt.authX ?? rt.x) + (rt.vx || 0) * subTick;
            const predY = (rt.authY ?? rt.y) + (rt.vy || 0) * subTick;
            rt.x = lerp(rt.x, predX, blendFactor);
            rt.y = lerp(rt.y, predY, blendFactor);
        }
        endInterp();

        let myServerPlayer = serverState.players[myId];
        let myPlayer = renderState.players[myId];
        if (!myPlayer) {
            if (!spectateTargetId || !renderState.players[spectateTargetId]) {
                spectateTargetId = Object.keys(renderState.players)[0];
            }
            myPlayer = renderState.players[spectateTargetId];
            myServerPlayer = serverState.players[spectateTargetId];
        }

        if (freecam) {
            const camSpeed = 15 * dt60;
            if (inputManager.state.cam.up) camera.y -= camSpeed;
            if (inputManager.state.cam.down) camera.y += camSpeed;
            if (inputManager.state.cam.left) camera.x -= camSpeed;
            if (inputManager.state.cam.right) camera.x += camSpeed;
        } else if (myPlayer && myServerPlayer) {
            clientProfiler.measure('Stage.HudUpdate', () => {
                hudManager.update(myServerPlayer, serverState, level, currentRoomRules, debugMode, metrics);
            });
            perfOverlay.update(timestamp, myServerPlayer, debugMode, metrics);

            // If cavern playfield is narrower/shorter than viewport, center it instead of pinning left/top!
            const targetX = level.width <= VIEW_W
                ? (level.width - VIEW_W) * 0.5
                : Math.max(0, Math.min(myPlayer.x - VIEW_W / 2, level.width - VIEW_W));
            const targetY = level.height <= VIEW_H
                ? (level.height - VIEW_H) * 0.5
                : Math.max(0, Math.min(myPlayer.y - VIEW_H / 2, level.height - VIEW_H));

            const camAlpha = 1.0 - Math.pow(1.0 - 0.12, dt60);
            camera.x += (targetX - camera.x) * camAlpha;
            camera.y += (targetY - camera.y) * camAlpha;
        }

        ctx.save();
        ctx.translate(-renderCamX, -renderCamY);

        if (window.gfRenderer) {
            if (PERF_LAYER_TOGGLES.recessed) {
                clientProfiler.measure('Pass.RecessedRock', () => {
                    window.gfRenderer.rock.drawRecessed(ctx, { x: renderCamX, y: renderCamY }, VIEW_W, VIEW_H, level);
                });
            }
            if (window.gfRenderer.details && PERF_LAYER_TOGGLES.water) {
                clientProfiler.measure('Pass.WaterPools', () => {
                    window.gfRenderer.details.drawWaterPools(ctx, { x: renderCamX, y: renderCamY }, VIEW_W, VIEW_H, level, renderState.players, serverState.bullets, timeSec);
                });
            }
            if (PERF_LAYER_TOGGLES.rock) {
                clientProfiler.measure('Pass.ForegroundRock', () => {
                    window.gfRenderer.rock.draw(ctx, { x: renderCamX, y: renderCamY }, VIEW_W, VIEW_H);
                });
            }
            if (PERF_LAYER_TOGGLES.prefabs) {
                clientProfiler.measure('Pass.Prefabs', () => {
                    window.gfRenderer.prefabs.draw(ctx, level, timeSec, renderState.players);
                });
            }
        }

        const endEnts = clientProfiler.begin('Pass.EntitiesAndShips');
        if (serverState.cargos) serverState.cargos.forEach(drawCargo);
        if (serverState.powerups) serverState.powerups.forEach(drawPowerup);
        if (tankDebrisPiles.length > 0) tankDebrisPiles.forEach(drawTankDebris);
        if (serverState.turrets) serverState.turrets.forEach(drawTurret);
        for (const k in renderState.tanks) drawTank(renderState.tanks[k]);
        for (const k in renderState.flying) drawFlyingEnemy(renderState.flying[k]);

        for (const id in renderState.players) {
            drawShip(renderState.players[id], id === myId);
        }
        endEnts();

        if (debugMode && showDebugLines) {
            for (const id in renderState.players) {
                const p = renderState.players[id];
                if (p.isBot && !p.isDead) {
                    ctx.save();
                    if (p.botPath && p.botPath.length > 0) {
                        ctx.strokeStyle = 'rgba(0, 255, 0, 0.6)';
                        ctx.lineWidth = 2;
                        ctx.beginPath();
                        ctx.moveTo(p.x, p.y);
                        for (const pt of p.botPath) ctx.lineTo(pt.x * 32 + 16, pt.y * 32 + 16);
                        ctx.stroke();
                    }
                    ctx.fillStyle = '#0f0';
                    if (p.botState) ctx.fillText(`[${p.botState.toUpperCase()}]`, p.x, p.y - 45);
                    ctx.restore();
                }
            }
        }

        // Debug Tile Overlay (Only rendered when showDebugLines is active to prevent 600+ fillText calls per frame!)
        if (debugMode && showDebugLines && level.rawMap) {
            ctx.font = '600 12px monospace';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            const minTx = Math.max(0, Math.floor(renderCamX / 32));
            const maxTx = Math.min(level.rawMap[0].length - 1, Math.ceil((renderCamX + VIEW_W) / 32));
            const minTy = Math.max(0, Math.floor(renderCamY / 32));
            const maxTy = Math.min(level.rawMap.length - 1, Math.ceil((renderCamY + VIEW_H) / 32));
            for (let y = minTy; y <= maxTy; y++) {
                for (let x = minTx; x <= maxTx; x++) {
                    const tile = level.rawMap[y][x];
                    if (tile !== 0 && tile > 0x1A) {
                        const tDef = tileDictionary[tile];
                        ctx.fillStyle = (tDef && tDef.known) ? 'rgba(255, 255, 255, 0.15)' : 'rgba(255, 255, 255, 0.9)';
                        ctx.fillText(tile.toString(16).toUpperCase().padStart(2, '0'), x * 32 + 16, y * 32 + 16);
                    }
                }
            }
        }

        const endParticles = clientProfiler.begin('Pass.Particles');
        for (const b of serverState.bullets) {
            const bx = b.x + (b.vx || 0) * subTick;
            const by = b.y + (b.vy || 0) * subTick;
            if (b.isPlayer) {
                ctx.fillStyle = '#ff8';
                ctx.fillRect(bx - 2, by - 2, 4, 4);
            } else {
                ctx.fillStyle = '#f44';
                ctx.beginPath();
                ctx.arc(bx, by, 2.5, 0, Math.PI * 2);
                ctx.fill();
            }
        }
        updateAndDrawParticles(ctx, dt60);
        endParticles();

        if (window.gfRenderer?.details && PERF_LAYER_TOGGLES.details) {
            clientProfiler.measure('Pass.MicroDetails', () => {
                window.gfRenderer.details.updateAndDraw(
                    ctx, { x: renderCamX, y: renderCamY }, VIEW_W, VIEW_H,
                    level, renderState.players, serverState.turrets, serverState.bullets,
                    timeSec, window.gfRenderer.rock, window.gfRenderer.flora
                );
            });
        }

        if (window.gfRenderer) {
            if (PERF_LAYER_TOGGLES.flora) {
                clientProfiler.measure('Pass.FloraCanopy', () => {
                    window.gfRenderer.flora.updateAndDraw(
                        ctx, renderState.players, timeSec, spawnParticles, level, serverState.bullets,
                        { x: renderCamX, y: renderCamY }, VIEW_W, VIEW_H
                    );
                });
            }
            if (PERF_LAYER_TOGGLES.glow) {
                clientProfiler.measure('Pass.EnvGlow', () => {
                    window.gfRenderer.prefabs.drawEnvironmentalGlow(ctx, { x: renderCamX, y: renderCamY }, VIEW_W, VIEW_H, level, timeSec, renderState.players);
                });
            }
        }

        const endOverlays = clientProfiler.begin('Pass.FloatingTextAndOverlays');
        for (let i = floatingTexts.length - 1; i >= 0; i--) {
            const ft = floatingTexts[i];
            ft.y -= 0.6 * dt60;
            ft.life -= dt60;
            if (ft.life <= 0) { floatingTexts.splice(i, 1); continue; }
            ctx.save();
            ctx.globalAlpha = Math.max(0, ft.life / ft.maxLife);
            ctx.fillStyle = ft.color;
            ctx.font = '12px Aldrich, sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText(ft.text, Math.round(ft.x), Math.round(ft.y));
            ctx.restore();
        }

        if (myServerPlayer && raceLights.length > 0) {
            const rState = myServerPlayer.race ? myServerPlayer.race.state : 0;
            const rNext = myServerPlayer.race ? myServerPlayer.race.nextCheckpoint : 1;
            if (rState < 2) {
                const targetLight = 0x3A + rNext;
                const pulse = (Math.sin(timeSec * 6.5) + 1) * 0.5;
                const lCfg = window.GF_RENDER_CONFIG?.lighting || {};
                const baseRad = lCfg.activeCheckpointGlowRadius ?? 28;
                const baseAlpha = lCfg.activeCheckpointGlowAlpha ?? 0.45;
                ctx.save();
                ctx.globalCompositeOperation = 'lighter';
                for (const l of raceLights) {
                    if (l.id === targetLight) {
                        const cx = l.x + 16;
                        const cy = l.y + 16;
                        const rad = baseRad * (0.85 + pulse * 0.30);
                        const g = ctx.createRadialGradient(cx, cy, 2, cx, cy, rad);
                        g.addColorStop(0, `rgba(0, 245, 255, ${baseAlpha * (0.7 + pulse * 0.3)})`);
                        g.addColorStop(0.6, `rgba(255, 215, 0, ${baseAlpha * 0.4 * pulse})`);
                        g.addColorStop(1, 'rgba(0, 245, 255, 0)');
                        ctx.fillStyle = g;
                        ctx.beginPath();
                        ctx.arc(cx, cy, rad, 0, Math.PI * 2);
                        ctx.fill();
                        ctx.strokeStyle = '#ffd700';
                        ctx.lineWidth = 2.0;
                        ctx.strokeRect(l.x, l.y, 32, 32);
                    }
                }
                ctx.restore();
            }
        }

        updateAndDrawFireworks(ctx, dt60);
        endOverlays();
        ctx.restore();
        clientProfiler.endFrame();
    } catch (e) {
        _gameLoopCrashed = true;
        console.error("CLIENT LOOP CRASH:", e);
    }
}

// Login & Bootstrap
const loginModal = document.getElementById('login-modal');
const loginError = document.getElementById('login-error');
const loginModeSp = document.getElementById('login-mode-sp');
const loginModeMp = document.getElementById('login-mode-mp');
const loginRoomCode = document.getElementById('login-room-code');

if (loginModeSp && loginModeMp && loginRoomCode) {
    syncSessionModeRadios(mySessionMode);
    loginModeSp.onchange = () => {
        mySessionMode = 'SP';
        localStorage.setItem('gf_session_mode', 'SP');
        loginRoomCode.style.display = 'none';
    };
    loginModeMp.onchange = () => {
        mySessionMode = 'MP';
        localStorage.setItem('gf_session_mode', 'MP');
        loginRoomCode.style.display = 'block';
    };
}

let loopStarted = false;
async function attemptLogin(alias, useSavedMode = false) {
    aliasInput.value = alias;
    const selectedMode = useSavedMode
        ? mySessionMode
        : ((loginModeMp && loginModeMp.checked) ? 'MP' : 'SP');
    const selectedCode = (selectedMode === 'MP' && loginRoomCode) ? loginRoomCode.value.trim().toUpperCase() : '';
    try {
        const res = await fetch('/api/auth', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ alias, uuid: myUuid, isBot: myIsBot })
        });
        const data = await res.json();
        if (data.success) {
            localStorage.setItem('gf_alias', alias);
            localStorage.setItem('gf_session_mode', selectedMode);
            myAlias = alias;
            mySessionMode = selectedMode;
            syncSessionModeRadios(selectedMode);
            loginModal.style.display = 'none';
            document.getElementById('loading-screen').style.display = 'none';

            const savedLvl = localStorage.getItem('gf_dev_level');
            const startLvl = savedLvl !== null ? parseInt(savedLvl, 10) : 0;
            socket.auth = {
                uuid: myUuid,
                alias: myAlias,
                isBot: myIsBot,
                mode: mySessionMode,
                roomCode: selectedCode,
                levelIndex: isNaN(startLvl) ? 0 : startLvl
            };
            socket.connect();
            if (!loopStarted) {
                loopStarted = true;
                requestAnimationFrame(gameLoop);
            }
        } else {
            loginError.textContent = data.message || 'AUTH FAILED';
            document.getElementById('loading-screen').style.display = 'none';
            loginModal.style.display = 'flex';
        }
    } catch (e) {
        loginError.textContent = 'NETWORK ERROR';
        document.getElementById('loading-screen').style.display = 'none';
        loginModal.style.display = 'flex';
    }
}

document.getElementById('btn-login-submit').onclick = () => attemptLogin(aliasInput.value, false);
document.getElementById('btn-login-random').onclick = async () => {
    try {
        const res = await fetch('/api/auth/random');
        const data = await res.json();
        aliasInput.value = data.alias;
        loginError.textContent = '';
    } catch (e) {}
};

async function bootstrapGame() {
    const loaderImg = document.getElementById('loader-img');
    if (loaderImg.complete) loaderImg.style.display = 'block';
    else loaderImg.onload = () => { loaderImg.style.display = 'block'; };

    try {
        await assetManager.loadMultiple({
            '0xE5': 'assets/enemies/e5-enemy-384x256.webp',
            '0xEB': 'assets/enemies/e5-enemy-384x256.webp'
        });
        if (myAlias) {
            await attemptLogin(myAlias, true);
        } else {
            document.getElementById('loading-screen').style.display = 'none';
            loginModal.style.display = 'flex';
        }
    } catch (err) {
        document.getElementById('loading-text').textContent = 'ASSET MOUNT FAILURE';
        console.error('Asset load error:', err);
    }
}
bootstrapGame();