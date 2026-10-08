import { Registry } from '../core/ecs';
import type { Room } from '../Room';
import { recordDB } from '../core/records';

export function sysRacing(ecs: Registry, room: Room) {
    if (!room.level || !room.level.rawMap) return;

    const now = Date.now();

    for (const [pe, p] of ecs.players.entries()) {
        if (p.isDead) continue;
        const pt = ecs.transforms.get(pe)!;

        const tileX = Math.floor(pt.x / 32);
        const tileY = Math.floor(pt.y / 32);
        const tileId = room.level.rawMap[tileY]?.[tileX];

        if (tileId !== undefined && tileId >= 0xDA && tileId <= 0xE1) {
            const hitCheckpoint = tileId - 0xD9; // 1 to 8

            if (!p.race) {
                p.race = {
                    state: 0,
                    nextCheckpoint: 1,
                    currentLap: 0,
                    totalLaps: 3, // Default to 3 laps
                    startTime: 0,
                    lapTimes: []
                };
            }

            if (p.race.state === 0 && hitCheckpoint === 1) {
                p.race.state = 1;
                p.race.nextCheckpoint = 2;
                p.race.currentLap = 1;
                p.race.startTime = now;
                ecs.events.push({ type: 'sound', soundId: 10, x: pt.x, y: pt.y });
                ecs.events.push({ type: 'floating_text', text: 'GO!', color: '#f1c40f', x: pt.x, y: pt.y - 30 });
            } else if (p.race.state === 1 && hitCheckpoint === p.race.nextCheckpoint) {
                p.race.nextCheckpoint++;
                
                if (p.race.nextCheckpoint > 8) {
                    const lapTime = now - p.race.startTime - p.race.lapTimes.reduce((a, b) => a + b, 0);
                    p.race.lapTimes.push(lapTime);
                    
                // Multiplayer = More than 1 player in the room
                const mode = ecs.players.size > 1 ? 'MP' : 'SP';
                // Fake physics hash until we add adjustable physics menus
                const physicsHash = recordDB.generatePhysicsHash({ gravity: 0.1, thrust: 0.2, maxSpeed: 10 }); 

                // Save Fastest Individual Lap
                recordDB.submitRecord('fastest_lap', room.levelIndex, mode, physicsHash, 'asc', {
                    playerId: p.uuid,
                    alias: p.alias,
                    value: lapTime,
                    metadata: { ship: p.type, lapNum: p.race.currentLap, totalLaps: p.race.totalLaps }
                });

                    if (p.race.currentLap >= p.race.totalLaps) {
                        p.race.state = 2;
                        p.race.finishTime = now;
                        ecs.events.push({ type: 'sound', soundId: 11, x: pt.x, y: pt.y });
                        ecs.events.push({ type: 'floating_text', text: 'FINISHED!', color: '#2ecc71', x: pt.x, y: pt.y - 30 });
                        p.score += 5000;
                    
                    recordDB.submitRecord('race_time', room.levelIndex, mode, physicsHash, 'asc', {
                        playerId: p.uuid,
                        alias: p.alias,
                        value: now - p.race.startTime,
                        metadata: { ship: p.type, laps: p.race.totalLaps }
                    });
                    
                    // Fetch top 5 for both categories and push a targeted UI event to the player
                    const topLaps = recordDB.getRecords('fastest_lap', room.levelIndex, mode, physicsHash).slice(0, 5);
                    const topRaces = recordDB.getRecords('race_time', room.levelIndex, mode, physicsHash).slice(0, 5);
                    
                    room.emitToPlayer(p.id, 'show_leaderboard', [
                        { title: `TOP ${mode} RACE TIMES`, entries: topRaces },
                        { title: `TOP ${mode} LAP TIMES`, entries: topLaps }
                    ]);

                    } else {
                        p.race.currentLap++;
                        p.race.nextCheckpoint = 1;
                        ecs.events.push({ type: 'sound', soundId: 10, x: pt.x, y: pt.y });
                        ecs.events.push({ type: 'floating_text', text: `LAP ${p.race.currentLap}/${p.race.totalLaps}`, color: '#3498db', x: pt.x, y: pt.y - 30 });
                    }
                } else {
                    ecs.events.push({ type: 'sound', soundId: 10, x: pt.x, y: pt.y });
                    ecs.events.push({ type: 'floating_text', text: 'CHECKPOINT', color: '#fff', x: pt.x, y: pt.y - 30 });
                }
            }
        }
    }
}