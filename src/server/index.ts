import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import { getLevelData } from './levels';
import { Room } from './Room';
import { TILE_DICTIONARY } from './core/tiles';
import { ServerProfiler } from './core/profiler';
import type { PlayerStats } from './core/types';
import { getActivePhysicsHash } from './core/records';
import { evaluateMissionEnd, buildMissionLeaderboards } from './game/mission';
import { authDB } from './core/auth';
import { SERVER_CONFIG } from './core/config';

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

// O(1) lookup to prevent DoS when iterating over rooms to find a player on every input
const playerRooms = new Map<string, number>();
const playerSessionStats = new Map<string, PlayerStats>();

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
	let pType: 'classic'|'modern' = stats.shipType || 'classic';

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
                    fuel: 76464
            };
            playerSessionStats.set(id, stats);
            room.removePlayer(id);
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
            const timeTaken = Date.now() - p.joinedAt;
            
            if (oldRoom.category === 'mission') {
                const boards = evaluateMissionEnd(oldRoom, id, timeTaken);
                if (boards) oldRoom.emitToPlayer(p.id, 'show_leaderboard', boards, false);
            } else {
                const summary = [
                    { rankLabel: 'TIME', alias: 'DURATION', displayValue: timeTaken + 'ms', isMe: true, isNewPb: false },
                    { rankLabel: 'SCORE', alias: 'POINTS', displayValue: String(p.score).padStart(6, '0'), isMe: true, isNewPb: false }
                ];
                oldRoom.emitToPlayer(p.id, 'show_leaderboard', [{ title: 'MATCH SUMMARY', entries: summary }], false);
            }

            playerSessionStats.set(id, {
                score: p.score,
                doubleShotAmmo: 0,
                uuid: p.uuid,
                alias: p.alias,
                shipType: p.type,
                shotsFired: 0,
                fuel: 76464
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
		shipType: useClassicPhysics ? 'classic' : 'modern'
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

    socket.on('debug_action', (action, payload) => {
        if (!SERVER_CONFIG.debugMode) return;
        if (action === 'pause') {
            isServerPaused = !isServerPaused;
        } else if (action === 'jump') {
            const tgt = parseInt(payload?.levelIndex, 10);
            if (!isNaN(tgt)) handleTransitionToLevel(socket.id, tgt, false);
            } else if (action === 'powerup') {
                const roomIndex = playerRooms.get(socket.id);
                if (roomIndex !== undefined) {
                    const room = rooms.get(roomIndex);
                    if (room) {
                        const e = room.ecs.getPlayerEntity(socket.id);
                        if (e !== undefined) {
                            const w = room.ecs.weaponMounts.get(e);
                            if (w) {
                                w.activeModeId = 0xD6; // 0xD6 = Double Shot
                                w.charges = 999;
                                const t = room.ecs.transforms.get(e);
                                if (t) room.ecs.events.push({ type: 'floating_text', text: 'DEBUG: 2X WEAPON', color: '#f39c12', x: t.x, y: t.y - 30 });
                            }
                        }
                    }
                }
        }
    });

    socket.on('next_level', () => {
        const current = playerRooms.get(socket.id);
        if (current !== undefined) {
            handleTransitionToLevel(socket.id, current + 1);
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

    socket.on('request_leaderboard', () => {
        const pLevel = playerRooms.get(socket.id) ?? 0;
        const stats = playerSessionStats.get(socket.id);
        const uuid = stats?.uuid || socket.handshake.auth?.uuid || socket.id;
        const alias = stats?.alias || socket.handshake.auth?.alias || 'UNK';
        const mode = 'SP';
        const physicsHash = getActivePhysicsHash();
        
        const boards = buildMissionLeaderboards(pLevel, mode, physicsHash, uuid, alias);
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

server.listen(SERVER_CONFIG.port, () => console.log(`TS Server running on http://localhost:${SERVER_CONFIG.port}`));
