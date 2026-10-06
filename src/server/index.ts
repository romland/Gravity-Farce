import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import { getLevelData } from './levels';
import { Room } from './Room';
import type { BasePlayer } from './BasePlayer';
import { ModernPlayer } from './ModernPlayer';
import { ClassicPlayer } from './ClassicPlayer';

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

function handleTransition(p: BasePlayer) {
    const socket = io.sockets.sockets.get(p.id);
    if (!socket) return;
    
    const oldRoom = rooms.get(p.levelIndex);
    if (oldRoom) oldRoom.players.delete(p.id);
    socket.leave(`level_${p.levelIndex}`);

    p.levelIndex++;
    p.isDead = true; 
    
    const newRoom = getOrCreateRoom(p.levelIndex);
    newRoom.players.set(p.id, p);
    socket.join(`level_${p.levelIndex}`);
    
    socket.emit('initLevel', newRoom.level);
    newRoom.trySpawnPlayer(p);
}

io.on('connection', (socket) => {
    console.log('Player connected:', socket.id);
    
    // Toggle between the two API compatible models here! 
    const useClassicPhysics = true;
    const p = useClassicPhysics ? new ClassicPlayer(socket.id, 0) : new ModernPlayer(socket.id, 0);
    const room = getOrCreateRoom(0);
    room.players.set(p.id, p);
    
    socket.join('level_0');
    socket.emit('initLevel', room.level);
    room.trySpawnPlayer(p);

    socket.on('input', (rawInputs) => {
        const playerRoom = rooms.get(p.levelIndex);
        if (playerRoom && playerRoom.players.has(p.id) && !p.isDead) {
            p.inputs = {
                up: !!rawInputs?.up, left: !!rawInputs?.left,
                right: !!rawInputs?.right, shoot: !!rawInputs?.shoot
            };
            if (rawInputs?.shoot) p.shootLatch = true;
        }
    });

    socket.on('disconnect', () => {
        const playerRoom = rooms.get(p.levelIndex);
        if (playerRoom) playerRoom.players.delete(p.id);
    });
});

setInterval(() => {
    for (let room of rooms.values()) room.tick();
}, 1000 / 60);

server.listen(10000, () => console.log('TS Server running on http://localhost:10000'));