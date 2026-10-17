import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import { getLevelData, getLevelCategory, getLevelCount } from './levels';
import { Room } from './Room';
import { TILE_DICTIONARY } from './core/tiles';
import { ServerProfiler } from './core/profiler';
import type { PlayerStats } from './core/types';
import { getActivePhysicsHash, buildLeaderboardContext } from './core/records';
import { evaluateMissionEnd, buildMissionLeaderboards } from './game/mission';
import { authDB } from './core/auth';
import { SERVER_CONFIG } from './core/config';
import { buildRaceLeaderboards } from './game/racing';
import { buildDogfightLeaderboards } from './game/dogfight';
import { spawnDogfightBot } from './game/bot-dogfighting';
import { spawnRacingBot } from './game/bot-racing';
import { spawnMissionBot } from './game/bot-mission';
import { logRacingCrash } from './game/bot-utils';
import { logDogfightCrash } from './game/bot-utils';
import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { createPRNG } from './core/math';

const app = express();
app.use(express.json()); // Required for JSON POST parsing
const server = http.createServer(app);
const io = new Server(server);

app.post('/api/auth', (req, res) => {
    if (playerSessionStats.size >= SERVER_CONFIG.maxPlayers) {
        return res.json({ success: false, message: `SERVER AT CAPACITY (${SERVER_CONFIG.maxPlayers}/${SERVER_CONFIG.maxPlayers})` });
    }
    const { alias, uuid, isBot } = req.body || {};
    res.json(authDB.validateOrClaim(alias || '', uuid || '', SERVER_CONFIG.allowNewRegistrations, SERVER_CONFIG.requireManualApproval, Boolean(isBot)));

});

app.get('/api/auth/random', (req, res) => {
    res.json({ alias: authDB.generateRandom() });
});

app.use(express.static('./src/client'));

const rooms = new Map<number, Room>();
const roomsByCode = new Map<string, number>();

let isServerPaused = false;
let nextReplayRoomId = -1;
let nextLiveRoomId = 1;

// O(1) lookup to prevent DoS when iterating over rooms to find a player on every input
const playerRooms = new Map<string, number>();
const playerSessionStats = new Map<string, PlayerStats>();
const pendingPingTimestamps = new Map<string, number>();

function sanitizeRoomCode(code?: string): string {
    if (typeof code !== 'string') return '';
    return code.trim().toUpperCase().replace(/[^A-Z0-9]/g, '').substring(0, 4);
}

function isValidLevelIndex(index: number): boolean {
    try {
        getLevelCategory(index);
        return index < getLevelCount();
    } catch {
        return false;
    }
}

function getNextLevel(currentIndex: number, category: string): number {
    for (let i = currentIndex + 1; i < 74; i++) {
        if (isValidLevelIndex(i) && getLevelCategory(i) === category) return i;
    }
    for (let i = 0; i <= currentIndex; i++) {
        if (isValidLevelIndex(i) && getLevelCategory(i) === category) return i;
    }
    return 0;
}

function generateRoomCode(): string {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    do {
        code = '';
        for (let i = 0; i < 4; i++) {
            code += chars.charAt(Math.floor(Math.random() * chars.length));
        }
    } while (roomsByCode.has(code));
    return code;
}

function createRoomInstance(levelIndex: number, mode: 'SP' | 'MP', customCode?: string): Room {
    const rId = nextLiveRoomId++;
    const code = (customCode && !roomsByCode.has(customCode)) ? customCode : generateRoomCode();
    const room = new Room(
        rId,
        levelIndex,
        getLevelData(levelIndex),
        io,
        handleTransition,
        SERVER_CONFIG.lethalRacingEnemies,
        SERVER_CONFIG.raceBumpModifier,
        false,
        mode,
        code
    );
    rooms.set(rId, room);
    roomsByCode.set(code, rId);
    return room;
}

function resolveOrCreateTargetRoom(levelIndex: number, mode: 'SP' | 'MP', requestedCode?: string): Room {
    const cleanCode = sanitizeRoomCode(requestedCode);
    if (cleanCode && roomsByCode.has(cleanCode)) {
        const existingRId = roomsByCode.get(cleanCode)!;
        const existingRoom = rooms.get(existingRId);
        if (existingRoom && !existingRoom.isReplayMode) {
            // Joining a room by code automatically promotes it to MP if >1 player
            existingRoom.sessionMode = 'MP';
            return existingRoom;
        }
    }

    if (mode === 'MP') {
        // If no specific code was requested (or code doesn't exist yet), join an open MP room on this level or create one
        if (!cleanCode) {
            for (const room of rooms.values()) {
                if (!room.isReplayMode && room.sessionMode === 'MP' && room.levelIndex === levelIndex) {
                    return room;
                }
            }
        }
        return createRoomInstance(levelIndex, 'MP', cleanCode.length === 4 ? cleanCode : undefined);
    }

    // Default SP: 100% isolated private room instance for this pilot!
    return createRoomInstance(levelIndex, 'SP');
}

function leaveCurrentRoom(id: string): { lastActiveLevel: number; pType: 'classic' | 'modern'; stats: PlayerStats } {
    const socket = io.sockets.sockets.get(id);
    const currentRoomId = playerRooms.get(id);
    let stats = playerSessionStats.get(id) || { score: 0, uuid: id, alias: 'UNK', shipType: 'classic', lives: SERVER_CONFIG.defaultLives, sessionMode: 'SP' };
    let pType: 'classic' | 'modern' = stats.shipType || 'classic';
    let lastActiveLevel = 0;

    if (currentRoomId !== undefined) {
        const room = rooms.get(currentRoomId);
        if (room) {
            lastActiveLevel = room.levelIndex;
            if (!room.isReplayMode) {
                const e = room.ecs.getPlayerEntity(id);
                if (e !== undefined) {
                    const p = room.ecs.players.get(e)!;
                    pType = p.type;
                    stats = {
                        score: p.score,
                        uuid: p.uuid,
                        alias: p.alias,
                        isBot: p.isBotPilot,
                        shipType: p.type,
                        lives: p.lives,
                        streakScore: p.score,
                        streakStartLevel: p.streakStartLevel,
                        streakLastLevel: room.levelIndex,
                        sessionMode: stats.sessionMode || room.sessionMode,
                        roomCode: stats.roomCode
                    };
                    playerSessionStats.set(id, stats);
                }
            }
            room.removeClient(id);
            if (socket) {
                socket.leave(room.channel);
            }
            if (room.activeClientIds.size === 0) {
                room.tracker.finishAndSave();
                if (room.joinCode) roomsByCode.delete(room.joinCode);
                rooms.delete(currentRoomId);
            }
        }
        playerRooms.delete(id);
    }
    return { lastActiveLevel, pType, stats };
}

function emitRoomInfo(socket: any, room: Room) {
    socket.emit('room_info', {
        roomId: room.roomId,
        joinCode: room.joinCode,
        mode: room.sessionMode,
        levelIndex: room.levelIndex,
        category: room.category,
        playerCount: room.activeClientIds.size
    });
}

function handleTransitionToLevel(id: string, targetLevel: number, forceReset: boolean = false, overrideMode?: 'SP' | 'MP', overrideCode?: string) {
    const socket = io.sockets.sockets.get(id);
    if (!socket) return;

    const currentRoomId = playerRooms.get(id);
    const currentRoom = currentRoomId !== undefined ? rooms.get(currentRoomId) : undefined;
    if (!forceReset && !overrideMode && !overrideCode && currentRoom && currentRoom.levelIndex === targetLevel) {
        return;
    }

    const { pType, stats } = leaveCurrentRoom(id);
    const targetMode = overrideMode || stats.sessionMode || 'SP';
    stats.sessionMode = targetMode;
    if (overrideCode !== undefined) stats.roomCode = overrideCode;

    const newRoom = resolveOrCreateTargetRoom(targetLevel, targetMode, overrideCode);
    const actualLevel = newRoom.levelIndex;

    // Enforce 5-Lives Sequential Streak rules on Mission Levels (0-49):
    // Advancing sequentially (lastLevel -> lastLevel + 1) preserves accumulated score & remaining lives.
    // Jumping out of sequence, retrying, or switching categories starts a fresh 5-lives streak.
    const isSequentialMissionAdvance = !forceReset
        && actualLevel >= 0 && actualLevel <= 49
        && stats.streakLastLevel !== undefined
        && actualLevel === stats.streakLastLevel + 1
        && (stats.lives ?? 0) > 0;

    if (!isSequentialMissionAdvance) {
        stats.score = 0;
        stats.lives = SERVER_CONFIG.defaultLives;
        stats.streakStartLevel = actualLevel;
        stats.streakLastLevel = actualLevel;
    } else {
        stats.streakLastLevel = actualLevel;
        // TODO 4: Every 10 caverns survived on a 5-lives sequential mission streak awards +1 Extra Life!
        const cavernsSurvived = actualLevel - (stats.streakStartLevel ?? actualLevel);
        if (cavernsSurvived > 0 && cavernsSurvived % 10 === 0) {
            stats.lives = (stats.lives ?? SERVER_CONFIG.defaultLives) + 1;
            setTimeout(() => {
                newRoom.emitToPlayer(id, 'playfield_announce', {
                    text: `${cavernsSurvived}-CAVERN STREAK! +1 EXTRA LIFE!`,
                    color: '#ffd700'
                });
                const pe = newRoom.ecs.getPlayerEntity(id);
                const pt = pe !== undefined ? newRoom.ecs.transforms.get(pe) : undefined;
                if (pt) {
                    newRoom.ecs.events.push({ type: 'floating_text', text: '+1 EXTRA LIFE!', color: '#ffd700', x: pt.x, y: pt.y - 42 });
                }
            }, 600);
        }
    }
    playerSessionStats.set(id, stats);

    if (forceReset && newRoom.ecs.players.size === 0) {
        newRoom.resetLevel();
    }
    socket.join(newRoom.channel);
    playerRooms.set(id, newRoom.roomId);

    socket.emit('initLevel', newRoom.level);
    socket.emit('flora_burn_reset');
    socket.emit('levelIndex', newRoom.levelIndex);
    newRoom.addPlayer(id, pType, stats);
    for (const cid of newRoom.activeClientIds) {
        const s = io.sockets.sockets.get(cid);
        if (s) emitRoomInfo(s, newRoom);
    }
}

function handleTransition(actorOrSocketId: string) {
    // Locate the room containing this player/replay actor
    let oldRoom: Room | null = null;
    let rIdToRemove: number | null = null;
    for (const [rId, room] of rooms.entries()) {
        if (room.ecs.getPlayerEntity(actorOrSocketId) !== undefined) {
            oldRoom = room;
            rIdToRemove = rId;
            break;
        }
    }

    if (oldRoom) {
        const e = oldRoom.ecs.getPlayerEntity(actorOrSocketId);
        if (e !== undefined) {
            const p = oldRoom.ecs.players.get(e)!;
            const timeTaken = Math.round((oldRoom.globalWaveTimer - p.joinedAtTick) * (1000 / SERVER_CONFIG.tickRate));

            if (oldRoom.category === 'mission') {
                const boards = evaluateMissionEnd(oldRoom, actorOrSocketId, timeTaken);
                oldRoom.tracker.finishAndSave(); // Now that highscores are logged, save the replay!
                if (boards) {
                    if (oldRoom.isReplayMode) {
                        for (const sid of oldRoom.activeClientIds) oldRoom.emitToPlayer(sid, 'show_leaderboard', boards, false);
                    } else {
                        oldRoom.emitToPlayer(p.id, 'show_leaderboard', boards, false);
                    }
                }
            } else if (oldRoom.category === 'dogfight' && oldRoom.isReplayMode) {
                const boards = buildDogfightLeaderboards(oldRoom.levelIndex, oldRoom.getRoomMode(), oldRoom.getPhysicsHash(), p.uuid, p.alias, oldRoom.getBotCount(), Boolean(p.isBotPilot));
                for (const sid of oldRoom.activeClientIds) oldRoom.emitToPlayer(sid, 'show_leaderboard', boards, false);
            } else {
                if (oldRoom.isReplayMode) {
                    const boards = buildMissionLeaderboards(oldRoom.levelIndex, oldRoom.getRoomMode(), oldRoom.getPhysicsHash(), p.uuid, p.alias, undefined, undefined, undefined, oldRoom.getBotCount(), Boolean(p.isBotPilot));
                    for (const sid of oldRoom.activeClientIds) oldRoom.emitToPlayer(sid, 'show_leaderboard', boards, false);
                } else {
                    const summary = [
                        { rankLabel: 'TIME', alias: 'DURATION', displayValue: timeTaken + 'ms', isMe: true, isNewPb: false },
                        { rankLabel: 'SCORE', alias: 'POINTS', displayValue: String(p.score).padStart(6, '0'), isMe: true, isNewPb: false }
                    ];
                    oldRoom.emitToPlayer(p.id, 'show_leaderboard', [{ title: 'MATCH SUMMARY', entries: summary }], false);
                }
            }

            if (oldRoom.isReplayMode) {
                // Replay completed: remove the replay actor
                oldRoom.ecs.destroy(e);
                if (oldRoom.ecs.players.size === 0 && rIdToRemove !== null) {
                    rooms.delete(rIdToRemove);
                }
            }
        }
    }
}

// Anti-DDoS Connection Gate: Reject connections early before allocating resources
io.use((socket, next) => {
    if (playerSessionStats.size >= SERVER_CONFIG.maxPlayers) {
        return next(new Error('FULL'));
    }
    next();
});

io.on('connection', (socket) => {
    const auth = socket.handshake.auth || {};
    let alias = auth.alias || 'UNK';
    const uuid = auth.uuid || socket.id;
    const requestedBotFlag = Boolean(auth.isBot);
    const ip = socket.handshake.address;

    console.log(`Pilot "${alias}" connected:`, socket.id);

    // Fail-safe: If they bypassed the API, force validate on the socket connection
    const verify = authDB.validateOrClaim(alias, uuid, SERVER_CONFIG.allowNewRegistrations, SERVER_CONFIG.requireManualApproval, requestedBotFlag);
    if (!verify.success) {
        if (SERVER_CONFIG.allowNewRegistrations && !SERVER_CONFIG.requireManualApproval) {
            alias = authDB.generateRandom(); // Assign a random alias if they tried to steal one
            authDB.validateOrClaim(alias, uuid, true, false, requestedBotFlag);
        } else {
            socket.disconnect(); // Kick unauthorized bypass attempts
            return;
        }
    }

    const requestedLevel = typeof auth.levelIndex === 'number' ? auth.levelIndex : parseInt(auth.levelIndex, 10);
    const initialLevel = !isNaN(requestedLevel) && isValidLevelIndex(requestedLevel) ? requestedLevel : 0;
    const initialMode: 'SP' | 'MP' = auth.mode === 'MP' ? 'MP' : 'SP';
    const initialRoomCode = sanitizeRoomCode(auth.roomCode);

    const useClassicPhysics = SERVER_CONFIG.useClassicPhysics;
    const room = resolveOrCreateTargetRoom(initialLevel, initialMode, initialRoomCode);
    const stats: PlayerStats = {
        score: 0,
        uuid: uuid,
        alias: alias,
        isBot: authDB.isBotPilot(alias),
        shipType: useClassicPhysics ? 'classic' : 'modern',
        ip: ip,
        lives: SERVER_CONFIG.defaultLives,
        streakStartLevel: room.levelIndex,
        streakLastLevel: room.levelIndex,
        sessionMode: room.sessionMode,
        roomCode: room.joinCode
    };
    playerSessionStats.set(socket.id, stats);

    socket.join(room.channel);
    playerRooms.set(socket.id, room.roomId);
    socket.emit('serverConfig', SERVER_CONFIG);
    socket.emit('initTiles', TILE_DICTIONARY);
    socket.emit('initLevel', room.level);
    socket.emit('levelIndex', room.levelIndex);
    room.addPlayer(socket.id, stats.shipType || 'classic', stats);
    for (const cid of room.activeClientIds) {
        const s = io.sockets.sockets.get(cid);
        if (s) emitRoomInfo(s, room);
    }

    socket.on('debug_action', (action: string, payload) => {
        if (!SERVER_CONFIG.debugMode) {
            return;
        }

        if (action === 'pause') {
            isServerPaused = !isServerPaused;
        } else if (action === 'jump') {
            const tgt = parseInt(payload?.levelIndex, 10);
            if (!isNaN(tgt) && isValidLevelIndex(tgt)) {
                handleTransitionToLevel(socket.id, tgt, false);
            }
        } else if (action.startsWith("powerup-")) {
            const roomIndex = playerRooms.get(socket.id);

            if (roomIndex !== undefined) {
                const room = rooms.get(roomIndex);

                if (room) {
                    const e = room.ecs.getPlayerEntity(socket.id);

                    if (e !== undefined) {
                        const w = room.ecs.weaponMounts.get(e);

                        if (w) {
                            if (action.endsWith("-0xD6")) {
                                w.activeModeId = 0xD6; // Double Shot
                            } else if (action.endsWith("-0xD7")) {
                                w.activeModeId = 0xD7; // Triple Shot
                            } else if (action.endsWith("-0xD8")) {
                                w.activeModeId = 0xD8; // Rear Shot
                            }
                            w.charges = 999;

                            const t = room.ecs.transforms.get(e);
                            if (t) {
                                room.ecs.events.push({ type: 'floating_text', text: 'DEBUG: POWERUP ', color: '#f39c12', x: t.x, y: t.y - 30 });
                            }
                        }
                    }
                }
            }
        } else if (action === 'spawn_bot') {
            const roomIndex = playerRooms.get(socket.id);
            if (roomIndex !== undefined) {
                const room = rooms.get(roomIndex);
                if (room) {
                    // Find Player 2 landing pad entity in map level
                    const p2Spawn = room.level.entities.find(e =>
                        (e.type === 'spawn' || e.type === 'player_spawn' || e.type === 0xE3) &&
                        (e.props?.player === 2 || (e as any).player === 2)
                    ) || room.level.entities.find(e => e.type === 'spawn' || e.type === 0xE3 || e.type === 0xE2);

                    if (p2Spawn) {
                        // Spread multiple bots along Player 2's pad width (X axis), NEVER change Y
                        const xOffset = (Math.random() * 32 - 16);
                        const sx = p2Spawn.x + xOffset;
                        const sy = p2Spawn.y; // Exact Y position of Player 2's pad platform

                        const botAlias = `B${Math.floor(Math.random() * 100).toString().padStart(2, '0')}`;
                        if (room.category === 'race') {
                            spawnRacingBot(room.ecs, sx, sy, botAlias, room.level);
                        } else if (room.category === 'mission') {
                            spawnMissionBot(room.ecs, sx, sy, botAlias, room.level);
                        } else {
                            spawnDogfightBot(room.ecs, sx, sy, botAlias, room.level, 'E3');
                        }
                    }
                }
            }
        } else if (action === 'dump_bots') {
            const roomIndex = playerRooms.get(socket.id);
            if (roomIndex !== undefined) {
                const room = rooms.get(roomIndex);
                if (room) {
                    for (const [e, bot] of room.ecs.bots.entries()) {
                        const p = room.ecs.players.get(e);
                        if (p && !p.isDead) {
                            if (room.category === 'race') {
                                logRacingCrash(room.ecs, room, e, bot, p, room.globalWaveTimer, false);
                            } else {
                                logDogfightCrash(room.ecs, room, e, bot, p, room.globalWaveTimer, false);
                            }
                        }
                    }
                }
            }
        }
    });

    const startReplay = (replayId: string) => {
        if (typeof replayId !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(replayId)) {
            return;
        }
        try {
            const dir = path.resolve(process.cwd(), 'data/replays');
            let dataRaw;
            if (fs.existsSync(path.join(dir, `${replayId}.json`))) {
                dataRaw = fs.readFileSync(path.join(dir, `${replayId}.json`), 'utf-8');
            } else if (fs.existsSync(path.join(dir, `${replayId}.gfr`))) {
                const zipped = fs.readFileSync(path.join(dir, `${replayId}.gfr`));
                dataRaw = zlib.gunzipSync(zipped).toString('utf-8');
            } else {
                return;
            }
            const replay = JSON.parse(dataRaw);
            socket.emit('hide_leaderboard');

            // Cleanly exit the spectator's current room first (destroying it if empty)
            leaveCurrentRoom(socket.id);

            const rId = nextReplayRoomId--;
            const replayMode: 'SP' | 'MP' = replay.mode === 'MP' ? 'MP' : 'SP';
            const newRoom = new Room(
                rId,
                replay.levelIndex,
                getLevelData(replay.levelIndex),
                io,
                handleTransition,
                SERVER_CONFIG.lethalRacingEnemies,
                SERVER_CONFIG.raceBumpModifier,
                true,
                replayMode
            );
            newRoom.seed = replay.replayData.seed;
            newRoom.prng = createPRNG(newRoom.seed);

            // Namespace replay actor IDs so they can NEVER collide with live socket IDs
            const rawFrames = Array.isArray(replay.replayData.frames) ? replay.replayData.frames : [];
            newRoom.replayFrames = rawFrames.map((f: any) => {
                const mappedInputs: Record<string, number> = {};
                if (f.i) {
                    for (const [pid, mask] of Object.entries(f.i)) {
                        mappedInputs[`REPLAY_${pid}`] = mask as number;
                    }
                }
                return { t: f.t, i: mappedInputs };
            });

            const statsEntries = Object.entries(replay.playerStats || {});
            for (let idx = 0; idx < statsEntries.length; idx++) {
                const [pid, rawStat] = statsEntries[idx];
                const pstat = { ...(rawStat as any) };
                // Fallback for older dogfight replays recorded before team/homeSpawnX were saved in playerStats
                if (newRoom.category === 'dogfight' && !pstat.team) {
                    const isBotId = pid.includes('BOT_') || pid.includes('RACER_') || pid.includes('MBOT_') || Boolean(pstat.isBot);
                    pstat.team = (replayMode === 'SP') ? (isBotId ? 'E3' : 'E2') : (idx % 2 === 0 ? 'E2' : 'E3');
                }
                const joinTick = pstat.joinedAtTick ?? 0;
                if (joinTick > 0) {
                    newRoom.pendingReplayActors.push({
                        actorId: `REPLAY_${pid}`,
                        type: pstat.shipType || 'classic',
                        stats: pstat,
                        joinedAtTick: joinTick
                    });
                } else {
                    newRoom.addReplayActor(`REPLAY_${pid}`, pstat.shipType || 'classic', pstat);
                }
            }
            rooms.set(rId, newRoom);

            socket.join(newRoom.channel);
            playerRooms.set(socket.id, rId);
            socket.emit('initLevel', newRoom.level);
            socket.emit('flora_burn_reset');
            socket.emit('levelIndex', newRoom.levelIndex);
            newRoom.addSpectator(socket.id);
        } catch (e) { console.error("Replay load failed", e); }
    };

    socket.on('watch_replay', startReplay);

    socket.on('watch_latest_replay', () => {
        try {
            const dir = path.resolve(process.cwd(), 'data/replays');
            if (!fs.existsSync(dir)) return;
            const files = fs.readdirSync(dir).filter(f => f.endsWith('.json') || f.endsWith('.gfr'));
            if (files.length === 0) return;
            files.sort((a, b) => fs.statSync(path.join(dir, b)).mtimeMs - fs.statSync(path.join(dir, a)).mtimeMs);
            const latest = files[0].replace(/\.(json|gfr)$/, '');
            startReplay(latest);
        } catch (e) { console.error(e); }
    });

    socket.on('leave_replay', () => {
        const rId = playerRooms.get(socket.id);
        if (rId !== undefined && rId < 0) {
            const targetLvl = rooms.get(rId)?.levelIndex ?? 0;
            handleTransitionToLevel(socket.id, isValidLevelIndex(targetLvl) ? targetLvl : 0, true);
        }
    });

    socket.on('next_level', () => {
        const current = playerRooms.get(socket.id);
        if (current !== undefined) {
            const currentRoom = rooms.get(current);
            const curLvlIdx = currentRoom ? currentRoom.levelIndex : 0;
            const curCategory = currentRoom ? currentRoom.category : 'mission';

            if (currentRoom?.isReplayMode) {
                const nextLvl = getNextLevel(curLvlIdx, curCategory);
                handleTransitionToLevel(socket.id, nextLvl, true);
                return;
            }
            if (currentRoom && !SERVER_CONFIG.debugMode) {
                const pe = currentRoom.ecs.getPlayerEntity(socket.id);
                const p = pe !== undefined ? currentRoom.ecs.players.get(pe) : undefined;
                const canAdvanceMission = currentRoom.category === 'mission' && Boolean(p?.advancing);
                const canAdvanceRace = currentRoom.category === 'race' && p?.race?.state === 2;
                const canAdvanceDogfight = currentRoom.category === 'dogfight' && Boolean(currentRoom.dogfightCompleted);
                if (!canAdvanceMission && !canAdvanceRace && !canAdvanceDogfight) {
                    return;
                }
            }
            const nextLvl = getNextLevel(curLvlIdx, curCategory);
            handleTransitionToLevel(socket.id, nextLvl);
        }
    });

    socket.on('request_room_list', () => {
        const list = [];
        for (const r of rooms.values()) {
            if (r.isReplayMode || r.activeClientIds.size === 0) continue;
            const pilots = Array.from(r.ecs.players.values()).filter(p => !r.ecs.bots.has(r.ecs.getPlayerEntity(p.id)!)).map(p => p.alias);
            list.push({
                joinCode: r.joinCode,
                mode: r.sessionMode,
                levelIndex: r.levelIndex,
                levelName: r.level.name,
                category: r.category,
                playerCount: r.activeClientIds.size,
                botCount: r.getBotCount(),
                pilots
            });
        }
        socket.emit('room_list', list);
    });

    socket.on('switch_session_mode', (payload: { mode?: 'SP' | 'MP'; roomCode?: string; levelIndex?: number }) => {
        const curRId = playerRooms.get(socket.id);
        const curRoom = curRId !== undefined ? rooms.get(curRId) : undefined;
        const baseLevel = (typeof payload?.levelIndex === 'number' && isValidLevelIndex(payload.levelIndex))
            ? payload.levelIndex
            : (curRoom?.levelIndex ?? 0);
        const mode: 'SP' | 'MP' = payload?.mode === 'MP' ? 'MP' : 'SP';
        const code = sanitizeRoomCode(payload?.roomCode);
        socket.emit('hide_leaderboard');
        socket.emit('hide_game_over');
        handleTransitionToLevel(socket.id, baseLevel, true, mode, code);
    });

    socket.on('input', (rawInputs) => {
        const roomIndex = playerRooms.get(socket.id);
        if (roomIndex === undefined) return;

        const room = rooms.get(roomIndex);
        if (!room || room.isReplayMode) return;

        const e = room.ecs.getPlayerEntity(socket.id);
        if (e !== undefined) {
            const p = room.ecs.players.get(e)!;

            if (!p.isDead) {
                const prevShootInput = p.inputs.shoot;

                let aX = undefined;
                let aUp = undefined;
                if (SERVER_CONFIG.allowAnalogControl) {
                    if (Number.isFinite(rawInputs?.analogX)) aX = Math.max(-1, Math.min(1, rawInputs.analogX));
                    if (Number.isFinite(rawInputs?.analogUp)) aUp = Math.max(0, Math.min(1, rawInputs.analogUp));
                }

                p.inputs = {
                    up: Boolean(rawInputs?.up),
                    left: Boolean(rawInputs?.left),
                    right: Boolean(rawInputs?.right),
                    shoot: Boolean(rawInputs?.shoot),
                    analogX: aX,
                    analogUp: aUp
                };

                // 0x00031AF6 Debounce Lock: Latch a shot only on rising edge or explicit client tap edge
                if (rawInputs?.shootEdge || (rawInputs?.shoot && !prevShootInput)) {
                    const w = room.ecs.weaponMounts.get(e);
                    if (w) w.shootLatch = true;
                }
            }
        }
    });

    socket.on('pong', () => {
        const sentAt = pendingPingTimestamps.get(socket.id);
        if (sentAt === undefined) return;
        pendingPingTimestamps.delete(socket.id);

        const roomIndex = playerRooms.get(socket.id);
        if (roomIndex !== undefined) {
            const room = rooms.get(roomIndex);
            if (room) {
                const e = room.ecs.getPlayerEntity(socket.id);
                if (e !== undefined) {
                    const ping = Math.max(0, Math.min(9999, Date.now() - sentAt));
                    room.ecs.players.get(e)!.ping = ping;
                    room.tracker.logPing(socket.id, ping);
                }
            }
        }
    });

    socket.on('request_leaderboard', () => {
        const rawLevel = playerRooms.get(socket.id) ?? 0;
        const room = rooms.get(rawLevel);
        const pLevel = room?.levelIndex ?? 0;
        const stats = playerSessionStats.get(socket.id);
        const uuid = stats?.uuid || socket.handshake.auth?.uuid || socket.id;
        const alias = stats?.alias || socket.handshake.auth?.alias || 'UNK';
        const isBotPilot = Boolean(stats?.isBot || authDB.isBotPilot(alias));
        const mode = room ? room.getRoomMode() : 'SP';
        const botCount = room ? room.getBotCount() : 0;
        const physicsHash = room ? room.getPhysicsHash() : getActivePhysicsHash(0);

        let boards;
        if (room && room.category === 'race') {
            boards = buildRaceLeaderboards(pLevel, mode, physicsHash, uuid, alias, botCount, isBotPilot);
        } else if (room && room.category === 'dogfight') {
            boards = buildDogfightLeaderboards(pLevel, mode, physicsHash, uuid, alias, botCount, isBotPilot);
        } else {
            // Arcade / missions
            boards = buildMissionLeaderboards(pLevel, mode, physicsHash, uuid, alias, undefined, undefined, undefined, botCount, isBotPilot);
        }
        socket.emit('show_leaderboard', boards, true);
    });

    socket.on('retry_level', () => {
        const current = playerRooms.get(socket.id);
        if (current !== undefined && current >= 0) {
            const curRoom = rooms.get(current);
            const targetLvl = curRoom ? curRoom.levelIndex : 0;
            const stats = playerSessionStats.get(socket.id);
            if (stats) {
                stats.lives = SERVER_CONFIG.defaultLives;
                stats.score = 0;
            }
            socket.emit('hide_game_over');
            socket.emit('hide_leaderboard');
            if (curRoom && (curRoom.category === 'dogfight' || curRoom.category === 'race')) {
                curRoom.resetLevel(true);
                for (const cid of curRoom.activeClientIds) {
                    const cStats = playerSessionStats.get(cid);
                    if (cStats) {
                        cStats.lives = SERVER_CONFIG.defaultLives;
                        cStats.score = 0;
                    }
                    const pe = curRoom.ecs.getPlayerEntity(cid);
                    const oldP = pe !== undefined ? curRoom.ecs.players.get(pe) : undefined;
                    curRoom.trySpawnPlayer(cid, oldP?.type || cStats?.shipType || 'classic', {
                        score: 0,
                        race: undefined,
                        uuid: oldP?.uuid ?? cStats?.uuid ?? cid,
                        alias: oldP?.alias ?? cStats?.alias ?? 'UNK',
                        isBot: oldP?.isBotPilot ?? cStats?.isBot,
                        lives: SERVER_CONFIG.defaultLives,
                        joinedAtTick: 0,
                        shotsFired: 0,
                        fuelConsumed: 0,
                        streakStartLevel: curRoom.levelIndex,
                        streakLastLevel: curRoom.levelIndex,
                        homeSpawnX: oldP?.homeSpawnX,
                        homeSpawnY: oldP?.homeSpawnY,
                        team: oldP?.team
                    });
                    curRoom.emitToPlayer(cid, 'hide_game_over', {});
                    curRoom.emitToPlayer(cid, 'hide_leaderboard', {});
                }
                return;
            }
            handleTransitionToLevel(socket.id, targetLvl, true);
        }
    });

    socket.on('disconnect', () => {
        const disconnectedAlias = playerSessionStats.get(socket.id)?.alias || alias || 'UNK';
        console.log(`Pilot "${disconnectedAlias}" disconnected:`, socket.id);
        const prevRId = playerRooms.get(socket.id);
        leaveCurrentRoom(socket.id);
        if (prevRId !== undefined && rooms.has(prevRId)) {
            const remRoom = rooms.get(prevRId)!;
            for (const cid of remRoom.activeClientIds) {
                const s = io.sockets.sockets.get(cid);
                if (s) emitRoomInfo(s, remRoom);
            }
        }
        playerSessionStats.delete(socket.id);
        pendingPingTimestamps.delete(socket.id);
    });
});


const profiler = new ServerProfiler(10000);

setInterval(() => {
    const now = Date.now();
    for (const id of playerRooms.keys()) {
        pendingPingTimestamps.set(id, now);
        io.to(id).emit('ping', now);
    }
}, 500);

setInterval(() => {
    profiler.begin();

    if (isServerPaused) {
        for (let room of rooms.values()) {
            room.tick(true);
        }
    } else {
        for (let room of rooms.values()) {
            room.tick(false);
        }
    }

    profiler.end();
}, 1000 / SERVER_CONFIG.tickRate);

server.listen(SERVER_CONFIG.port, () => console.log(`Gravity-Farce is running on http://localhost:${SERVER_CONFIG.port}`));
