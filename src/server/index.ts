import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import { getLevelData, getLevelCategory } from './levels';
import { Room } from './Room';
import { TILE_DICTIONARY } from './core/tiles';
import { ServerProfiler } from './core/profiler';
import type { PlayerStats } from './core/types';
import { getActivePhysicsHash } from './core/records';
import { evaluateMissionEnd, buildMissionLeaderboards } from './game/mission';
import { authDB } from './core/auth';
import { SERVER_CONFIG } from './core/config';
import { buildRaceLeaderboards } from './game/racing';
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
    const { alias, uuid } = req.body || {};
    res.json(authDB.validateOrClaim(alias || '', uuid || '', SERVER_CONFIG.allowNewRegistrations, SERVER_CONFIG.requireManualApproval));

});

app.get('/api/auth/random', (req, res) => {
    res.json({ alias: authDB.generateRandom() });
});

app.use(express.static('./src/client'));

const rooms = new Map<number, Room>();

let isServerPaused = false;
let nextReplayRoomId = -1;

// O(1) lookup to prevent DoS when iterating over rooms to find a player on every input
const playerRooms = new Map<string, number>();
const playerSessionStats = new Map<string, PlayerStats>();

function isValidLevelIndex(index: number): boolean {
    try {
        getLevelCategory(index);
        return true;
    } catch {
        return false;
    }
}

function getOrCreateRoom(index: number): Room {
    if (!rooms.has(index)) {
        rooms.set(index, new Room(index, getLevelData(index), io, handleTransition, SERVER_CONFIG.lethalRacingEnemies, SERVER_CONFIG.raceBumpModifier));
    }
    return rooms.get(index)!;
}

function handleTransitionToLevel(id: string, targetLevel: number, forceReset: boolean = false) {
    const socket = io.sockets.sockets.get(id);
    if (!socket) return;

    const pLevel = playerRooms.get(id) ?? 0;
    let stats = playerSessionStats.get(id) || { score: 0, fuel: 76464, doubleShotAmmo: 0, uuid: id, alias: 'UNK', shotsFired: 0, shipType: 'classic' };
    let pType: 'classic' | 'modern' = stats.shipType || 'classic';

    for (const room of rooms.values()) {
        const e = room.ecs.getPlayerEntity(id);
        if (e !== undefined) {
            const p = room.ecs.players.get(e)!;
            pType = p.type;
            stats = {
                score: p.score,
                doubleShotAmmo: 0,
                uuid: p.uuid,
                alias: p.alias,
                shipType: p.type,
                shotsFired: 0,
                fuel: 76464,
                lives: p.lives
            };
            playerSessionStats.set(id, stats);
            room.removePlayer(id);
            if (room.activeClientIds.size === 0) {
                room.tracker.finishAndSave();
                rooms.delete(room.levelIndex);
            }
            break;
        }
    }

    socket.leave(`level_${pLevel}`);

    const newRoom = getOrCreateRoom(targetLevel);
    if (forceReset && newRoom.ecs.players.size === 0) {
        newRoom.resetLevel();
    }
    socket.join(`level_${targetLevel}`);
    playerRooms.set(id, targetLevel);

    socket.emit('initLevel', newRoom.level);
    socket.emit('levelIndex', newRoom.levelIndex);
    newRoom.addPlayer(id, pType, stats);
}

function handleTransition(id: string) {
    let pLevel = playerRooms.get(id) ?? 0;
    let oldRoom = null;
    for (const room of rooms.values()) {
        if (room.ecs.getPlayerEntity(id) !== undefined) {
            oldRoom = room;
            break;
        }
    }

    if (oldRoom) {
        const e = oldRoom.ecs.getPlayerEntity(id);
        if (e !== undefined) {
            const p = oldRoom.ecs.players.get(e)!;
            const f = oldRoom.ecs.fuelTanks.get(e);
            const w = oldRoom.ecs.weaponMounts.get(e);
            const timeTaken = Math.round((oldRoom.globalWaveTimer - p.joinedAtTick) * (1000 / SERVER_CONFIG.tickRate));

            if (oldRoom.category === 'mission') {
                const boards = evaluateMissionEnd(oldRoom, id, timeTaken);
                if (boards) {
                    if (oldRoom.isReplayMode) {
                        for (const sid of oldRoom.activeClientIds) oldRoom.emitToPlayer(sid, 'show_leaderboard', boards, false);
                    } else {
                        oldRoom.emitToPlayer(p.id, 'show_leaderboard', boards, false);
                    }
                }
            } else {
                if (oldRoom.isReplayMode) {
                    const boards = buildMissionLeaderboards(oldRoom.levelIndex, oldRoom.activeClientIds.size > 1 ? 'MP' : 'SP', getActivePhysicsHash(), p.uuid, p.alias);
                    for (const sid of oldRoom.activeClientIds) oldRoom.emitToPlayer(sid, 'show_leaderboard', boards, false);
                } else {
                    const summary = [
                        { rankLabel: 'TIME', alias: 'DURATION', displayValue: timeTaken + 'ms', isMe: true, isNewPb: false },
                        { rankLabel: 'SCORE', alias: 'POINTS', displayValue: String(p.score).padStart(6, '0'), isMe: true, isNewPb: false }
                    ];
                    oldRoom.emitToPlayer(p.id, 'show_leaderboard', [{ title: 'MATCH SUMMARY', entries: summary }], false);
                }
            }

            playerSessionStats.set(id, {
                score: p.score,
                doubleShotAmmo: 0,
                uuid: p.uuid,
                alias: p.alias,
                shipType: p.type,
                shotsFired: 0,
                fuel: 76464,
                lives: p.lives
            });
            oldRoom.removePlayer(id);
            if (oldRoom.activeClientIds.size === 0) {
                oldRoom.tracker.finishAndSave();
                rooms.delete(oldRoom.levelIndex);
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
    const ip = socket.handshake.address;

    console.log(`Pilot "${alias}" connected:`, socket.id);

    // Fail-safe: If they bypassed the API, force validate on the socket connection
    const verify = authDB.validateOrClaim(alias, uuid, SERVER_CONFIG.allowNewRegistrations, SERVER_CONFIG.requireManualApproval);
    if (!verify.success) {
        if (SERVER_CONFIG.allowNewRegistrations && !SERVER_CONFIG.requireManualApproval) {
            alias = authDB.generateRandom(); // Assign a random alias if they tried to steal one
            authDB.validateOrClaim(alias, uuid, true, false);
        } else {
            socket.disconnect(); // Kick unauthorized bypass attempts
            return;
        }
    }

    const useClassicPhysics = SERVER_CONFIG.useClassicPhysics;
    const stats: PlayerStats = {
        score: 0,
        uuid: uuid,
        alias: alias,
        shipType: useClassicPhysics ? 'classic' : 'modern',
        ip: ip,
        lives: SERVER_CONFIG.defaultLives
    };
    playerSessionStats.set(socket.id, stats);

    const room = getOrCreateRoom(0);

    socket.join('level_0');
    playerRooms.set(socket.id, 0);
    socket.emit('serverConfig', SERVER_CONFIG);
    socket.emit('initTiles', TILE_DICTIONARY);
    socket.emit('initLevel', room.level);
    socket.emit('levelIndex', room.levelIndex);
    room.addPlayer(socket.id, stats.shipType || 'classic', stats);

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
                            spawnDogfightBot(room.ecs, sx, sy, botAlias, room.level);
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

            const rId = nextReplayRoomId--;
            const newRoom = new Room(replay.levelIndex, getLevelData(replay.levelIndex), io, handleTransition, SERVER_CONFIG.lethalRacingEnemies, SERVER_CONFIG.raceBumpModifier);
            newRoom.isReplayMode = true;
            (newRoom.tracker as any).isActive = false;
            newRoom.seed = replay.replayData.seed;
            newRoom.prng = createPRNG(newRoom.seed);
            newRoom.replayFrames = replay.replayData.frames;

            for (const [pid, pstat] of Object.entries(replay.playerStats)) {
                newRoom.addPlayer(pid, (pstat as any).shipType || 'classic', pstat as any);
            }
            rooms.set(rId, newRoom);

            const oldRoomIdx = playerRooms.get(socket.id);
            if (oldRoomIdx !== undefined) {
                const oldR = rooms.get(oldRoomIdx);
                if (oldR) oldR.removePlayer(socket.id);
                socket.leave(`level_${oldRoomIdx}`);
            }
            socket.join(`level_${rId}`);
            playerRooms.set(socket.id, rId);
            socket.emit('initLevel', newRoom.level);
            socket.emit('levelIndex', newRoom.levelIndex);
            newRoom.activeClientIds.add(socket.id);
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
            handleTransitionToLevel(socket.id, 0, false);
        }
    });

    socket.on('next_level', () => {
        const current = playerRooms.get(socket.id);
        if (current !== undefined) {
            let nextLvl = current + 1;
            while (!isValidLevelIndex(nextLvl) && nextLvl < 74) {
                nextLvl++;
            }
            if (nextLvl >= 74) nextLvl = 0;
            handleTransitionToLevel(socket.id, nextLvl);
        }
    });

    socket.on('input', (rawInputs) => {
        const roomIndex = playerRooms.get(socket.id);
        if (roomIndex === undefined) return;

        const room = rooms.get(roomIndex);
        if (!room) return;

        const e = room.ecs.getPlayerEntity(socket.id);
        if (e !== undefined) {
            const p = room.ecs.players.get(e)!;

            if (!p.isDead) {
                p.inputs = {
                    up: Boolean(rawInputs?.up),
                    left: Boolean(rawInputs?.left),
                    right: Boolean(rawInputs?.right),
                    shoot: Boolean(rawInputs?.shoot)
                };

                if (rawInputs?.shoot) {
                    const w = room.ecs.weaponMounts.get(e);
                    if (w) w.shootLatch = true;
                }
            }
        }
    });

    socket.on('pong', (clientTime: number) => {
        const roomIndex = playerRooms.get(socket.id);
        if (roomIndex !== undefined) {
            const room = rooms.get(roomIndex);
            if (room) {
                const e = room.ecs.getPlayerEntity(socket.id);
                if (e !== undefined) {
                    const ping = Date.now() - clientTime;
                    room.ecs.players.get(e)!.ping = ping;
                    room.tracker.logPing(socket.id, ping);
                }
            }
        }
    });

    socket.on('request_leaderboard', () => {
        const rawLevel = playerRooms.get(socket.id) ?? 0;
        const pLevel = rooms.get(rawLevel)?.levelIndex ?? 0;
        const room = rooms.get(pLevel);
        const stats = playerSessionStats.get(socket.id);
        const uuid = stats?.uuid || socket.handshake.auth?.uuid || socket.id;
        const alias = stats?.alias || socket.handshake.auth?.alias || 'UNK';
        const mode = (room && room.activeClientIds.size > 1) ? 'MP' : 'SP';
        const physicsHash = getActivePhysicsHash();

        let boards;
        if (room && room.category === 'race') {
            boards = buildRaceLeaderboards(pLevel, mode, physicsHash, uuid, alias);
        } else {
            boards = buildMissionLeaderboards(pLevel, mode, physicsHash, uuid, alias);
        }
        socket.emit('show_leaderboard', boards, true);
    });

    socket.on('disconnect', () => {
        for (const room of rooms.values()) {
            if (room.ecs.getPlayerEntity(socket.id) !== undefined) {
                room.removePlayer(socket.id);
                if (room.activeClientIds.size === 0) {
                    room.tracker.finishAndSave();
                    rooms.delete(room.levelIndex);
                }
            }
        }
        playerRooms.delete(socket.id);
        playerSessionStats.delete(socket.id);
    });
});


const profiler = new ServerProfiler(10000);

setInterval(() => {
    const now = Date.now();
    for (const id of playerRooms.keys()) {
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

server.listen(SERVER_CONFIG.port, () => console.log(`Gravity Farce is running on http://localhost:${SERVER_CONFIG.port}`));
