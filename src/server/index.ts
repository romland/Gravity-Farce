import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import { getLevelData } from './levels';
import { Room } from './Room';

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('./src/client'));

const rooms = new Map<number, Room>();

function getOrCreateRoom(index: number): Room {
    if (!rooms.has(index)) {
        rooms.set(index, new Room(index, getLevelData(index), io, handleTransition));
    }
    return rooms.get(index)!;
}

function handleTransition(id: string) {
    const socket = io.sockets.sockets.get(id);
    if (!socket) return;
    
    let pLevel = 0; let pType: 'classic'|'modern' = 'modern';
    for (const room of rooms.values()) {
        const e = room.ecs.getPlayerEntity(id);
        if (e !== undefined) {
            pLevel = room.levelIndex;
            pType = room.ecs.players.get(e)!.type;
            room.removePlayer(id);
            break;
        }
    }

    socket.leave(`level_${pLevel}`);
    pLevel++;
    
    const newRoom = getOrCreateRoom(pLevel);
    socket.join(`level_${pLevel}`);
    
    socket.emit('initLevel', newRoom.level);
    newRoom.addPlayer(id, pType);
}

io.on('connection', (socket) => {
    console.log('Player connected:', socket.id);
    
    const useClassicPhysics = true;
    const room = getOrCreateRoom(0);
    
    socket.join('level_0');
    socket.emit('initLevel', room.level);
    room.addPlayer(socket.id, useClassicPhysics ? 'classic' : 'modern');

    socket.on('input', (rawInputs) => {
        for (const room of rooms.values()) {
            const e = room.ecs.getPlayerEntity(socket.id);
            if (e !== undefined) {
                const p = room.ecs.players.get(e)!;
                if (!p.isDead) {
                    p.inputs = { up: !!rawInputs?.up, left: !!rawInputs?.left, right: !!rawInputs?.right, shoot: !!rawInputs?.shoot };
                    if (rawInputs?.shoot) p.shootLatch = true;
                }
                break;
            }
        }
    });

    socket.on('disconnect', () => {
        for (const room of rooms.values()) {
            room.removePlayer(socket.id);
        }
    });
});

setInterval(() => {
    for (let room of rooms.values()) {
        room.tick();
    }
}, 1000 / 60);

server.listen(10000, () => console.log('TS Server running on http://localhost:10000'));
