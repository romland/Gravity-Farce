import { Registry, type Entity, type Player } from '../core/ecs';
import type { Room } from '../Room';
import { recordDB, formatTimeMs, buildLeaderboardContext } from '../core/records';
import { SERVER_CONFIG } from '../core/config';

const KILL_CREDIT_WINDOW_TICKS = 210; // 3.5 seconds at 60Hz

export function assignDogfightTeam(room: Room, id: string, isBot: boolean): 'E2' | 'E3' {
    if (room.category !== 'dogfight') return 'E2';

    // Singleplayer (Player vs. Bots): Human is always E2 (P1 pad), Bots are always E3 (P2 pad)
    if (room.getRoomMode() === 'SP') {
        return isBot ? 'E3' : 'E2';
    }

    // Multiplayer: keep existing team if already assigned, otherwise balance E2 / E3
    const existingEnt = room.ecs.getPlayerEntity(id);
    if (existingEnt !== undefined) {
        const existingTeam = room.ecs.players.get(existingEnt)?.team;
        if (existingTeam) return existingTeam;
    }

    let e2Count = 0;
    let e3Count = 0;
    for (const [, p] of room.ecs.players.entries()) {
        if (p.id === id) continue;
        if (p.team === 'E3') e3Count++;
        else e2Count++;
    }
    return e2Count <= e3Count ? 'E2' : 'E3';
}

export function tagPlayerDamage(ecs: Registry, victimEnt: Entity, attackerId: string, currentTick: number) {
    const victim = ecs.players.get(victimEnt);
    if (!victim || victim.isDead || victim.id === attackerId) return;

    const attackerEnt = ecs.getPlayerEntity(attackerId);
    const attacker = attackerEnt !== undefined ? ecs.players.get(attackerEnt) : undefined;
    if (attacker && victim.team && attacker.team && victim.team === attacker.team) {
        return; // Ignore friendly-fire tags on the same team
    }

    victim.lastDamagedBy = { attackerId, tick: currentTick };
}

export function attributeDogfightDeath(ecs: Registry, victimEnt: Entity, room: Room) {
    const victim = ecs.players.get(victimEnt);
    if (!victim) return;
    victim.deaths = (victim.deaths || 0) + 1;

    const vt = ecs.transforms.get(victimEnt);
    const tag = victim.lastDamagedBy;
    victim.lastDamagedBy = undefined;

    if (tag && (room.globalWaveTimer - tag.tick) <= KILL_CREDIT_WINDOW_TICKS) {
        const attackerEnt = ecs.getPlayerEntity(tag.attackerId);
        const attacker = attackerEnt !== undefined ? ecs.players.get(attackerEnt) : undefined;
        if (attacker && attacker.id !== victim.id) {
            attacker.kills = (attacker.kills || 0) + 1;
            attacker.score += 500;
            const at = ecs.transforms.get(attackerEnt!);
            if (at) {
                ecs.events.push({ type: 'floating_text', text: `+1 KILL! (${victim.alias})`, color: '#2ecc71', x: at.x, y: at.y - 36 });
            }
            room.tracker.logEvent(attacker.id, { type: 'pvp_kill' as any, victim: victim.alias } as any);
            return;
        }
    }

    // No recent enemy tag -> Unforced Error (hit wall / turret)
    victim.unforcedErrors = (victim.unforcedErrors || 0) + 1;
    if (vt) {
        ecs.events.push({ type: 'floating_text', text: 'UNFORCED ERROR', color: '#e67e22', x: vt.x, y: vt.y - 30 });
    }
}

export function sysDogfight(ecs: Registry, room: Room) {
    if (room.category !== 'dogfight' || room.dogfightCompleted) return;

    const participants = Array.from(ecs.players.entries());
    if (participants.length < 2) return; // Need at least 2 participants (e.g. Player + Bot or P1 + P2)

    const teamsPresent = new Set<string>();
    const teamsAlive = new Set<string>();

    for (const [, p] of participants) {
        const teamKey = p.team || p.id;
        teamsPresent.add(teamKey);
        if (!p.isDead || p.lives > 0) {
            teamsAlive.add(teamKey);
        }
    }

    // Match only begins once at least 2 distinct teams are present in the cavern
    if (teamsPresent.size < 2) return;

    if (teamsAlive.size <= 1) {
        room.dogfightCompleted = true;
        room.tracker.isCompleted = true;

        const winningTeam = Array.from(teamsAlive)[0] || 'DRAW';
        const durationMs = Math.round(room.globalWaveTimer * (1000 / SERVER_CONFIG.tickRate));

        for (const [, p] of participants) {
            if (!p.isDead && (p.team || p.id) === winningTeam) {
                p.advancing = true;
            }
        }

        const winBanner = winningTeam === 'DRAW'
            ? 'DRAW — MUTUAL ELIMINATION!'
            : `VICTORY — TEAM ${winningTeam} STANDS TRIUMPHANT!`;

        for (const cid of room.activeClientIds) {
            room.emitToPlayer(cid, 'playfield_announce', {
                text: winBanner,
                color: winningTeam === 'E2' ? '#4facfe' : '#ff4b2b'
            });
            room.emitToPlayer(cid, 'hide_game_over', {});
        }

        const boardsByPlayer = evaluateDogfightEnd(room, winningTeam, durationMs);
        room.tracker.finishAndSave();

        setTimeout(() => {
            if (room.isReplayMode) {
                const firstBoards = boardsByPlayer.values().next().value;
                if (firstBoards) {
                    for (const sid of room.activeClientIds) {
                        room.emitToPlayer(sid, 'show_leaderboard', firstBoards, false);
                    }
                }
            } else {
                for (const cid of room.activeClientIds) {
                    const b = boardsByPlayer.get(cid) || boardsByPlayer.values().next().value;
                    if (b) room.emitToPlayer(cid, 'show_leaderboard', b, false);
                }
            }
        }, 1800);
    }
}

function evaluateDogfightEnd(room: Room, winningTeam: string, durationMs: number): Map<string, any[]> {
    const mode = room.getRoomMode();
    const physicsHash = room.getPhysicsHash();
    const botCount = room.getBotCount();
    const resultBoards = new Map<string, any[]>();

    const humans: [Entity, Player][] = [];
    for (const [e, p] of room.ecs.players.entries()) {
        if (!room.ecs.bots.has(e)) humans.push([e, p]);
    }

    // 1. Singleplayer Dogfight vs Bot(s): Tracked as normal deterministic highscore (TODO 6.3)
    const spRecordResults = new Map<string, { rank: number; isNewPb: boolean; timestamp?: number }>();
    if (!room.isReplayMode && mode === 'SP' && botCount > 0) {
        for (const [, p] of humans) {
            const won = (p.team || p.id) === winningTeam;
            if (won) {
                // Primary value: Net Kills (Kills * 100 - Deaths * 10 - UnforcedErrors * 5), Secondary: Duration ASC
                const combatScore = (p.kills * 100) + (p.lives * 25) - (p.unforcedErrors * 10);
                const rSp = recordDB.submitRecord(
                    'sp_dogfight',
                    room.levelIndex,
                    'SP',
                    physicsHash,
                    'desc_asc',
                    {
                        playerId: p.uuid,
                        alias: p.alias,
                        value: combatScore,
                        secondaryValue: durationMs,
                        metadata: {
                            replayId: room.tracker.uuid,
                            botCount,
                            kills: p.kills,
                            deaths: p.deaths,
                            unforcedErrors: p.unforcedErrors
                        }
                    },
                    100,
                    Boolean(p.isBotPilot),
                    1 // 1 entry per player per bot-count configuration
                );
                spRecordResults.set(p.id, rSp);
                if (rSp.rank !== -1) {
                    room.tracker.logHighscore(p.id, 'sp_dogfight', combatScore, rSp.isNewPb);
                }
                if (rSp.rank === 1) {
                    room.broadcastGlobalAnnouncement(`${p.alias} SET #1 SP DOGFIGHT RECORD ON ${room.level.name} VS ${botCount} BOTS!`);
                }
            }
        }
    }

    // 2. Multiplayer PvP / Team Dogfight: Anti-Rigging Combat Rating (TODOs 6.8 & 6.9)
    const ratingDeltas = new Map<string, { newRating: number; delta: number; note?: string }>();
    if (!room.isReplayMode && humans.length >= 2) {
        const winners = humans.filter(([, p]) => (p.team || p.id) === winningTeam);
        const losers = humans.filter(([, p]) => (p.team || p.id) !== winningTeam);

        if (winners.length > 0 && losers.length > 0) {
            for (const [we, wp] of winners) {
                for (const [le, lp] of losers) {
                    const lFuel = room.ecs.fuelTanks.get(le)?.consumed || 0;
                    const lShots = room.ecs.weaponMounts.get(le)?.shotsFired || 0;
                    const engaged = (lShots >= 3 || lFuel >= 150) && durationMs >= 5000;

                    const res = recordDB.processDogfightPvpOutcome(
                        wp.uuid,
                        wp.alias,
                        lp.uuid,
                        lp.alias,
                        engaged,
                        physicsHash,
                        room.tracker.uuid,
                        Boolean(wp.isBotPilot),
                        Boolean(lp.isBotPilot)
                    );
                    ratingDeltas.set(wp.id, { newRating: res.winnerRating, delta: res.winnerDelta, note: res.note });
                    ratingDeltas.set(lp.id, { newRating: res.loserRating, delta: res.loserDelta, note: res.note });
                    if (res.winnerDelta > 0) {
                        room.tracker.logHighscore(wp.id, 'dogfight_rating', res.winnerRating, true);
                    }
                }
            }
        }
    }

    // 3. Build Match Summary + Standings Boards for each client
    const matchRows = Array.from(room.ecs.players.entries())
        .map(([pe, p]) => {
            const isWinner = (p.team || p.id) === winningTeam;
            const fUsed = Math.floor(room.ecs.fuelTanks.get(pe)?.consumed || 0);
            const sFired = room.ecs.weaponMounts.get(pe)?.shotsFired || 0;
            const rDelta = ratingDeltas.get(p.id);
            const deltaStr = rDelta ? ` | ${rDelta.delta >= 0 ? '+' : ''}${rDelta.delta} CR` : '';
            return {
                id: p.id,
                team: p.team || 'E2',
                alias: `[${p.team || 'E2'}] ${p.alias}`,
                isWinner,
                kills: p.kills || 0,
                deaths: p.deaths || 0,
                errors: p.unforcedErrors || 0,
                lives: p.lives,
                displayValue: `K:${p.kills || 0} D:${p.deaths || 0} ERR:${p.unforcedErrors || 0} ♥:${p.lives}${deltaStr}`,
                subStats: `SHT:${sFired} FUL:${fUsed}F`
            };
        })
        .sort((a, b) => (Number(b.isWinner) - Number(a.isWinner)) || (b.kills - a.kills) || (a.deaths - b.deaths));

    for (const [, p] of humans) {
        const spRes = spRecordResults.get(p.id);
        const boards = buildDogfightLeaderboards(
            room.levelIndex,
            mode,
            physicsHash,
            p.uuid,
            p.alias,
            botCount,
            Boolean(p.isBotPilot),
            spRes?.isNewPb ?? false,
            spRes?.timestamp
        );

        const summaryEntries = matchRows.map((r, idx) => ({
            rankLabel: r.isWinner ? `WIN #${idx + 1}` : `#${idx + 1}`,
            alias: r.alias,
            displayValue: r.displayValue,
            isMe: r.id === p.id,
            isNewPb: false
        }));

        boards.unshift({
            title: `DOGFIGHT MATCH SUMMARY (${formatTimeMs(durationMs)})`,
            description: winningTeam === 'DRAW' ? 'MUTUAL ELIMINATION' : `TEAM ${winningTeam} VICTORY`,
            entries: summaryEntries
        });

        const rDelta = ratingDeltas.get(p.id);
        if (rDelta?.note) {
            boards.push({ isFootnote: true, text: rDelta.note, color: '#f39c12' } as any);
        }

        resultBoards.set(p.id, boards);
    }

    if (resultBoards.size === 0 && humans.length === 0) {
        // Replay mode fallback
        const anyP = Array.from(room.ecs.players.values())[0];
        if (anyP) {
            resultBoards.set(
                anyP.id,
                buildDogfightLeaderboards(room.levelIndex, mode, physicsHash, anyP.uuid, anyP.alias, botCount, Boolean(anyP.isBotPilot))
            );
        }
    }

    return resultBoards;
}

export function buildDogfightLeaderboards(
    pLevel: number,
    mode: 'SP' | 'MP',
    physicsHash: string,
    uuid: string,
    alias: string,
    botCount: number = 0,
    isBotPilot: boolean = false,
    isNewSpPb: boolean = false,
    spTimestamp?: number
) {
    const botTag = `${botCount > 0 ? ` [VS ${botCount} BOTS]` : ''}${isBotPilot ? ' [BOT LEAGUE]' : ''}`;
    const formatSpDogfight = (x: any) => {
        const k = x.metadata?.kills ?? 0;
        const d = x.metadata?.deaths ?? 0;
        const err = x.metadata?.unforcedErrors ?? 0;
        const bc = x.metadata?.botCount;
        const bcTag = bc ? `[${bc}B] ` : '';
        return `${bcTag}${x.value} PTS (K:${k} D:${d} E:${err}) | ${formatTimeMs(x.secondaryValue ?? 0)}`;
    };

    const formatPvpRating = (x: any) => {
        const decayed = recordDB.getDecayedCombatRating(x.value, x.timestamp);
        const w = x.metadata?.wins ?? 0;
        const l = x.metadata?.losses ?? 0;
        return `${decayed} CR (${w}W-${l}L)`;
    };

    return [
        {
            title: 'SP BOT ELIMINATION',
            description: `SOLO DOGFIGHT VS BOTS${botTag || ' [SPAWN BOTS TO RANK]'}`,
            entries: buildLeaderboardContext(
                'sp_dogfight',
                pLevel,
                'SP',
                physicsHash,
                uuid,
                isNewSpPb,
                spTimestamp,
                formatSpDogfight,
                10,
                undefined,
                isBotPilot
            )
        },
        {
            title: 'TOP GUN RATING (PVP)',
            description: 'LONG-TERM COMBAT RATING (DIMINISHING RETURNS & 14D DECAY)',
            entries: buildLeaderboardContext(
                'dogfight_rating',
                0,
                'MP',
                physicsHash,
                uuid,
                false,
                undefined,
                formatPvpRating,
                10,
                undefined,
                isBotPilot
            )
        }
    ];
}