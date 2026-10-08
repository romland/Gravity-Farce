import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import { getLevelData } from './levels';
import { Room } from './Room';
import { TILE_DICTIONARY } from './core/tiles';
import { ServerProfiler } from './core/profiler';
import type { PlayerStats } from './core/types';
import { RecordManager } from './core/records';
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

export const recordDB = new RecordManager();
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
    
    let pLevel = 0;
    let pType: 'classic'|'modern' = 'modern';
    
    for (const room of rooms.values()) {
        const e = room.ecs.getPlayerEntity(id);
        if (e !== undefined) {
                const p = room.ecs.players.get(e)!;
            pLevel = room.levelIndex;
                pType = p.type;
                playerSessionStats.set(id, {
                    score: p.score,
                    doubleShotAmmo: p.doubleShotAmmo,
                    uuid: p.uuid,
                    alias: p.alias
                });
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
        newRoom.addPlayer(id, pType, playerSessionStats.get(id));
}

function handleTransition(id: string) {
    let pLevel = 0;
    for (const room of rooms.values()) {
        if (room.ecs.getPlayerEntity(id) !== undefined) {
            pLevel = room.levelIndex;
            break;
        }
    }
    handleTransitionToLevel(id, pLevel + 1);
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
