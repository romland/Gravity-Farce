import { Registry } from '../core/ecs';
import type { Room } from '../Room';
import { recordDB, formatTimeMs, buildLeaderboardContext, getActivePhysicsHash } from '../core/records';

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
            setTimeout(() => room.transitionPlayer(p.id), 3000);
        }
    }
}

export function evaluateMissionEnd(room: Room, playerId: string, timeTaken: number) {
    const e = room.ecs.getPlayerEntity(playerId);
    if (e === undefined) return null;
    const p = room.ecs.players.get(e)!;
    const f = room.ecs.fuelTanks.get(e);
    const w = room.ecs.weaponMounts.get(e);
    
    const mode = room.ecs.players.size > 1 ? 'MP' : 'SP';
    const physicsHash = getActivePhysicsHash();
    
    const rFast = recordDB.submitRecord('sp_fastest', room.levelIndex, mode, physicsHash, 'asc_desc', { playerId: p.uuid, alias: p.alias, value: timeTaken, secondaryValue: p.score });
    const rSneak = recordDB.submitRecord('sp_sneakiest', room.levelIndex, mode, physicsHash, 'asc_asc', { playerId: p.uuid, alias: p.alias, value: p.score, secondaryValue: timeTaken });
    const rEco = recordDB.submitRecord('sp_eco', room.levelIndex, mode, physicsHash, 'desc_asc', { playerId: p.uuid, alias: p.alias, value: Math.floor(f?.current || 0), secondaryValue: timeTaken });

    if (rFast.rank !== -1) room.tracker.logHighscore(playerId, 'sp_fastest', timeTaken, rFast.isNewPb);
    if (rSneak.rank !== -1) room.tracker.logHighscore(playerId, 'sp_sneakiest', p.score, rSneak.isNewPb);
    if (rEco.rank !== -1) room.tracker.logHighscore(playerId, 'sp_eco', Math.floor(f?.current || 0), rEco.isNewPb);

    let rClear = null;
    let rSharpshooter = null;
    let enemiesLeft = 0;
    
    for (const t of room.ecs.turrets.values()) if (t.hp !== undefined && t.hp > 0) enemiesLeft++;
    for (const t of room.ecs.tanks.values()) if (t.hp !== undefined && t.hp > 0) enemiesLeft++;
    for (const fly of room.ecs.flyingEnemies.values()) if (fly.hp !== undefined && fly.hp > 0) enemiesLeft++;

    if (enemiesLeft === 0) {
        rClear = recordDB.submitRecord('sp_cleared', room.levelIndex, mode, physicsHash, 'asc', { playerId: p.uuid, alias: p.alias, value: timeTaken });
        rSharpshooter = recordDB.submitRecord('sp_sharpshooter', room.levelIndex, mode, physicsHash, 'asc_asc', { playerId: p.uuid, alias: p.alias, value: w?.shotsFired || 0, secondaryValue: timeTaken });
        if (rClear.rank !== -1) room.tracker.logHighscore(playerId, 'sp_cleared', timeTaken, rClear.isNewPb);
        if (rSharpshooter.rank !== -1) room.tracker.logHighscore(playerId, 'sp_sharpshooter', w?.shotsFired || 0, rSharpshooter.isNewPb);
    }

    const boards = buildMissionLeaderboards(room.levelIndex, mode, physicsHash, p.uuid, 
        { fast: rFast.isNewPb, sneak: rSneak.isNewPb, eco: rEco.isNewPb, clear: rClear?.isNewPb ?? false, sharpshooter: rSharpshooter?.isNewPb ?? false }, 
        { fast: rFast.timestamp, sneak: rSneak.timestamp, eco: rEco.timestamp, clear: rClear?.timestamp, sharpshooter: rSharpshooter?.timestamp }
    );

    const runSummaryEntries = mode === 'MP' ?
        Array.from(room.ecs.players.entries()).map(([oe, op]) => ({
            rankLabel: op.id === playerId ? 'YOU' : 'PILOT', alias: op.alias, isMe: op.id === playerId, isNewPb: false,
            displayValue: `SCR:${op.score} | FUL:${Math.floor(room.ecs.fuelTanks.get(oe)?.current || 0)} | SHT:${room.ecs.weaponMounts.get(oe)?.shotsFired || 0}`
        })) : [
            { rankLabel: 'TIME', alias: 'DURATION', displayValue: formatTimeMs(timeTaken), isMe: true, isNewPb: false },
            { rankLabel: 'SCORE', alias: 'POINTS', displayValue: String(p.score).padStart(6, '0'), isMe: true, isNewPb: false },
            { rankLabel: 'FUEL', alias: 'GAS LEFT', displayValue: `${Math.floor(f?.current || 0)}F`, isMe: true, isNewPb: false },
            { rankLabel: 'SHOTS', alias: 'SHOTS FIRED', displayValue: String(w?.shotsFired || 0), isMe: true, isNewPb: false },
            { rankLabel: 'STATUS', alias: 'COMPLETION', displayValue: enemiesLeft === 0 ? '100%' : `${enemiesLeft} SURVIVORS`, isMe: true, isNewPb: false }
        ];

    boards.unshift({ title: mode === 'MP' ? 'MATCH SUMMARY' : 'SUMMARY', description: '', entries: runSummaryEntries });
    if (enemiesLeft > 0) boards.push({ title: '', description: '', isFootnote: true, text: `${enemiesLeft} ENEMIES SURVIVED`, color: '#e74c3c', entries: [] } as any);
    
    return boards;
}

export function buildMissionLeaderboards(pLevel: number, mode: 'SP' | 'MP', physicsHash: string, uuid: string, isNewPbMap?: Record<string, boolean>, timestampsMap?: Record<string, number>) {
    return [
        { title: 'BLITZ', description: 'FASTEST CAVERN COMPLETION TIME', entries: buildLeaderboardContext('sp_fastest', pLevel, mode, physicsHash, uuid, isNewPbMap?.fast ?? false, timestampsMap?.fast, x => formatTimeMs(x.value) + ' | ' + String(x.secondaryValue??0).padStart(6,'0')) },
        { title: 'PACIFIST', description: 'LOWEST SCORE / PACIFIST GHOST RUN', entries: buildLeaderboardContext('sp_sneakiest', pLevel, mode, physicsHash, uuid, isNewPbMap?.sneak ?? false, timestampsMap?.sneak, x => String(x.value).padStart(6,'0') + ' | ' + formatTimeMs(x.secondaryValue??0)) },
        { title: 'TREEHUGGER', description: 'LEAST FUEL USED', entries: buildLeaderboardContext('sp_eco', pLevel, mode, physicsHash, uuid, isNewPbMap?.eco ?? false, timestampsMap?.eco, x => String(x.value) + 'F | ' + formatTimeMs(x.secondaryValue??0)) },
        { title: 'PERFECTION', description: '100% ENEMY WIPE ON TIME', entries: buildLeaderboardContext('sp_cleared', pLevel, mode, physicsHash, uuid, isNewPbMap?.clear ?? false, timestampsMap?.clear, x => formatTimeMs(x.value)) },
        { title: 'SNIPER', description: 'LEAST SHOTS FIRED (100% ENEMY WIPE)', entries: buildLeaderboardContext('sp_sharpshooter', pLevel, mode, physicsHash, uuid, isNewPbMap?.sharpshooter ?? false, timestampsMap?.sharpshooter, x => String(x.value) + ' SHOTS | ' + formatTimeMs(x.secondaryValue??0)) }
    ];
}