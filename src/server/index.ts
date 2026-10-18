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
import { GameTracker } from './core/tracker';
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
// Authoritative per-UUID last level memory so immediate browser reloads after jumping NEVER revert (TODO 6)
const lastLevelByUuid = new Map<string, number>();
// Map of leader socketId -> Set of follower spectator socketIds (TODO 2.4 Spectate Pilot)
const pilotFollowers = new Map<string, Set<string>>();

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
    room.onSpectatorRoomExpired = (expiredRoomId: number) => {
        const expRoom = rooms.get(expiredRoomId);
        if (!expRoom) return;
        for (const sid of Array.from(expRoom.activeClientIds)) {
            if (expRoom.ecs.getPlayerEntity(sid) === undefined) {
                const st = playerSessionStats.get(sid);
                if (st) st.followingPilotId = undefined;
                handleTransitionToLevel(sid, expRoom.levelIndex, true, 'SP', '');
            }
        }
    };
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
            // If joining an SP room, only allow joining as a spectator (if both server & player allow it)
            if (existingRoom.sessionMode === 'SP') {
                if (SERVER_CONFIG.allowSpSpectating && existingRoom.allowSpectators) {
                    return { room: existingRoom, asSpectator: true };
                }
                return { room: createRoomInstance(levelIndex, 'SP'), asSpectator: false };
            }
            return { room: existingRoom, asSpectator: false };
        }
    }

    if (mode === 'MP') {
        // If no specific code was requested (or code doesn't exist yet), join an open MP room on this level or create one
        if (!cleanCode) {
            for (const room of rooms.values()) {
                if (!room.isReplayMode && room.sessionMode === 'MP' && room.levelIndex === levelIndex) {
                    return { room, asSpectator: false };
                }
            }
        }
        return { room: createRoomInstance(levelIndex, 'MP', cleanCode.length === 4 ? cleanCode : undefined), asSpectator: false };
    }

    // Default SP: 100% isolated private room instance for this pilot!
    return { room: createRoomInstance(levelIndex, 'SP'), asSpectator: false };
}

const loadReplayObject = (replayId: string): any | null => {
    if (typeof replayId !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(replayId)) return null;
    const dir = path.resolve(process.cwd(), 'data/replays');
    let dataRaw: string | undefined;
    if (fs.existsSync(path.join(dir, `${replayId}.json`))) {
        dataRaw = fs.readFileSync(path.join(dir, `${replayId}.json`), 'utf-8');
    } else if (fs.existsSync(path.join(dir, `${replayId}.gfr`))) {
        const zipped = fs.readFileSync(path.join(dir, `${replayId}.gfr`));
        dataRaw = zlib.gunzipSync(zipped).toString('utf-8');
    } else {
        return null;
    }
    return JSON.parse(dataRaw);
};

function startReplayForSocket(targetSocketId: string, replayId: string, explicitQueue?: string[], fullStreak: boolean = false) {
    const targetSocket = io.sockets.sockets.get(targetSocketId);
    if (!targetSocket) return;
    try {
        let replay = loadReplayObject(replayId);
        if (!replay) return;

        // TODO 10: Enforce replay viewing authorization on server!
        // Players may replay their own runs for 1 hour; otherwise only debugMode/admins can watch replays.
        const viewerStats = playerSessionStats.get(targetSocketId);
        const viewerUuid = viewerStats?.uuid || targetSocket.handshake.auth?.uuid;
        const isOwnReplay = Object.values(replay.playerStats || {}).some((ps: any) => ps.uuid === viewerUuid);
        const ageMs = Date.now() - (replay.endedAt || replay.startedAt || 0);
        if (!SERVER_CONFIG.debugMode && !(isOwnReplay && ageMs <= 3600 * 1000)) {
            targetSocket.emit('playfield_announce', { text: 'REPLAY RESTRICTED (OWN RUNS < 1H ONLY)', color: '#ef4444' });
            return;
        }

        // TODO 13: If this replay is the final/latest segment of a multi-cavern 5-Lives Streak,
        // start from segment 0 and queue the remaining segments!
        let queue = explicitQueue;
        if (fullStreak && !queue && Array.isArray(replay.streakSegments) && replay.streakSegments.length > 1) {
            const allSegs = [...replay.streakSegments];
            const firstSegId = allSegs.shift()!;
            const firstReplay = loadReplayObject(firstSegId);
            if (firstReplay) {
                replay = firstReplay;
                queue = allSegs;
                targetSocket.emit('playfield_announce', {
                    text: `MULTI-CAVERN STREAK REPLAY (${replay.streakSegments.length} CAVERNS) — STARTING FROM CAVERN ${String(replay.levelIndex).padStart(2, '0')}`,
                    color: '#ffd700'
                });
            }
        }

        targetSocket.emit('hide_leaderboard');

        // Cleanly exit the spectator's current room first (destroying it if empty)
        leaveCurrentRoom(targetSocketId);

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
            replayMode,
            '',
            replay.replayData.seed
        );
        if (queue && queue.length > 0) {
            newRoom.replayQueue = queue;
        }

        // Namespace replay actor IDs so they can NEVER collide with live socket IDs
        // TODO 9: Fast-forward idle pad delay! Find the first tick where any player presses a key
        // and start playback right before the first keypress!
        const rawFrames = Array.isArray(replay.replayData.frames) ? replay.replayData.frames : [];
        let firstActiveTick = 0;
        for (const f of rawFrames) {
            if (f.i && Object.values(f.i).some((m: any) => (m & 0xFFFF1F) !== 0)) {
                firstActiveTick = Math.max(0, (f.t || 0) - 10); // Keep a 10-tick (160ms) lead-in before liftoff
                break;
            }
        }

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

        // Deterministically simulate ticks 0..firstActiveTick so PRNG, tank movement, and flying enemies
        // are 100% bit-for-bit identical to the live game when playback begins!
        if (firstActiveTick > 0) {
            newRoom.activeClientIds.add('__REPLAY_FF__');
            for (let ff = 0; ff < firstActiveTick; ff++) {
                newRoom.tick(false);
            }
            newRoom.activeClientIds.delete('__REPLAY_FF__');
        }

        targetSocket.join(newRoom.channel);
        playerRooms.set(targetSocketId, rId);
        targetSocket.emit('initLevel', newRoom.level);
        targetSocket.emit('flora_burn_reset');
        targetSocket.emit('levelIndex', newRoom.levelIndex);
        newRoom.addSpectator(targetSocketId);
        emitRoomInfo(targetSocket, newRoom);
    } catch (e) { console.error("Replay load failed", e); }
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
                        streakReplays: stats.streakReplays,
                        sessionMode: stats.sessionMode || room.sessionMode,
                        roomCode: stats.roomCode,
                        allowSpectators: stats.allowSpectators,
                        followingPilotId: stats.followingPilotId
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
    const isSpectating = room.isReplayMode || room.ecs.getPlayerEntity(socket.id) === undefined;
    const st = playerSessionStats.get(socket.id);
    socket.emit('room_info', {
        roomId: room.roomId,
        joinCode: room.joinCode,
        mode: room.sessionMode,
        levelIndex: room.levelIndex,
        category: room.category,
        playerCount: room.activeClientIds.size,
        allowSpectators: room.allowSpectators,
        isSpectating,
        isReplay: room.isReplayMode,
        followingPilotId: st?.followingPilotId
    });
}

function handleTransitionToLevel(id: string, targetLevel: number, forceReset: boolean = false, overrideMode?: 'SP' | 'MP', overrideCode?: string) {
    const socket = io.sockets.sockets.get(id);
    if (!socket) return;

    const currentRoomId = playerRooms.get(id);
    const currentRoom = currentRoomId !== undefined ? rooms.get(currentRoomId) : undefined;
    const prevPlayerEnt = (currentRoom && !currentRoom.isReplayMode) ? currentRoom.ecs.getPlayerEntity(id) : undefined;
    const wasAdvancing = prevPlayerEnt !== undefined ? Boolean(currentRoom?.ecs.players.get(prevPlayerEnt)?.advancing) : false;

    if (!forceReset && !overrideMode && !overrideCode && currentRoom && !currentRoom.isReplayMode && currentRoom.ecs.getPlayerEntity(id) !== undefined && currentRoom.levelIndex === targetLevel) {
        return;
    }

    const { pType, stats } = leaveCurrentRoom(id);
    const targetMode = overrideMode || stats.sessionMode || 'SP';
    stats.sessionMode = targetMode;
    if (overrideCode !== undefined) stats.roomCode = overrideCode;

    const { room: newRoom, asSpectator } = resolveOrCreateTargetRoom(targetLevel, targetMode, overrideCode);
    if (!asSpectator && newRoom.sessionMode === 'SP') {
        newRoom.allowSpectators = stats.allowSpectators !== false;
    }
    const actualLevel = newRoom.levelIndex;
    if (stats.uuid) {
        lastLevelByUuid.set(stats.uuid, actualLevel);
    }

    if (asSpectator) {
        playerSessionStats.set(id, stats);
        socket.join(newRoom.channel);
        playerRooms.set(id, newRoom.roomId);
        socket.emit('initLevel', newRoom.level);
        socket.emit('flora_burn_reset');
        socket.emit('levelIndex', newRoom.levelIndex);
        newRoom.addSpectator(id);
        emitRoomInfo(socket, newRoom);
        return;
    }

    // Clear any pilot-follow subscription when spawning as an active pilot
    stats.followingPilotId = undefined;

    // Enforce 5-Lives Sequential Streak rules on Mission Levels (0-49):
    // Advancing sequentially via legitimate cavern completion (wasAdvancing && lastLevel -> lastLevel + 1)
    // preserves accumulated score & remaining lives. Jumping, reloading, or retrying resets the streak!
    const isSequentialMissionAdvance = !forceReset
        && wasAdvancing
        && actualLevel >= 0 && actualLevel <= 49
        && stats.streakLastLevel !== undefined
        && actualLevel === stats.streakLastLevel + 1
        && (stats.lives ?? 0) > 0;

    if (!isSequentialMissionAdvance) {
        if (stats.streakReplays && stats.streakReplays.length > 0) {
            stats.streakReplays = [];
        }
        stats.score = 0;
        stats.lives = SERVER_CONFIG.defaultLives;
        stats.streakStartLevel = actualLevel;
        stats.streakLastLevel = actualLevel;
        stats.streakReplays = [];
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

    if (forceReset && newRoom.ecs.players.size === 0 && newRoom.globalWaveTimer > 0) {
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

    // TODO 2.4: Bring along any spectators who are actively following this pilot's UUID across rooms/reloads!
    const followers = stats.uuid ? pilotFollowers.get(stats.uuid) : undefined;
    if (followers && followers.size > 0 && (newRoom.sessionMode === 'MP' || (SERVER_CONFIG.allowSpSpectating && newRoom.allowSpectators))) {
        for (const followerId of Array.from(followers)) {
            const fSock = io.sockets.sockets.get(followerId);
            if (!fSock || followerId === id) {
                followers.delete(followerId);
                continue;
            }
            handleTransitionToLevel(followerId, actualLevel, false, newRoom.sessionMode, newRoom.joinCode);
            fSock.emit('playfield_announce', { text: `FOLLOWING ${stats.alias} TO ${newRoom.level.name}`, color: '#00f2fe' });
        }
    }
}

function handleTransition(actorOrSocketId: string, sourceRoomId?: number) {
    // Locate the exact room that triggered this transition (fixes TODO 12 race condition!)
    let oldRoom: Room | null = null;
    let rIdToRemove: number | null = null;
    if (sourceRoomId !== undefined && rooms.has(sourceRoomId)) {
        oldRoom = rooms.get(sourceRoomId)!;
        rIdToRemove = sourceRoomId;
    } else {
        for (const [rId, room] of rooms.entries()) {
            if (room.ecs.getPlayerEntity(actorOrSocketId) !== undefined) {
                oldRoom = room;
                rIdToRemove = rId;
                break;
            }
        }
    }

    if (oldRoom) {
        const e = oldRoom.ecs.getPlayerEntity(actorOrSocketId);
        if (e !== undefined) {
            const p = oldRoom.ecs.players.get(e)!;
            const timeTaken = Math.round((oldRoom.globalWaveTimer - p.joinedAtTick) * (1000 / SERVER_CONFIG.tickRate));

            if (oldRoom.category === 'mission') {
                const st = playerSessionStats.get(actorOrSocketId);
                if (st && !oldRoom.isReplayMode) {
                    if (!st.streakReplays) st.streakReplays = [];
                    if (!st.streakReplays.includes(oldRoom.tracker.uuid)) {
                        st.streakReplays.push(oldRoom.tracker.uuid);
                    }
                }
                const boards = evaluateMissionEnd(oldRoom, actorOrSocketId, timeTaken, st?.streakReplays);
                oldRoom.tracker.finishAndSave(); // Now that highscores are logged, save the replay!
                if (boards) {
                    if (oldRoom.isReplayMode) {
                        // TODO 13: If this replay has remaining multi-cavern streak segments, advance to the next segment automatically!
                        if (oldRoom.replayQueue && oldRoom.replayQueue.length > 0) {
                            const nextSegId = oldRoom.replayQueue.shift()!;
                            const remainQueue = [...oldRoom.replayQueue];
                            for (const sid of Array.from(oldRoom.activeClientIds)) {
                                startReplayForSocket(sid, nextSegId, remainQueue);
                            }
                            return;
                        }
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
    const rememberedLevel = lastLevelByUuid.get(uuid);
    const candidateLevel = !isNaN(requestedLevel) && isValidLevelIndex(requestedLevel) ? requestedLevel : (rememberedLevel ?? 0);
    const initialLevel = isValidLevelIndex(candidateLevel) ? candidateLevel : 0;
    lastLevelByUuid.set(uuid, initialLevel);
    const initialMode: 'SP' | 'MP' = auth.mode === 'MP' ? 'MP' : 'SP';
    const initialRoomCode = sanitizeRoomCode(auth.roomCode);
    const allowSpectatorsPref = auth.allowSpectators !== false;

    const useClassicPhysics = SERVER_CONFIG.useClassicPhysics;
    const { room, asSpectator } = resolveOrCreateTargetRoom(initialLevel, initialMode, initialRoomCode);
    if (!asSpectator && room.sessionMode === 'SP') {
        room.allowSpectators = allowSpectatorsPref;
    }
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
        roomCode: room.joinCode,
        allowSpectators: allowSpectatorsPref
    };
    playerSessionStats.set(socket.id, stats);

    socket.join(room.channel);
    playerRooms.set(socket.id, room.roomId);
    socket.emit('serverConfig', SERVER_CONFIG);
    socket.emit('initTiles', TILE_DICTIONARY);
    socket.emit('initLevel', room.level);
    socket.emit('levelIndex', room.levelIndex);
    if (asSpectator) {
        room.addSpectator(socket.id);
    } else {
        room.addPlayer(socket.id, stats.shipType || 'classic', stats);
    }
    for (const cid of room.activeClientIds) {
        const s = io.sockets.sockets.get(cid);
        if (s) emitRoomInfo(s, room);
    }

    // TODO 2.4: If any spectators are following this pilot's persistent UUID across reloads/reconnections, pull them into the new room!
    if (!asSpectator && stats.uuid) {
        const followers = pilotFollowers.get(stats.uuid);
        if (followers && followers.size > 0 && (room.sessionMode === 'MP' || (SERVER_CONFIG.allowSpSpectating && room.allowSpectators))) {
            for (const followerId of Array.from(followers)) {
                const fSock = io.sockets.sockets.get(followerId);
                if (!fSock || followerId === socket.id) continue;
                handleTransitionToLevel(followerId, room.levelIndex, false, room.sessionMode, room.joinCode);
                fSock.emit('playfield_announce', { text: `FOLLOWING ${stats.alias} TO ${room.level.name}`, color: '#00f2fe' });
            }
        }
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
                const st = playerSessionStats.get(socket.id);
                if (st?.uuid) lastLevelByUuid.set(st.uuid, tgt);
                handleTransitionToLevel(socket.id, tgt, true);
            }
        } else if (action === 'add_life') {
            const roomIndex = playerRooms.get(socket.id);
            if (roomIndex !== undefined) {
                const room = rooms.get(roomIndex);
                const e = room?.ecs.getPlayerEntity(socket.id);
                if (room && e !== undefined) {
                    const p = room.ecs.players.get(e)!;
                    p.lives = Math.min(99, (p.lives || 0) + 1);
                    const t = room.ecs.transforms.get(e);
                    if (t) {
                        room.ecs.events.push({ type: 'floating_text', text: 'DEBUG: +1 LIFE', color: '#2ecc71', x: t.x, y: t.y - 30 });
                    }
                }
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

    const startReplay = (replayId: string, explicitQueue?: string[], fullStreak: boolean = false) => {
        startReplayForSocket(socket.id, replayId, explicitQueue, fullStreak);
    };

    socket.on('watch_replay', (payload: string | { replayId: string; fullStreak?: boolean }) => {
        const replayId = typeof payload === 'object' ? payload?.replayId : payload;
        const fullStreak = typeof payload === 'object' ? Boolean(payload?.fullStreak) : false;
        startReplay(replayId, undefined, fullStreak);
    });

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
        if (rId !== undefined) {
            const curRoom = rooms.get(rId);
            const isSpectatingLive = curRoom && !curRoom.isReplayMode && curRoom.ecs.getPlayerEntity(socket.id) === undefined;
            if (rId < 0 || isSpectatingLive) {
                const st = playerSessionStats.get(socket.id);
                if (st?.followingPilotId) {
                    pilotFollowers.get(st.followingPilotId)?.delete(socket.id);
                    st.followingPilotId = undefined;
                }
                const targetLvl = curRoom?.levelIndex ?? (st?.uuid ? lastLevelByUuid.get(st.uuid) : 0) ?? 0;
                handleTransitionToLevel(socket.id, isValidLevelIndex(targetLvl) ? targetLvl : 0, true, 'SP', '');
            }
        }
    });

    // TODO 2.4: Spectate a specific pilot and automatically follow them when they switch caverns/rooms!
socket.on('spectate_pilot', (targetPilotId: string) => {
         if (!SERVER_CONFIG.allowPilotFollowing || !targetPilotId) return;
        let targetUuid: string | undefined;
        let targetRoom: Room | undefined;

        const targetRId = playerRooms.get(targetPilotId);
        if (targetRId !== undefined) {
            targetRoom = rooms.get(targetRId);
            const ent = targetRoom?.ecs.getPlayerEntity(targetPilotId);
            const p = ent !== undefined ? targetRoom?.ecs.players.get(ent) : undefined;
            targetUuid = p?.uuid || playerSessionStats.get(targetPilotId)?.uuid;
        } else {
            targetUuid = targetPilotId;
            for (const r of rooms.values()) {
                for (const [e, p] of r.ecs.players.entries()) {
                    if (p.uuid === targetUuid && !r.isReplayMode) {
                        targetRoom = r;
                        break;
                    }
                }
                if (targetRoom) break;
            }
        }

        if (!targetUuid || !targetRoom || targetRoom.isReplayMode) return;
        if (targetRoom.sessionMode === 'SP' && (!SERVER_CONFIG.allowSpSpectating || !targetRoom.allowSpectators)) return;
 
        const st = playerSessionStats.get(socket.id);
        if (st) {
            if (st.followingPilotId) {
                pilotFollowers.get(st.followingPilotId)?.delete(socket.id);
            }
            st.followingPilotId = targetUuid;
            if (!pilotFollowers.has(targetUuid)) {
                pilotFollowers.set(targetUuid, new Set());
            }
            pilotFollowers.get(targetUuid)!.add(socket.id);
        }
        socket.emit('hide_leaderboard');
        socket.emit('hide_game_over');
        handleTransitionToLevel(socket.id, targetRoom.levelIndex, false, targetRoom.sessionMode, targetRoom.joinCode);
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
            if (r.sessionMode === 'SP' && (!SERVER_CONFIG.allowSpSpectating || !r.allowSpectators)) continue;
            const pilotObjs = Array.from(r.ecs.players.values())
                .filter(p => !r.ecs.bots.has(r.ecs.getPlayerEntity(p.id)!))
                .map(p => ({ id: p.id, alias: p.alias }));
            const pilots = pilotObjs.map(p => p.alias);
            list.push({
                joinCode: r.joinCode,
                mode: r.sessionMode,
                spectateOnly: r.sessionMode === 'SP',
                levelIndex: r.levelIndex,
                levelName: r.level.name,
                category: r.category,
                playerCount: r.activeClientIds.size,
                botCount: r.getBotCount(),
                pilots,
                pilotObjs
            });
        }
        socket.emit('room_list', list);
    });

    socket.on('set_allow_spectators', (allow: boolean) => {
        const stats = playerSessionStats.get(socket.id);
        if (stats) stats.allowSpectators = Boolean(allow);
        const rId = playerRooms.get(socket.id);
        const room = rId !== undefined ? rooms.get(rId) : undefined;
        if (room && room.sessionMode === 'SP' && room.ecs.getPlayerEntity(socket.id) !== undefined) {
            room.allowSpectators = Boolean(allow);
            emitRoomInfo(socket, room);
        }
    });

    socket.on('switch_session_mode', (payload: { mode?: 'SP' | 'MP'; roomCode?: string; levelIndex?: number; allowSpectators?: boolean }) => {
        const curRId = playerRooms.get(socket.id);
        const curRoom = curRId !== undefined ? rooms.get(curRId) : undefined;
        const baseLevel = (typeof payload?.levelIndex === 'number' && isValidLevelIndex(payload.levelIndex))
            ? payload.levelIndex
            : (curRoom?.levelIndex ?? 0);
        const mode: 'SP' | 'MP' = payload?.mode === 'MP' ? 'MP' : 'SP';
        const code = sanitizeRoomCode(payload?.roomCode);
        const stats = playerSessionStats.get(socket.id);
        if (stats && typeof payload?.allowSpectators === 'boolean') {
            stats.allowSpectators = payload.allowSpectators;
        }
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
        const st = playerSessionStats.get(socket.id);
        if (st?.followingPilotId) {
            pilotFollowers.get(st.followingPilotId)?.delete(socket.id);
        }
        pilotFollowers.delete(socket.id);
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
}, 2000);

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
