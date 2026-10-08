import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import { getLevelData } from './levels';
import { Room } from './Room';
import { TILE_DICTIONARY } from './core/tiles';
import { ServerProfiler } from './core/profiler';
import type { PlayerStats } from './core/types';
import { recordDB, formatTimeMs } from './core/records';
import { authDB } from './core/auth';

const app = express();
app.use(express.json()); // Required for JSON POST parsing
const server = http.createServer(app);
const io = new Server(server);

app.post('/api/auth', (req, res) => {
    const { alias, uuid } = req.body || {};
    res.json(authDB.validateOrClaim(alias || '', uuid || ''));
});

app.get('/api/auth/random', (req, res) => {
    res.json({ alias: authDB.generateRandom() });
});

app.use(express.static('./src/client'));

export const SERVER_CONFIG = {
    debugMode: process.env.NODE_ENV !== 'production'
};

const rooms = new Map<number, Room>();

let isServerPaused = false;

// O(1) lookup to prevent DoS when iterating over rooms to find a player on every input
const playerRooms = new Map<string, number>();
const playerSessionStats = new Map<string, PlayerStats>();

function getOrCreateRoom(index: number): Room {
    if (!rooms.has(index)) {
        rooms.set(index, new Room(index, getLevelData(index), io, handleTransition));
    }
    return rooms.get(index)!;
}

function handleTransitionToLevel(id: string, targetLevel: number, forceReset: boolean = false) {
    const socket = io.sockets.sockets.get(id);
    if (!socket) return;
    
    const pLevel = playerRooms.get(id) ?? 0;
    let stats = playerSessionStats.get(id) || { score: 0, fuel: 76464, doubleShotAmmo: 0, uuid: id, alias: 'UNK' };
    let pType: 'classic'|'modern' = stats.shipType || 'modern';
    
    for (const room of rooms.values()) {
        const e = room.ecs.getPlayerEntity(id);
        if (e !== undefined) {
                const p = room.ecs.players.get(e)!;
                pType = p.type;
            stats = {
                    score: p.score,
                    doubleShotAmmo: p.doubleShotAmmo,
                    uuid: p.uuid,
                alias: p.alias,
                shipType: p.type
            };
            playerSessionStats.set(id, stats);
            room.removePlayer(id);
            break;
        }
    }

    socket.leave(`level_${pLevel}`);
    
    const newRoom = getOrCreateRoom(targetLevel);
    if (forceReset) {
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
            const timeTaken = Date.now() - p.joinedAt;
            const mode = oldRoom.ecs.players.size > 1 ? 'MP' : 'SP';
            const physicsHash = recordDB.generatePhysicsHash({ gravity: 0.1, thrust: 0.2, maxSpeed: 10 });
            
            recordDB.submitRecord('sp_fastest', pLevel, mode, physicsHash, 'asc_desc', { playerId: p.uuid, alias: p.alias, value: timeTaken, secondaryValue: p.score });
            recordDB.submitRecord('sp_sneakiest', pLevel, mode, physicsHash, 'asc_asc', { playerId: p.uuid, alias: p.alias, value: p.score, secondaryValue: timeTaken });
            recordDB.submitRecord('sp_eco', pLevel, mode, physicsHash, 'desc_asc', { playerId: p.uuid, alias: p.alias, value: Math.floor(p.fuel), secondaryValue: timeTaken });

            const enemiesLeft = oldRoom.ecs.turrets.size + oldRoom.ecs.tanks.size + oldRoom.ecs.flyingEnemies.size;
            if (enemiesLeft === 0) {
                recordDB.submitRecord('sp_cleared', pLevel, mode, physicsHash, 'asc', { playerId: p.uuid, alias: p.alias, value: timeTaken });
            }

            const topFastest = recordDB.getRecords('sp_fastest', pLevel, mode, physicsHash).slice(0, 5);
            const topSneakiest = recordDB.getRecords('sp_sneakiest', pLevel, mode, physicsHash).slice(0, 5);
            const topEco = recordDB.getRecords('sp_eco', pLevel, mode, physicsHash).slice(0, 5);
            const topCleared = recordDB.getRecords('sp_cleared', pLevel, mode, physicsHash).slice(0, 5);

            const boards = [
                { title: `FASTEST (${mode})`, entries: topFastest.map(x => ({ ...x, displayValue: formatTimeMs(x.value) + ' | ' + String(x.secondaryValue??0).padStart(6,'0') })) },
                { title: `SNEAKIEST (${mode})`, entries: topSneakiest.map(x => ({ ...x, displayValue: String(x.value).padStart(6,'0') + ' | ' + formatTimeMs(x.secondaryValue??0) })) },
                { title: `ECO-RUN (${mode})`, entries: topEco.map(x => ({ ...x, displayValue: String(x.value) + 'F | ' + formatTimeMs(x.secondaryValue??0) })) }
            ];
            if (topCleared.length > 0) boards.push({ title: `100% CLEARED (${mode})`, entries: topCleared.map(x => ({ ...x, displayValue: formatTimeMs(x.value) })) });
            
            oldRoom.emitToPlayer(p.id, 'show_leaderboard', boards);

            playerSessionStats.set(id, {
                score: p.score,
                doubleShotAmmo: p.doubleShotAmmo,
                uuid: p.uuid,
                alias: p.alias,
                shipType: p.type
            });
            oldRoom.removePlayer(id);
        }
    }
}

io.on('connection', (socket) => {
    
    const auth = socket.handshake.auth || {};
    let alias = auth.alias || 'UNK';
    const uuid = auth.uuid || socket.id;

    console.log(`Pilot "${alias}" connected:`, socket.id);

    // Fail-safe: If they bypassed the API, force validate on the socket connection
    const verify = authDB.validateOrClaim(alias, uuid);
    if (!verify.success) {
        alias = authDB.generateRandom(); // Assign a random alias if they tried to steal one
        authDB.validateOrClaim(alias, uuid);
    }

    const stats: PlayerStats = {
        score: 0,
        fuel: 76464,
        doubleShotAmmo: 0,
        uuid: uuid,
        alias: alias
    };
    playerSessionStats.set(socket.id, stats);

    const useClassicPhysics = true;
    const room = getOrCreateRoom(0);
    
    socket.join('level_0');
    playerRooms.set(socket.id, 0);
    socket.emit('serverConfig', SERVER_CONFIG);
    socket.emit('initTiles', TILE_DICTIONARY);
    socket.emit('initLevel', room.level);
    socket.emit('levelIndex', room.levelIndex);
    room.addPlayer(socket.id, useClassicPhysics ? 'classic' : 'modern', stats);

    socket.on('debug_action', (action, payload) => {
        if (!SERVER_CONFIG.debugMode) return;
        if (action === 'pause') {
            isServerPaused = !isServerPaused;
        } else if (action === 'jump') {
            const tgt = parseInt(payload?.levelIndex, 10);
            if (!isNaN(tgt)) handleTransitionToLevel(socket.id, tgt, true);
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
                    p.shootLatch = true;
                }
            }
        }
    });

    socket.on('disconnect', () => {
        for (const room of rooms.values()) {
            room.removePlayer(socket.id);
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
}, 1000 / 60);

server.listen(10000, () => console.log('TS Server running on http://localhost:10000'));
