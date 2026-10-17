import { Registry } from '../core/ecs';
import type { Room } from '../Room';
import { recordDB, formatTimeMs, buildLeaderboardContext } from '../core/records';

export function sysMission(ecs: Registry, room: Room) {
    if (room.category !== 'mission') return;

    let totalMapCargo = 0;
    for (const [ce, cargo] of ecs.cargos.entries()) {
        if (cargo.active) totalMapCargo++;
    }
    let totalPlayerCargo = 0;
    for (const [oe, op] of ecs.players.entries()) {
        const inv = ecs.cargoBays.get(oe);
        if (!op.isDead && inv) totalPlayerCargo += inv.stack.length;
    }
    const totalCargoRemaining = totalMapCargo + totalPlayerCargo;

    for (const [pe, p] of ecs.players.entries()) {
        if (p.isDead || p.advancing) continue;

        const t = ecs.transforms.get(pe);
        if (!t) continue;

        let missionComplete = false;

        if (room.initialCargoCount > 0) {
            if (totalCargoRemaining === 0) {
                missionComplete = true;
            }
        } else {
            if (p.isLanded && !p.inputs.up) {
                const pads = room.level.entities.filter(e => e.type === 'pad' && e.props?.isEndPad);
                for (const pad of pads) {
                    if (pad.w && pad.h && t.x >= pad.x - 10 && t.x <= pad.x + pad.w + 10 && t.y >= pad.y - 18 && t.y <= pad.y + 4) {
                        missionComplete = true;
                        break;
                    }
                }
            }
        }

        if (missionComplete) {
            p.advancing = true;
            room.tracker.isCompleted = true;
            ecs.events.push({ type: 'floating_text', text: 'CAVERN SECURED', color: '#4facfe', x: t.x, y: t.y - 60 });
            if (!room.isReplayMode) setTimeout(() => room.transitionPlayer(p.id), 3000);
        }
    }
}

export function evaluateMissionEnd(room: Room, playerId: string, timeTaken: number) {
    const e = room.ecs.getPlayerEntity(playerId);
    if (e === undefined) return null;
    if (room.ecs.bots.has(e)) return null;
    const p = room.ecs.players.get(e)!;
    const f = room.ecs.fuelTanks.get(e);
    const w = room.ecs.weaponMounts.get(e);

    const mode = room.getRoomMode();
    const physicsHash = room.getPhysicsHash();
    const botCount = room.getBotCount();
    const isBotPilot = Boolean(p.isBotPilot);
    const levelPoints = Math.max(0, p.score - (p.levelStartScore || 0));
    const startLvl = p.streakStartLevel ?? room.levelIndex;

    if (room.isReplayMode) {
        return buildMissionLeaderboards(room.levelIndex, mode, physicsHash, p.uuid, p.alias, undefined, undefined, undefined, botCount, isBotPilot);
    }

    const rFast = recordDB.submitRecord('sp_fastest', room.levelIndex, mode, physicsHash, 'asc_desc', { playerId: p.uuid, alias: p.alias, value: timeTaken, secondaryValue: levelPoints, metadata: { replayId: room.tracker.uuid, botCount } }, 100, isBotPilot);
    const rSneak = recordDB.submitRecord('sp_sneakiest', room.levelIndex, mode, physicsHash, 'asc_asc', { playerId: p.uuid, alias: p.alias, value: levelPoints, secondaryValue: timeTaken, metadata: { replayId: room.tracker.uuid, botCount } }, 100, isBotPilot);
    const rEco = recordDB.submitRecord('sp_eco', room.levelIndex, mode, physicsHash, 'asc_asc', { playerId: p.uuid, alias: p.alias, value: Math.floor(f?.consumed || 0), secondaryValue: timeTaken, metadata: { replayId: room.tracker.uuid, botCount } }, 100, isBotPilot);
    const rBest = recordDB.submitRecord('sp_level_best', room.levelIndex, mode, physicsHash, 'desc_asc', { playerId: p.uuid, alias: p.alias, value: levelPoints, secondaryValue: timeTaken, metadata: { replayId: room.tracker.uuid, botCount } }, 100, isBotPilot);

    // Bank 5-Lives Sequential Streak Score automatically upon completing each cavern in the sequence.
    // Why maxEntriesPerPlayer = 1 (TODO 5): A single 9-level streak or multiple attempts should never
    // flood the 5-Lives Streak leaderboard with multiple slots for the same pilot; only their single
    // highest streak run is retained on the board.
    const rStreak = recordDB.submitRecord('arcade_score', 0, mode, physicsHash, 'desc_asc', {
        playerId: p.uuid,
        alias: p.alias,
        value: p.score,
        secondaryValue: timeTaken,
        metadata: { replayId: room.tracker.uuid, botCount, startLevel: startLvl, endLevel: room.levelIndex }
    }, 100, isBotPilot, 1);

    // Update 50-Cavern Campaign Mastery Aggregates (Levels 0-49)
    const campaignRes = recordDB.recalculateCampaignMastery(mode, physicsHash, p.uuid, p.alias, isBotPilot, botCount);

    if (rFast.rank !== -1) room.tracker.logHighscore(playerId, 'sp_fastest', timeTaken, rFast.isNewPb);
    if (rSneak.rank !== -1) room.tracker.logHighscore(playerId, 'sp_sneakiest', levelPoints, rSneak.isNewPb);
    if (rEco.rank !== -1) room.tracker.logHighscore(playerId, 'sp_eco', Math.floor(f?.consumed || 0), rEco.isNewPb);
    if (rBest.rank !== -1) room.tracker.logHighscore(playerId, 'sp_level_best', levelPoints, rBest.isNewPb);
    if (rStreak.rank !== -1) room.tracker.logHighscore(playerId, 'arcade_score', p.score, rStreak.isNewPb);

    let rClear = null;
    let rSharpshooter = null;
    let enemiesLeft = 0;
    let totalEnemies = room.ecs.turrets.size + room.ecs.tanks.size + room.ecs.flyingEnemies.size;

    for (const t of room.ecs.turrets.values()) if (t.hp !== undefined && t.hp > 0) enemiesLeft++;
    for (const t of room.ecs.tanks.values()) if (t.hp !== undefined && t.hp > 0) enemiesLeft++;
    for (const fly of room.ecs.flyingEnemies.values()) if (fly.hp !== undefined && fly.hp > 0) enemiesLeft++;

    const completionPct = totalEnemies === 0 ? 100 : Math.round(((totalEnemies - enemiesLeft) / totalEnemies) * 100);

    if (enemiesLeft === 0) {
        rClear = recordDB.submitRecord('sp_cleared', room.levelIndex, mode, physicsHash, 'asc', { playerId: p.uuid, alias: p.alias, value: timeTaken, metadata: { replayId: room.tracker.uuid, botCount } }, 100, isBotPilot);
        rSharpshooter = recordDB.submitRecord('sp_sharpshooter', room.levelIndex, mode, physicsHash, 'asc_asc', { playerId: p.uuid, alias: p.alias, value: w?.shotsFired || 0, secondaryValue: timeTaken, metadata: { replayId: room.tracker.uuid, botCount } }, 100, isBotPilot);
        if (rClear.rank !== -1) room.tracker.logHighscore(playerId, 'sp_cleared', timeTaken, rClear.isNewPb);
        if (rSharpshooter.rank !== -1) room.tracker.logHighscore(playerId, 'sp_sharpshooter', w?.shotsFired || 0, rSharpshooter.isNewPb);
    }

    const top1Disciplines: string[] = [];
    if (rFast.rank === 1) top1Disciplines.push('BLITZ');
    if (rSneak.rank === 1) top1Disciplines.push('PACIFIST');
    if (rEco.rank === 1) top1Disciplines.push('TREEHUGGER');
    if (rClear?.rank === 1) top1Disciplines.push('PERFECTION');
    if (rSharpshooter?.rank === 1) top1Disciplines.push('SNIPER');
    if (rStreak.rank === 1) top1Disciplines.push('5-LIVES STREAK');
    if (campaignRes.score.rank === 1) top1Disciplines.push('CAMPAIGN SCORE');
    if (top1Disciplines.length > 0) {
        room.broadcastGlobalAnnouncement(`${p.alias} TOOK #1 [${top1Disciplines.join(', ')}] ON ${room.level.name}!`);
    }

    const boards = buildMissionLeaderboards(room.levelIndex, mode, physicsHash, p.uuid, p.alias,
        {
            fast: rFast.isNewPb, sneak: rSneak.isNewPb, eco: rEco.isNewPb,
            clear: rClear?.isNewPb ?? false, sharpshooter: rSharpshooter?.isNewPb ?? false,
            streak: rStreak.isNewPb, campScore: campaignRes.score.isNewPb,
            campTime: campaignRes.time.isNewPb, campFuel: campaignRes.fuel.isNewPb
        },
        {
            fast: rFast.timestamp, sneak: rSneak.timestamp, eco: rEco.timestamp,
            clear: rClear?.timestamp, sharpshooter: rSharpshooter?.timestamp,
            streak: rStreak.timestamp, campScore: campaignRes.score.timestamp,
            campTime: campaignRes.time.timestamp, campFuel: campaignRes.fuel.timestamp
        },
        {
            fast: { v: timeTaken, s: levelPoints }, sneak: { v: levelPoints, s: timeTaken },
            eco: { v: Math.floor(f?.consumed || 0), s: timeTaken }, clear: { v: timeTaken },
            sharpshooter: { v: w?.shotsFired || 0, s: timeTaken },
            streak: { v: p.score, s: timeTaken },
            campScore: campaignRes.score.caverns > 0 ? { v: campaignRes.score.totalScore, s: campaignRes.score.totalTime } : undefined,
            campTime: campaignRes.time.caverns > 0 ? { v: campaignRes.time.caverns, s: campaignRes.time.totalTime } : undefined,
            campFuel: campaignRes.fuel.caverns > 0 ? { v: campaignRes.fuel.caverns, s: campaignRes.fuel.totalFuel } : undefined
        },
        botCount, isBotPilot
    );

    const runSummaryEntries = mode === 'MP' ?
        Array.from(room.ecs.players.entries()).map(([oe, op]) => ({
            rankLabel: op.id === playerId ? 'YOU' : 'PILOT', alias: op.alias, isMe: op.id === playerId, isNewPb: false,
            displayValue: `SCR:${op.score} | FUL:${Math.floor(room.ecs.fuelTanks.get(oe)?.consumed || 0)} | SHT:${room.ecs.weaponMounts.get(oe)?.shotsFired || 0}`
        })) : [
            { rankLabel: 'TIME', alias: 'DURATION', displayValue: formatTimeMs(timeTaken), isMe: true, isNewPb: false },
            { rankLabel: 'SCORE', alias: 'SCORE', displayValue: String(levelPoints).padStart(6, '0'), isMe: true, isNewPb: false },
            { rankLabel: 'STREAK', alias: `C${String(startLvl).padStart(2, '0')}-C${String(room.levelIndex).padStart(2, '0')} (${p.lives}♥)`, displayValue: String(p.score).padStart(6, '0'), isMe: true, isNewPb: false },
            { rankLabel: 'FUEL', alias: 'CONSUMED', displayValue: `${Math.floor(f?.consumed || 0)}F`, isMe: true, isNewPb: false },
            { rankLabel: 'SHOTS', alias: 'SHOTS', displayValue: String(w?.shotsFired || 0), isMe: true, isNewPb: false },
            { rankLabel: 'STATUS', alias: 'DESTROYED', displayValue: `${completionPct}%`, isMe: true, isNewPb: false }
        ];
    if (botCount > 0) {
        runSummaryEntries.push({ rankLabel: 'BOTS', alias: 'WITH BOTS', displayValue: `${botCount} AI`, isMe: true, isNewPb: false });
    }

    boards.unshift({ title: mode === 'MP' ? 'MATCH SUMMARY' : (botCount > 0 ? `SUMMARY [WITH BOTS: ${botCount}]` : 'SUMMARY'), description: '', entries: runSummaryEntries });

    return boards;
}

export function buildMissionLeaderboards(pLevel: number, mode: 'SP' | 'MP', physicsHash: string, uuid: string, alias: string, isNewPbMap?: Record<string, boolean>, timestampsMap?: Record<string, number>, cv?: Record<string, any>, botCount: number = 0, isBotPilot: boolean = false) {
    const tag = `${botCount > 0 ? ` [WITH BOTS: ${botCount}]` : ''}${isBotPilot ? ' [BOT LEAGUE]' : ''}`;
    const formatStreak = (x: any) => {
        const sLvl = x.metadata?.startLevel;
        const eLvl = x.metadata?.endLevel;
        const rangeStr = (sLvl !== undefined && eLvl !== undefined) ? ` (C${String(sLvl).padStart(2, '0')}-C${String(eLvl).padStart(2, '0')})` : '';
        return `${String(x.value).padStart(6, '0')} PTS${rangeStr}`;
    };
    const formatCampScore = (x: any) => {
        const cCount = x.metadata?.cavernsCleared ?? '?';
        return `${String(x.value).padStart(6, '0')} PTS (${cCount}/50) | ${formatTimeMs(x.secondaryValue ?? 0)}`;
    };
    const formatCampTime = (x: any) => `${x.value}/50 CAVERNS | ${formatTimeMs(x.secondaryValue ?? 0)}`;
    const formatCampFuel = (x: any) => `${x.value}/50 CAVERNS | ${x.secondaryValue ?? 0}F`;

    return [
        { title: 'BLITZ', description: `FASTEST CAVERN COMPLETION TIME${tag}`, entries: buildLeaderboardContext('sp_fastest', pLevel, mode, physicsHash, uuid, isNewPbMap?.fast ?? false, timestampsMap?.fast, x => formatTimeMs(x.value) + ' | ' + String(x.secondaryValue ?? 0).padStart(6, '0'), 10, cv?.fast ? { value: cv.fast.v, secondaryValue: cv.fast.s, alias } : undefined, isBotPilot) },
        { title: 'PACIFIST', description: `LOWEST SCORE / PACIFIST GHOST RUN${tag}`, entries: buildLeaderboardContext('sp_sneakiest', pLevel, mode, physicsHash, uuid, isNewPbMap?.sneak ?? false, timestampsMap?.sneak, x => String(x.value).padStart(6, '0') + ' | ' + formatTimeMs(x.secondaryValue ?? 0), 10, cv?.sneak ? { value: cv.sneak.v, secondaryValue: cv.sneak.s, alias } : undefined, isBotPilot) },
        { title: 'TREEHUGGER', description: `LEAST FUEL USED${tag}`, entries: buildLeaderboardContext('sp_eco', pLevel, mode, physicsHash, uuid, isNewPbMap?.eco ?? false, timestampsMap?.eco, x => String(x.value) + 'F | ' + formatTimeMs(x.secondaryValue ?? 0), 10, cv?.eco ? { value: cv.eco.v, secondaryValue: cv.eco.s, alias } : undefined, isBotPilot) },
        { title: 'PERFECTION', description: `100% ENEMY WIPE ON TIME${tag}`, entries: buildLeaderboardContext('sp_cleared', pLevel, mode, physicsHash, uuid, isNewPbMap?.clear ?? false, timestampsMap?.clear, x => formatTimeMs(x.value), 10, cv?.clear ? { value: cv?.clear.v, secondaryValue: cv?.clear.s, alias } : undefined, isBotPilot) },
        { title: 'SNIPER', description: `LEAST SHOTS FIRED (100% ENEMY WIPE)${tag}`, entries: buildLeaderboardContext('sp_sharpshooter', pLevel, mode, physicsHash, uuid, isNewPbMap?.sharpshooter ?? false, timestampsMap?.sharpshooter, x => String(x.value) + ' SHOTS | ' + formatTimeMs(x.secondaryValue ?? 0), 10, cv?.sharpshooter ? { value: cv?.sharpshooter.v, secondaryValue: cv?.sharpshooter.s, alias } : undefined, isBotPilot) },
        { title: '5-LIVES STREAK', description: `SEQUENTIAL 5-LIVES ARCADE RUN${tag}`, entries: buildLeaderboardContext('arcade_score', 0, mode, physicsHash, uuid, isNewPbMap?.streak ?? false, timestampsMap?.streak, formatStreak, 10, cv?.streak ? { value: cv.streak.v, secondaryValue: cv.streak.s, alias } : undefined, isBotPilot) },
        { title: 'CAMPAIGN SCORE', description: `50-CAVERN AGGREGATE BEST SCORE (PRIMARY) & TIME${tag}`, entries: buildLeaderboardContext('campaign_score', 0, mode, physicsHash, uuid, isNewPbMap?.campScore ?? false, timestampsMap?.campScore, formatCampScore, 10, cv?.campScore ? { value: cv.campScore.v, secondaryValue: cv.campScore.s, alias } : undefined, isBotPilot) },
        { title: 'CAMPAIGN BLITZ', description: `FASTEST CLEARANCE OF ALL 50 CAVERNS${tag}`, entries: buildLeaderboardContext('campaign_time', 0, mode, physicsHash, uuid, isNewPbMap?.campTime ?? false, timestampsMap?.campTime, formatCampTime, 10, cv?.campTime ? { value: cv.campTime.v, secondaryValue: cv.campTime.s, alias } : undefined, isBotPilot) },
        { title: 'CAMPAIGN ECO', description: `LOWEST FUEL CONSUMED ACROSS ALL 50 CAVERNS${tag}`, entries: buildLeaderboardContext('campaign_fuel', 0, mode, physicsHash, uuid, isNewPbMap?.campFuel ?? false, timestampsMap?.campFuel, formatCampFuel, 10, cv?.campFuel ? { value: cv.campFuel.v, secondaryValue: cv.campFuel.s, alias } : undefined, isBotPilot) }
    ];
}
