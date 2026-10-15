import { Registry } from '../core/ecs';
import type { Room } from '../Room';
import { recordDB, formatTimeMs, buildLeaderboardContext } from '../core/records';
import { SERVER_CONFIG } from '../core/config';

export function sysRacing(ecs: Registry, room: Room) {
    if (!room.level || !room.level.rawMap) return;

    const now = Math.round(room.globalWaveTimer * (1000 / SERVER_CONFIG.tickRate));

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
                    lapTimes: [],
                    currentLapSplits: {}
                };
            }

            if (p.race.state === 0 && hitCheckpoint === 1) {
                p.race.state = 1;
                p.race.nextCheckpoint = 2;
                p.race.currentLap = 1;
                p.race.startTime = now;
                p.race.currentLapSplits = {};
                p.race.bestLapResult = undefined;
                p.race.bestFlyingResult = undefined;
                ecs.events.push({ type: 'sound', soundId: 10, x: pt.x, y: pt.y });
                ecs.events.push({ type: 'floating_text', text: 'GO!', color: '#f1c40f', x: pt.x, y: pt.y - 30 });
            } else if (p.race.state === 1 && hitCheckpoint === p.race.nextCheckpoint) {
                const mode = room.getRoomMode();
                const physicsHash = room.getPhysicsHash();
                const isBot = ecs.bots.has(pe);
                const elapsedInLap = now - p.race.startTime - p.race.lapTimes.reduce((a, b) => a + b, 0);
                if (!p.race.currentLapSplits) p.race.currentLapSplits = {};
                p.race.currentLapSplits[hitCheckpoint] = elapsedInLap;

                p.race.nextCheckpoint++;

                if (p.race.nextCheckpoint > 8) {
                    const lapTime = elapsedInLap;
                    const completedSplits = { ...p.race.currentLapSplits };
                    p.race.currentLapSplits = {};
                    p.race.lapTimes.push(lapTime);

                    room.tracker.logEvent(p.id, { type: 'lap_completed', lapNum: p.race.currentLap, lapTime });

                    // Save Fastest Individual Lap
                    let rLap = { rank: -1, isNewPb: false, timestamp: 0 };
                    if (!isBot && !room.isReplayMode) {
                        rLap = recordDB.submitRecord('fastest_lap', room.levelIndex, mode, physicsHash, 'asc', {
                            playerId: p.uuid,
                            alias: p.alias,
                            value: lapTime,
                            metadata: { ship: p.type, lapNum: p.race.currentLap, totalLaps: p.race.totalLaps, replayId: room.tracker.uuid, splits: completedSplits }
                        });
                        if (rLap.rank !== -1) room.tracker.logHighscore(p.id, 'fastest_lap', lapTime, rLap.isNewPb);
                        if (!p.race.bestLapResult || lapTime < p.race.bestLapResult.value) {
                            p.race.bestLapResult = { value: lapTime, rank: rLap.rank, isNewPb: rLap.isNewPb, timestamp: rLap.timestamp || Date.now() };
                        }
                    }

                    // Flying Lap (Lap 2+)
                    let rFlying = null;
                    if (p.race.currentLap > 1 && !isBot && !room.isReplayMode) {
                        rFlying = recordDB.submitRecord('flying_lap', room.levelIndex, mode, physicsHash, 'asc', {
                            playerId: p.uuid, alias: p.alias, value: lapTime, metadata: { ship: p.type, lapNum: p.race.currentLap, replayId: room.tracker.uuid }
                        });
                        if (rFlying.rank !== -1) room.tracker.logHighscore(p.id, 'flying_lap', lapTime, rFlying.isNewPb);
                        if (!p.race.bestFlyingResult || lapTime < p.race.bestFlyingResult.value) {
                            p.race.bestFlyingResult = { value: lapTime, rank: rFlying.rank, isNewPb: rFlying.isNewPb, timestamp: rFlying.timestamp || Date.now() };
                        }
                    }

                    // Playfield announcement (player-only) and global server broadcast for #1
                    if (!isBot && !room.isReplayMode) {
                        if (rLap.rank === 1) {
                            room.emitToPlayer(p.id, 'playfield_announce', { text: `NEW #1 LAP RECORD! ${formatTimeMs(lapTime)}`, color: '#ffd700' });
                            room.broadcastGlobalAnnouncement(`${p.alias} SET #1 LAP RECORD ON ${room.level.name} (${formatTimeMs(lapTime)})!`);
                        } else if (rFlying && rFlying.rank === 1) {
                            room.emitToPlayer(p.id, 'playfield_announce', { text: `NEW #1 FLYING LAP! ${formatTimeMs(lapTime)}`, color: '#ffd700' });
                            room.broadcastGlobalAnnouncement(`${p.alias} SET #1 FLYING LAP ON ${room.level.name} (${formatTimeMs(lapTime)})!`);
                        } else if (rLap.isNewPb) {
                            room.emitToPlayer(p.id, 'playfield_announce', { text: `NEW LAP PB! ${formatTimeMs(lapTime)}`, color: '#2ecc71' });
                        } else if (rFlying && rFlying.isNewPb) {
                            room.emitToPlayer(p.id, 'playfield_announce', { text: `NEW FLYING LAP PB! ${formatTimeMs(lapTime)}`, color: '#2ecc71' });
                        } else if (rLap.rank > 0 && rLap.rank <= 10) {
                            room.emitToPlayer(p.id, 'playfield_announce', { text: `TOP #${rLap.rank} LAP TIME! ${formatTimeMs(lapTime)}`, color: '#4facfe' });
                        }
                    }

                    if (p.race.currentLap >= p.race.totalLaps) {
                        p.race.state = 2;
                        p.race.finishTime = now;
                        ecs.events.push({ type: 'sound', soundId: 11, x: pt.x, y: pt.y });
                        ecs.events.push({ type: 'floating_text', text: 'FINISHED!', color: '#2ecc71', x: pt.x, y: pt.y - 30 });
                        p.score += 5000;
                        room.tracker.isCompleted = true;

                        room.tracker.logEvent(p.id, { type: 'race_completed', totalTime: now - p.race.startTime, lapTimes: [...p.race.lapTimes] });

                        let rRace = { rank: -1, isNewPb: false, timestamp: 0 };
                        if (!isBot && !room.isReplayMode) {
                            rRace = recordDB.submitRecord('race_time', room.levelIndex, mode, physicsHash, 'asc', {
                                playerId: p.uuid,
                                alias: p.alias,
                                value: now - p.race.startTime,
                                metadata: { ship: p.type, laps: p.race.totalLaps, replayId: room.tracker.uuid }
                            });
                            if (rRace.rank !== -1) room.tracker.logHighscore(p.id, 'race_time', now - p.race.startTime, rRace.isNewPb);
                            if (rRace.rank === 1) {
                                room.broadcastGlobalAnnouncement(`${p.alias} TOOK #1 RACE RECORD ON ${room.level.name} (${formatTimeMs(now - p.race.startTime)})!`);
                            }
                        }
                        room.tracker.isCompleted = true;

                        // If this is SP, or if all MP players have finished, close the log instantly
                        let allFinished = true;
                        for (const op of room.ecs.players.values()) {
                            if (!op.race || op.race.state !== 2) allFinished = false;
                        }
                        if (allFinished) room.tracker.finishAndSave();

                        let boards: any[] = [];
                        if (room.isReplayMode) {
                            boards = buildRaceLeaderboards(room.levelIndex, mode, physicsHash, p.uuid, p.alias);
                        } else {
                            const bestLap = p.race.bestLapResult || { value: Math.min(...p.race.lapTimes), isNewPb: rLap.isNewPb, timestamp: rLap.timestamp || now };
                            const bestFly = p.race.bestFlyingResult;
                            const ctxRaces = buildLeaderboardContext('race_time', room.levelIndex, mode, physicsHash, p.uuid, rRace.isNewPb, rRace.timestamp, x => formatTimeMs(x.value), 10, { value: now - p.race.startTime, alias: p.alias });
                            const ctxLaps = buildLeaderboardContext('fastest_lap', room.levelIndex, mode, physicsHash, p.uuid, bestLap.isNewPb, bestLap.timestamp, x => formatTimeMs(x.value), 10, { value: bestLap.value, alias: p.alias });
                            const ctxFlying = buildLeaderboardContext('flying_lap', room.levelIndex, mode, physicsHash, p.uuid, bestFly?.isNewPb ?? false, bestFly?.timestamp, x => formatTimeMs(x.value), 10, bestFly ? { value: bestFly.value, alias: p.alias } : undefined);

                            if (mode === 'MP') {
                                const sessionRaces = [];
                                for (const [_, otherP] of room.ecs.players.entries()) {
                                    if (otherP.race && otherP.race.state > 0) {
                                        let status = otherP.race.state === 2 ? formatTimeMs(otherP.race.finishTime! - otherP.race.startTime) : `LAP ${otherP.race.currentLap}`;
                                        let sortVal = otherP.race.state === 2 ? (otherP.race.finishTime! - otherP.race.startTime) : 99999999;
                                        sessionRaces.push({ alias: otherP.alias, value: status, isMe: otherP.id === p.id, sortVal });
                                    }
                                }
                                sessionRaces.sort((a, b) => a.sortVal - b.sortVal);
                                const sessionEntries = sessionRaces.map((sr, idx) => ({ rankLabel: sr.sortVal === 99999999 ? '-' : `#${idx + 1}`, alias: sr.alias, displayValue: sr.value, isMe: sr.isMe, isNewPb: false }));
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
                                        displayValue: `FUL:${Math.floor(oF?.consumed || 0)} | SHT:${oW?.shotsFired || 0}`,
                                        isMe: op.id === p.id,
                                        isNewPb: false
                                    };
                                }) : [
                                    { rankLabel: 'TIME', alias: 'TOTAL RACE', displayValue: formatTimeMs(raceDuration), isMe: true, isNewPb: false },
                                    ...p.race.lapTimes.map((lt, idx) => ({ rankLabel: `LAP ${idx + 1}`, alias: idx === 0 ? 'STANDING' : 'FLYING', displayValue: formatTimeMs(lt), isMe: true, isNewPb: false })),
                                    { rankLabel: 'FUEL', alias: 'USED', displayValue: `${Math.floor(room.ecs.fuelTanks.get(pe)?.consumed || 0)}F`, isMe: true, isNewPb: false },
                                    { rankLabel: 'SHOTS', alias: 'SHOTS FIRED', displayValue: String(ecs.weaponMounts.get(pe)?.shotsFired || 0), isMe: true, isNewPb: false }
                                ];

                            boards.push({ title: 'RACE RUN SUMMARY', entries: raceSummaryEntries });
                            boards.push({ title: `TOP ${mode} RACE TIMES`, entries: ctxRaces });
                            boards.push({ title: `TOP ${mode} LAP TIMES`, entries: ctxLaps });
                            if (p.race.totalLaps > 1) boards.push({ title: `TOP ${mode} FLYING LAPS`, entries: ctxFlying });
                        }

                        if (room.isReplayMode) {
                            for (const spectatorId of room.activeClientIds) {
                                room.emitToPlayer(spectatorId, 'show_leaderboard', boards);
                            }
                        } else {
                            room.emitToPlayer(p.id, 'show_leaderboard', boards);
                        }

                    } else {
                        p.race.currentLap++;
                        p.race.nextCheckpoint = 1;
                        ecs.events.push({ type: 'sound', soundId: 10, x: pt.x, y: pt.y });
                        ecs.events.push({ type: 'floating_text', text: `LAP ${p.race.currentLap}/${p.race.totalLaps}`, color: '#3498db', x: pt.x, y: pt.y - 30 });
                    }
                } else {
                    ecs.events.push({ type: 'sound', soundId: 10, x: pt.x, y: pt.y });
                    const pbRec = !isBot ? recordDB.getPlayerBestLapRecord(room.levelIndex, mode, physicsHash, p.uuid) : undefined;
                    const pbSplit = pbRec?.metadata?.splits?.[hitCheckpoint];
                    if (typeof pbSplit === 'number') {
                        const diffMs = elapsedInLap - pbSplit;
                        const sign = diffMs <= 0 ? '-' : '+';
                        const secStr = (Math.abs(diffMs) / 1000).toFixed(3);
                        const splitColor = diffMs <= 0 ? '#2ecc71' : '#e74c3c';
                        ecs.events.push({ type: 'floating_text', text: `CP${hitCheckpoint} ${sign}${secStr}s`, color: splitColor, x: pt.x, y: pt.y - 30 });
                    } else {
                        ecs.events.push({ type: 'floating_text', text: `CHECKPOINT ${hitCheckpoint}`, color: '#fff', x: pt.x, y: pt.y - 30 });
                    }
                }
            }
        }
    }
}

export function buildRaceLeaderboards(pLevel: number, mode: 'SP' | 'MP', physicsHash: string, uuid: string, alias: string) {
    return [
        { title: `TOP ${mode} RACE TIMES`, entries: buildLeaderboardContext('race_time', pLevel, mode, physicsHash, uuid, false, undefined, x => formatTimeMs(x.value), 10) },
        { title: `TOP ${mode} LAP TIMES`, entries: buildLeaderboardContext('fastest_lap', pLevel, mode, physicsHash, uuid, false, undefined, x => formatTimeMs(x.value), 10) },
        { title: `TOP ${mode} FLYING LAPS`, entries: buildLeaderboardContext('flying_lap', pLevel, mode, physicsHash, uuid, false, undefined, x => formatTimeMs(x.value), 10) }
    ];
}
