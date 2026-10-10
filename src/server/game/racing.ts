import { Registry } from '../core/ecs';
import type { Room } from '../Room';
import { recordDB, formatTimeMs, buildLeaderboardContext, getActivePhysicsHash } from '../core/records';

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
                const physicsHash = getActivePhysicsHash();

                // Save Fastest Individual Lap
                const rLap = recordDB.submitRecord('fastest_lap', room.levelIndex, mode, physicsHash, 'asc', {
                    playerId: p.uuid,
                    alias: p.alias,
                    value: lapTime,
                    metadata: { ship: p.type, lapNum: p.race.currentLap, totalLaps: p.race.totalLaps }
                });
                if (rLap.rank !== -1) room.tracker.logHighscore(p.id, 'fastest_lap', lapTime, rLap.isNewPb);

                    if (p.race.currentLap >= p.race.totalLaps) {
                        p.race.state = 2;
                        p.race.finishTime = now;
                        ecs.events.push({ type: 'sound', soundId: 11, x: pt.x, y: pt.y });
                        ecs.events.push({ type: 'floating_text', text: 'FINISHED!', color: '#2ecc71', x: pt.x, y: pt.y - 30 });
                        p.score += 5000;
                        room.tracker.isCompleted = true;
                    
                    const rRace = recordDB.submitRecord('race_time', room.levelIndex, mode, physicsHash, 'asc', {
                        playerId: p.uuid,
                        alias: p.alias,
                        value: now - p.race.startTime,
                        metadata: { ship: p.type, laps: p.race.totalLaps }
                    });
                    if (rRace.rank !== -1) room.tracker.logHighscore(p.id, 'race_time', now - p.race.startTime, rRace.isNewPb);
                    
                    const ctxRaces = buildLeaderboardContext('race_time', room.levelIndex, mode, physicsHash, p.uuid, rRace.isNewPb, rRace.timestamp, x => formatTimeMs(x.value));
                    const ctxLaps = buildLeaderboardContext('fastest_lap', room.levelIndex, mode, physicsHash, p.uuid, rLap.isNewPb, rLap.timestamp, x => formatTimeMs(x.value));
                    
                    const boards = [];
                    if (mode === 'MP') {
                        const sessionRaces = [];
                        for (const [_, otherP] of room.ecs.players.entries()) {
                            if (otherP.race && otherP.race.state > 0) {
                                let status = otherP.race.state === 2 ? formatTimeMs(otherP.race.finishTime! - otherP.race.startTime) : `LAP ${otherP.race.currentLap}`;
                                let sortVal = otherP.race.state === 2 ? (otherP.race.finishTime! - otherP.race.startTime) : 99999999;
                                sessionRaces.push({ alias: otherP.alias, value: status, isMe: otherP.id === p.id, sortVal });
                            }
                        }
                        sessionRaces.sort((a,b) => a.sortVal - b.sortVal);
                        const sessionEntries = sessionRaces.map((sr, idx) => ({ rankLabel: sr.sortVal === 99999999 ? '-' : `#${idx+1}`, alias: sr.alias, displayValue: sr.value, isMe: sr.isMe, isNewPb: false }));
                        boards.push({ title: `CURRENT MATCH RESULTS`, entries: sessionEntries });
                    }

                    const raceDuration = now - p.race.startTime;
                    const raceSummaryEntries = mode === 'MP' ?
                        Array.from(room.ecs.players.entries()).map(([oe, op]) => {
                            const oF = room.ecs.fuelTanks.get(oe);
                            const oW = room.ecs.weaponMounts.get(oe);
                            return {
                                rankLabel: op.race && op.race.state === 2 ? formatTimeMs(op.race.finishTime! - op.race.startTime) : 'RACING',
                                alias: op.alias,
                                displayValue: `FUL:${Math.floor(room.ecs.fuelTanks.get(oe)?.current || 0)} | SHT:${room.ecs.weaponMounts.get(oe)?.shotsFired || 0}`,
                                isMe: op.id === p.id,
                                isNewPb: false
                            };
                        }) : [
                            { rankLabel: 'TIME', alias: 'TOTAL RACE', displayValue: formatTimeMs(raceDuration), isMe: true, isNewPb: false },
                            { rankLabel: 'FUEL', alias: 'REMAINING', displayValue: `${Math.floor(ecs.fuelTanks.get(pe)?.current || 0)}F`, isMe: true, isNewPb: false },
                            { rankLabel: 'SHOTS', alias: 'FIRED', displayValue: String(ecs.weaponMounts.get(pe)?.shotsFired || 0), isMe: true, isNewPb: false }
                        ];

                    boards.push({ title: 'RACE RUN SUMMARY', entries: raceSummaryEntries });
                    boards.push({ title: `TOP ${mode} RACE TIMES`, entries: ctxRaces });
                    boards.push({ title: `TOP ${mode} LAP TIMES`, entries: ctxLaps });

                    room.emitToPlayer(p.id, 'show_leaderboard', boards);

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