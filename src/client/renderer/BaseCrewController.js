// The Small Men at the base
import { rollChance } from './RenderConfig.js';

export class BaseCrewController {
    constructor() {
        this.bases = [];
    }

    init(level, cfg) {
        this.bases = [];
        if (cfg.baseCrewEnabled === false || !level) return;

        const prefabs = level.highRes?.prefabs || [];
        const spawns = (level.entities || []).filter(e => e.type === 'spawn');
        const baseStructs = prefabs.filter(p => p.kind === 'BASE_STRUCTURE');

        const homePads = prefabs.filter(p => {
            if (p.kind !== 'PAD') return false;
            if (p.tileId === 0x15) return true;
            return spawns.some(s => Math.abs(s.x - (p.x + p.w * 0.5)) < p.w * 0.7 && Math.abs(s.y - p.y) < 48);
        });

        let seed = 51515;
        const rng = () => {
            seed = (seed * 16807) % 2147483647;
            return (seed - 1) / 2147483646;
        };

        for (let pIdx = 0; pIdx < homePads.length; pIdx++) {
            const pad = homePads[pIdx];
            let doorX = pad.x + 10;
            let structCenterX = pad.x + (pad.w > 48 ? 16 : -24);
            let structTopY = pad.y - 32;
            for (const b of baseStructs) {
                if (Math.abs((b.x + b.w * 0.5) - (pad.x + pad.w * 0.5)) < pad.w + 96 && Math.abs((b.y + b.h) - pad.y) < 64) {
                    doorX = Math.max(pad.x + 6, Math.min(pad.x + pad.w - 6, b.x + b.w * 0.5));
                    structCenterX = b.x + b.w * 0.5;
                    structTopY = b.y;
                    break;
                }
            }

            const crewCount = 3 + (pIdx % 2);
            const workers = [];
            for (let i = 0; i < crewCount; i++) {
                const workX = pad.x + 12 + rng() * Math.max(8, pad.w - 24);
                workers.push({
                    x: doorX + (rng() - 0.5) * 14,
                    workX,
                    targetX: workX,
                    walkSpeed: 0.32 + rng() * 0.22,
                    runSpeed: 0.68 + rng() * 0.42,
                    suitColor: i === 0 ? '#f59e0b' : (i === 1 ? '#38bdf8' : '#e2e8f0'),
                    phase: rng() * Math.PI * 2,
                    pauseTimer: Math.floor(rng() * 80),
                    welding: false
                });
            }

            const digSpotX = this.findDigSpotX(pad, doorX, [], rng);

            this.bases.push({
                padX: pad.x,
                padY: pad.y,
                padW: pad.w,
                doorX,
                structCenterX,
                structTopY,
                workers,
                cargoStack: [],
                rooftopCargoQueue: [],
                shipService: {
                    phase: 'none', // 'none' | 'quick_repair' | 'retreat' | 'idle_wait' | 'scaffold_setup' | 'scaffold_work'
                    timer: 0,
                    shipX: pad.x + pad.w * 0.5,
                    shipY: pad.y - 14,
                    scaffoldProgress: 0
                },
                flyingScaffoldDebris: [],
                rotorcraft: {
                    state: 'cooldown', // 'cooldown' | 'descend' | 'hover_hook' | 'ascend_depth'
                    timer: 320 + Math.floor(rng() * 420),
                    x: structCenterX,
                    y: structTopY - 240,
                    targetX: structCenterX,
                    targetY: structTopY - 34,
                    vx: 0,
                    vy: 0,
                    angle: 0,
                    scale: 1.0,
                    alpha: 0.0,
                    tetherLen: 0,
                    hasCargo: false,
                    cargoLarge: false
                },
                hauler: {
                    state: 'idle',
                    x: doorX,
                    timer: 0,
                    draggedCrate: null,
                    phase: rng() * Math.PI * 2
                },
                miner: {
                    state: 'idle', // 'idle' | 'walk_out' | 'deploy_ladder' | 'climb_down' | 'digging' | 'climb_up' | 'retract_ladder' | 'carry_in'
                    x: doorX,
                    y: pad.y,
                    targetX: digSpotX,
                    ladderExt: 0,
                    ladderLen: 26,
                    caveRadius: 0,
                    caveSeed: rng() * 100,
                    timer: 180 + Math.floor(rng() * 240),
                    hasSack: false,
                    phase: rng() * Math.PI * 2,
                    dugCaves: []
                }
            });
        }
    }

    findDigSpotX(pad, doorX, dugCaves = [], rng = Math.random) {
        const minX = pad.padX !== undefined ? pad.padX + 12 : pad.x + 12;
        const width = pad.padW !== undefined ? pad.padW : pad.w;
        const maxX = minX + Math.max(4, width - 24);
        if (maxX <= minX) return null;
        for (let attempt = 0; attempt < 18; attempt++) {
            const cx = minX + rng() * (maxX - minX);
            if (Math.abs(cx - doorX) < 15) continue;
            const overlaps = dugCaves.some(c => Math.abs(c.x - cx) < (c.rx + 14));
            if (!overlaps) return cx;
        }
        return null;
    }

    onCargoUnloaded(x, y, typeId) {
        if (this.bases.length === 0) return;
        let bestBase = this.bases[0];
        let bestDist = Infinity;
        for (const b of this.bases) {
            const cx = b.padX + b.padW * 0.5;
            const d = Math.hypot(x - cx, y - b.padY);
            if (d < bestDist) {
                bestDist = d;
                bestBase = b;
            }
        }
        if (!bestBase) return;

        const isLarge = typeId === 0xD2;
        const size = isLarge ? 14 : 11;
        const dirFromDoor = bestBase.doorX < (bestBase.padX + bestBase.padW * 0.5) ? 1 : -1;
        const stackAnchorX = Math.max(
            bestBase.padX + 16,
            Math.min(bestBase.padX + bestBase.padW - 16, x + dirFromDoor * 12)
        );

        let topY = bestBase.padY;
        let baseStackX = stackAnchorX;
        for (const c of bestBase.cargoStack) {
            baseStackX = c.x;
            topY = Math.min(topY, c.y - c.size * 0.5);
        }

        bestBase.cargoStack.push({
            x: baseStackX + (Math.random() - 0.5) * 1.5,
            y: topY - size * 0.5,
            vx: 0,
            vy: 0,
            angle: 0,
            vAngle: 0,
            size,
            isLarge
        });
    }

    // Shared DRY crewman renderer for workers, cargo haulers, and ladder miners
    drawCrewMember(ctx, x, y, opts) {
        const {
            suitColor = '#e2e8f0',
            faceDir = 1,
            stride = 0,
            bob = 0,
            leanX = 0,
            carryingSack = false,
            climbing = false
        } = opts;

        // Legs
        ctx.strokeStyle = '#1e293b';
        ctx.lineWidth = 1.25;
        ctx.beginPath();
        if (climbing) {
            const rungStep = stride * 1.4;
            ctx.moveTo(x - 1.0, y - 2.6);
            ctx.lineTo(x - 1.2, y - rungStep);
            ctx.moveTo(x + 1.0, y - 2.6);
            ctx.lineTo(x + 1.2, y + rungStep);
        } else {
            ctx.moveTo(x + leanX * 0.4 - 0.8, y - 2.5 - bob);
            ctx.lineTo(x - 1.2 - stride, y);
            ctx.moveTo(x + leanX * 0.4 + 0.8, y - 2.5 - bob);
            ctx.lineTo(x + 1.2 + stride, y);
        }
        ctx.stroke();

        // Hazmat torso
        if (Math.abs(leanX) > 0.3) {
            ctx.strokeStyle = suitColor;
            ctx.lineWidth = 3.0;
            ctx.beginPath();
            ctx.moveTo(x + leanX * 0.3, y - 2.5 - bob);
            ctx.lineTo(x + leanX, y - 5.8 - bob);
            ctx.stroke();
        } else {
            ctx.fillStyle = suitColor;
            ctx.fillRect(x - 1.6, y - 5.8 - bob, 3.2, 3.4);
        }

        // Ore/Mineral Sack on back/shoulder when hauling from dug cave
        if (carryingSack) {
            ctx.fillStyle = '#eab308';
            ctx.strokeStyle = '#713f12';
            ctx.lineWidth = 0.8;
            ctx.beginPath();
            ctx.arc(x - faceDir * 2.2, y - 4.8 - bob, 2.1, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();
        }

        // Helmet & glowing cyan visor
        const headX = x + leanX * 1.1;
        const headY = y - 7.0 - bob;
        ctx.fillStyle = '#e2e8f0';
        ctx.beginPath();
        ctx.arc(headX, headY, 1.6, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = '#00f2fe';
        ctx.fillRect(headX + (faceDir >= 0 ? 0.4 : -1.3), headY - 0.5, 1.1, 0.9);
    }

    updateAndDraw(ctx, camera, viewW, viewH, players, sparks, timeSec, dt60) {
        if (this.bases.length === 0) return;
        const shipList = players ? Object.values(players).filter(s => !s.isDead) : [];

        for (let b = 0; b < this.bases.length; b++) {
            const base = this.bases[b];
            if (base.padX + base.padW < camera.x - 40 || base.padX > camera.x + viewW + 40 ||
                base.padY < camera.y - 60 || base.padY > camera.y + viewH + 60) {
                continue;
            }

            let landedShip = null;
            let dangerShip = null;
            for (let s = 0; s < shipList.length; s++) {
                const sh = shipList[s];
                const overPad = sh.x >= base.padX - 24 && sh.x <= base.padX + base.padW + 24;
                const nearPadY = sh.y >= base.padY - 95 && sh.y <= base.padY + 16;
                if (!overPad || !nearPadY) continue;

                const isThrusting = Boolean(sh.inputs && (sh.inputs.up || sh.inputs.analogUp > 0));
                if (sh.isLanded && !isThrusting && Math.abs(sh.y - (base.padY - 14)) < 12) {
                    landedShip = sh;
                } else {
                    dangerShip = sh;
                }
            }

            this.updateAndDrawWorkers(ctx, base, landedShip, dangerShip, timeSec, dt60);
            this.updateAndDrawHauler(ctx, base, dangerShip, sparks, timeSec, dt60);
            this.updateAndDrawLadderMiner(ctx, base, dangerShip, sparks, timeSec, dt60);
            this.updateAndDrawRotorcraft(ctx, base, dangerShip, sparks, timeSec, dt60);
        }
    }

    triggerScaffoldScatter(base, launchShip) {
        const sv = base.shipService;
        if (!sv || (sv.phase !== 'scaffold_setup' && sv.phase !== 'scaffold_work')) return;
        const sx = sv.shipX;
        const sy = base.padY;
        const pieces = [
            { ox: -16, oy: -12, w: 3, h: 22, color: '#94a3b8' },
            { ox: 16, oy: -12, w: 3, h: 22, color: '#94a3b8' },
            { ox: 0, oy: -22, w: 34, h: 2.5, color: '#cbd5e1' },
            { ox: 0, oy: -12, w: 32, h: 2.0, color: '#64748b' },
            { ox: -9, oy: -18, w: 14, h: 1.5, color: '#38bdf8' },
            { ox: 9, oy: -18, w: 14, h: 1.5, color: '#f59e0b' }
        ];
        for (let i = 0; i < pieces.length; i++) {
            const p = pieces[i];
            const dir = p.ox === 0 ? (Math.random() > 0.5 ? 1 : -1) : Math.sign(p.ox);
            base.flyingScaffoldDebris.push({
                x: sx + p.ox,
                y: sy + p.oy,
                vx: dir * (1.2 + Math.random() * 2.2) + (launchShip?.vx || 0) * 0.3,
                vy: -1.8 - Math.random() * 2.0,
                angle: (Math.random() - 0.5) * 0.5,
                vAngle: (Math.random() - 0.5) * 0.28,
                w: p.w,
                h: p.h,
                color: p.color,
                life: 150 + Math.floor(Math.random() * 45),
                maxLife: 195
            });
        }
        sv.phase = 'none';
        sv.scaffoldProgress = 0;
    }

    updateAndDrawScaffoldDebris(ctx, base, dt60) {
        const list = base.flyingScaffoldDebris;
        if (!list || list.length === 0) return;
        for (let i = list.length - 1; i >= 0; i--) {
            const d = list[i];
            d.vy += 0.08 * dt60;
            d.x += d.vx * dt60;
            d.y += d.vy * dt60;
            d.angle += d.vAngle * dt60;
            if (d.y >= base.padY - 1 && d.vy > 0) {
                d.y = base.padY - 1;
                d.vy = -d.vy * 0.42;
                d.vx *= 0.72;
                d.vAngle *= 0.65;
            }
            d.life -= dt60;
            if (d.life <= 0) {
                list.splice(i, 1);
                continue;
            }
            ctx.save();
            ctx.globalAlpha = Math.min(1.0, d.life / 45);
            ctx.translate(d.x, d.y);
            ctx.rotate(d.angle);
            ctx.fillStyle = d.color;
            ctx.fillRect(-d.w * 0.5, -d.h * 0.5, d.w, d.h);
            ctx.restore();
        }
    }

    drawScaffoldRig(ctx, base) {
        const sv = base.shipService;
        if (!sv || sv.scaffoldProgress <= 0.02) return;
        const p = sv.scaffoldProgress;
        const sx = sv.shipX;
        const by = base.padY;
        const h = 26 * p;

        ctx.save();
        ctx.strokeStyle = 'rgba(148, 163, 184, 0.85)';
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        // Left & right vertical towers
        ctx.moveTo(sx - 17, by); ctx.lineTo(sx - 17, by - h);
        ctx.moveTo(sx - 13, by); ctx.lineTo(sx - 13, by - h);
        ctx.moveTo(sx + 13, by); ctx.lineTo(sx + 13, by - h);
        ctx.moveTo(sx + 17, by); ctx.lineTo(sx + 17, by - h);
        // Cross-bracing & catwalk planks
        if (p > 0.45) {
            const midY = by - 13;
            ctx.moveTo(sx - 18, midY); ctx.lineTo(sx + 18, midY);
        }
        if (p > 0.85) {
            const topY = by - 23;
            ctx.moveTo(sx - 19, topY); ctx.lineTo(sx + 19, topY);
        }
        ctx.stroke();
        ctx.restore();
    }

    updateAndDrawWorkers(ctx, base, landedShip, dangerShip, timeSec, dt60) {
        this.updateAndDrawScaffoldDebris(ctx, base, dt60);
        const sv = base.shipService;

        if (!landedShip) {
            if (sv.phase === 'scaffold_setup' || sv.phase === 'scaffold_work') {
                this.triggerScaffoldScatter(base, dangerShip);
            } else {
                sv.phase = 'none';
                sv.scaffoldProgress = 0;
            }
        } else {
            sv.shipX = landedShip.x;
            sv.shipY = landedShip.y;
            if (sv.phase === 'none') {
                sv.phase = 'quick_repair';
                sv.timer = 190 + Math.floor(Math.random() * 90);
            } else if (sv.phase === 'quick_repair') {
                sv.timer -= dt60;
                if (sv.timer <= 0) {
                    sv.phase = 'retreat';
                    sv.timer = 260 + Math.floor(Math.random() * 240);
                }
            } else if (sv.phase === 'retreat') {
                const allInside = base.workers.every(wk => Math.abs(wk.x - base.doorX) < 3.5);
                if (allInside) {
                    sv.phase = 'idle_wait';
                }
            } else if (sv.phase === 'idle_wait') {
                sv.timer -= dt60;
                if (sv.timer <= 0 && rollChance(0.008, dt60)) {
                    sv.phase = 'scaffold_setup';
                    sv.scaffoldProgress = 0;
                    sv.timer = 420 + Math.floor(Math.random() * 260);
                }
            } else if (sv.phase === 'scaffold_setup') {
                const nearShip = base.workers.some(wk => Math.abs(wk.x - landedShip.x) < 22);
                if (nearShip) {
                    sv.scaffoldProgress = Math.min(1.0, sv.scaffoldProgress + 0.022 * dt60);
                    if (sv.scaffoldProgress >= 1.0) {
                        sv.phase = 'scaffold_work';
                    }
                }
            } else if (sv.phase === 'scaffold_work') {
                sv.timer -= dt60;
                if (sv.timer <= 0) {
                    sv.scaffoldProgress = Math.max(0, sv.scaffoldProgress - 0.025 * dt60);
                    if (sv.scaffoldProgress <= 0) {
                        sv.phase = 'retreat';
                        sv.timer = 380 + Math.floor(Math.random() * 320);
                    }
                }
            }
        }

        this.drawScaffoldRig(ctx, base);

        for (let w = 0; w < base.workers.length; w++) {
            const wk = base.workers[w];
            let speed = wk.walkSpeed;
            wk.welding = false;
            let cleaningWithStick = false;
            let workerY = base.padY;

            if (dangerShip) {
                speed = wk.runSpeed * 1.35;
                const distToDanger = Math.abs(wk.x - dangerShip.x);
                if (distToDanger < 34 && Math.abs(base.doorX - dangerShip.x) < distToDanger) {
                    wk.targetX = wk.x < dangerShip.x
                        ? Math.max(base.padX + 6, dangerShip.x - 42)
                        : Math.min(base.padX + base.padW - 6, dangerShip.x + 42);
                } else {
                    wk.targetX = base.doorX;
                }
            } else if (landedShip) {
                if (sv.phase === 'quick_repair') {
                    speed = wk.runSpeed;
                    const serviceOffsets = [-11, 11, -18, 18];
                    wk.targetX = Math.max(base.padX + 6, Math.min(base.padX + base.padW - 6, landedShip.x + serviceOffsets[w % serviceOffsets.length]));
                } else if (sv.phase === 'retreat' || sv.phase === 'idle_wait') {
                    speed = wk.walkSpeed * 1.15;
                    wk.targetX = base.doorX;
                } else if (sv.phase === 'scaffold_setup' || sv.phase === 'scaffold_work') {
                    speed = wk.runSpeed;
                    const scaffOffsets = [-15, 15, -9, 9];
                    wk.targetX = Math.max(base.padX + 6, Math.min(base.padX + base.padW - 6, landedShip.x + scaffOffsets[w % scaffOffsets.length]));
                }
            } else {
                if (Math.abs(wk.x - wk.targetX) < 2.0) {
                    wk.pauseTimer -= dt60;
                    if (wk.pauseTimer <= 0) {
                        wk.pauseTimer = 70 + Math.floor(Math.random() * 110);
                        wk.targetX = (Math.random() < 0.35)
                            ? base.doorX
                            : (base.padX + 10 + Math.random() * Math.max(8, base.padW - 20));
                    }
                }
            }

            const dx = wk.targetX - wk.x;
            const isMoving = Math.abs(dx) > 1.2;
            if (isMoving) {
                wk.x += Math.sign(dx) * Math.min(Math.abs(dx), speed * dt60);
            } else if (landedShip && Math.abs(wk.x - landedShip.x) < 22) {
                if (sv.phase === 'quick_repair') {
                    wk.welding = true;
                } else if (sv.phase === 'scaffold_work' && sv.scaffoldProgress >= 0.9) {
                    cleaningWithStick = true;
                    if (w % 2 === 1) workerY = base.padY - 13; // Stand on upper scaffold plank!
                }
            }

            // Hide crew inside the base door when retreating or waiting inside
            if ((dangerShip || (landedShip && (sv.phase === 'retreat' || sv.phase === 'idle_wait'))) && Math.abs(wk.x - base.doorX) < 3.0) {
                continue;
            }

            const stride = isMoving ? Math.sin(timeSec * (speed > 0.5 ? 22 : 13) + wk.phase) * 1.8 : 0;
            const bob = isMoving ? Math.abs(Math.cos(timeSec * (speed > 0.5 ? 22 : 13) + wk.phase)) * 0.9 : 0;
            const faceDir = landedShip && !isMoving ? Math.sign(landedShip.x - wk.x) || 1 : (dx >= 0 ? 1 : -1);

            this.drawCrewMember(ctx, wk.x, workerY, {
                suitColor: wk.suitColor,
                faceDir,
                stride,
                bob
            });

            if (wk.welding && Math.sin(timeSec * 38 + wk.phase) > 0.55) {
                ctx.fillStyle = '#a8f5ff';
                ctx.beginPath();
                ctx.arc(wk.x + (landedShip.x > wk.x ? 2.5 : -2.5), base.padY - 4.5, 1.8, 0, Math.PI * 2);
                ctx.fill();
            }

            if (cleaningWithStick && landedShip) {
                const sweep = Math.sin(timeSec * 9.5 + wk.phase) * 3.2;
                const tipX = landedShip.x + (wk.x < landedShip.x ? -3 : 3);
                const tipY = landedShip.y - 4 + sweep;
                ctx.strokeStyle = '#cbd5e1';
                ctx.lineWidth = 1.1;
                ctx.beginPath();
                ctx.moveTo(wk.x + faceDir * 1.5, workerY - 4.5);
                ctx.lineTo(tipX, tipY);
                ctx.stroke();
                // Squeegee / brush head on ship window
                ctx.strokeStyle = '#38bdf8';
                ctx.lineWidth = 1.8;
                ctx.beginPath();
                ctx.moveTo(tipX - 2, tipY - 1.5);
                ctx.lineTo(tipX + 2, tipY + 1.5);
                ctx.stroke();
            }
        }
    }

    updateAndDrawRotorcraft(ctx, base, dangerShip, sparks, timeSec, dt60) {
        const rc = base.rotorcraft;
        if (!rc) return;

        if (rc.state === 'cooldown') {
            rc.timer -= dt60;
            const hasRooftopCargo = base.rooftopCargoQueue.length > 0;
            if (rc.timer <= 0 && (hasRooftopCargo || rollChance(0.0025, dt60))) {
                rc.state = 'descend';
                rc.targetX = base.structCenterX;
                rc.targetY = base.structTopY - 32;
                rc.x = rc.targetX + (Math.random() - 0.5) * 70;
                rc.y = base.structTopY - 210;
                rc.scale = 0.45;
                rc.alpha = 0.0;
                rc.tetherLen = 0;
                rc.hasCargo = false;
                rc.timer = 0;
            }
            return;
        }

        if (rc.state === 'descend') {
            rc.alpha = Math.min(0.95, rc.alpha + 0.02 * dt60);
            rc.scale = Math.min(1.0, rc.scale + 0.008 * dt60);
            const dx = rc.targetX - rc.x;
            const dy = rc.targetY - rc.y;
            rc.x += dx * 0.035 * dt60;
            rc.y += dy * 0.035 * dt60;
            rc.angle = Math.max(-0.22, Math.min(0.22, dx * 0.008));
            if (Math.hypot(dx, dy) < 6.0) {
                rc.state = 'hover_hook';
                rc.timer = 95;
            }
        } else if (rc.state === 'hover_hook') {
            rc.timer -= dt60;
            rc.x += Math.sin(timeSec * 3.2) * 0.18 * dt60;
            rc.y = rc.targetY + Math.cos(timeSec * 4.5) * 1.5;
            rc.angle *= Math.pow(0.9, dt60);
            rc.tetherLen = Math.min(22, rc.tetherLen + 0.8 * dt60);

            if (rc.timer <= 45 && !rc.hasCargo) {
                if (base.rooftopCargoQueue.length > 0) {
                    const lifted = base.rooftopCargoQueue.shift();
                    rc.hasCargo = true;
                    rc.cargoLarge = Boolean(lifted.isLarge);
                } else {
                    rc.hasCargo = true;
                    rc.cargoLarge = false;
                }
            }
            if (rc.timer <= 0) {
                rc.state = 'ascend_depth';
                rc.vx = (Math.random() > 0.5 ? 1 : -1) * (0.45 + Math.random() * 0.35);
                rc.vy = -0.55;
            }
        } else if (rc.state === 'ascend_depth') {
            rc.x += rc.vx * dt60;
            rc.y += rc.vy * dt60;
            rc.vy = Math.max(-1.35, rc.vy - 0.012 * dt60);
            rc.tetherLen = Math.max(12, rc.tetherLen - 0.25 * dt60);
            // Shrink & fade into background parallax / sibling cavern depth
            rc.scale = Math.max(0.18, rc.scale - 0.0055 * dt60);
            rc.alpha = Math.max(0, rc.alpha - 0.0065 * dt60);
            rc.angle = rc.vx * 0.18;
            if (rc.alpha <= 0.01 || rc.scale <= 0.20) {
                rc.state = 'cooldown';
                rc.timer = 600 + Math.floor(Math.random() * 720);
                return;
            }
        }

        ctx.save();
        ctx.translate(rc.x, rc.y);
        ctx.scale(rc.scale, rc.scale);
        ctx.globalAlpha = rc.alpha;

        // Tether cable & airlifted cargo crate
        if (rc.tetherLen > 1) {
            const swayX = Math.sin(timeSec * 5.2) * 2.5;
            ctx.strokeStyle = '#94a3b8';
            ctx.lineWidth = 1.1;
            ctx.beginPath();
            ctx.moveTo(0, 5);
            ctx.lineTo(swayX, 5 + rc.tetherLen);
            ctx.stroke();
            if (rc.hasCargo) {
                this.drawPadCargoCrate(ctx, {
                    x: swayX,
                    y: 5 + rc.tetherLen + 5,
                    size: rc.cargoLarge ? 13 : 10,
                    isLarge: rc.cargoLarge,
                    angle: swayX * 0.04
                });
            }
        }

        ctx.rotate(rc.angle);
        // Coaxial rotorcraft fuselage
        ctx.fillStyle = '#1e293b';
        ctx.strokeStyle = '#475569';
        ctx.lineWidth = 1.3;
        ctx.beginPath();
        ctx.moveTo(-14, 2);
        ctx.lineTo(-8, -5);
        ctx.lineTo(9, -5);
        ctx.lineTo(15, 1);
        ctx.lineTo(10, 5);
        ctx.lineTo(-10, 5);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        // Cockpit canopy & nav beacon
        ctx.fillStyle = '#00f2fe';
        ctx.fillRect(4, -3.5, 6, 3.5);
        if (Math.sin(timeSec * 12) > 0) {
            ctx.fillStyle = '#ef4444';
            ctx.fillRect(-12, -1, 2.2, 2.2);
        }

        // Dual counter-rotating blurred rotor blades
        ctx.strokeStyle = '#cbd5e1';
        ctx.lineWidth = 1.2;
        const bladeSpan1 = Math.sin(timeSec * 48) * 22;
        const bladeSpan2 = Math.cos(timeSec * 48) * 20;
        ctx.beginPath();
        ctx.moveTo(0, -5); ctx.lineTo(0, -10);
        ctx.moveTo(-bladeSpan1, -10); ctx.lineTo(bladeSpan1, -10);
        ctx.moveTo(-bladeSpan2, -7.5); ctx.lineTo(bladeSpan2, -7.5);
        ctx.stroke();
        ctx.restore();
    }

    updateAndDrawLadderMiner(ctx, base, dangerShip, sparks, timeSec, dt60) {
        const m = base.miner;
        if (!m) return;

        for (let i = 0; i < m.dugCaves.length; i++) {
            const dc = m.dugCaves[i];
            this.drawSubterraneanPocket(ctx, dc.x, dc.y, dc.rx, dc.ry, dc.seed);
        }

        if (m.caveRadius > 0.5) {
            this.drawSubterraneanPocket(ctx, m.targetX, base.padY + m.ladderLen, m.caveRadius * 1.25, m.caveRadius * 0.85, m.caveSeed);
        }

        if (m.ladderExt > 0.02) {
            const curLen = m.ladderLen * m.ladderExt;
            const lx = m.targetX;
            const topY = base.padY;
            const botY = topY + curLen;

            ctx.strokeStyle = '#94a3b8';
            ctx.lineWidth = 1.2;
            ctx.beginPath();
            ctx.moveTo(lx - 2.4, topY);
            ctx.lineTo(lx - 2.4, botY);
            ctx.moveTo(lx + 2.4, topY);
            ctx.lineTo(lx + 2.4, botY);
            for (let ry = topY + 4; ry < botY - 1; ry += 4.5) {
                ctx.moveTo(lx - 2.4, ry);
                ctx.lineTo(lx + 2.4, ry);
            }
            ctx.stroke();
        }

        if (m.state === 'idle') {
            m.timer -= dt60;
            if (!dangerShip && m.timer <= 0 && rollChance(0.004, dt60)) {
                const spotX = this.findDigSpotX(base, base.doorX, m.dugCaves, Math.random);
                if (spotX === null) {
                    m.timer = 600;
                    return;
                }
                m.targetX = spotX;
                m.x = base.doorX;
                m.y = base.padY;
                m.ladderExt = 0;
                m.caveRadius = 0;
                m.caveSeed = Math.random() * 100;
                m.hasSack = false;
                m.state = 'walk_out';
            }
            return;
        }

        if (dangerShip && (m.state === 'walk_out' || m.state === 'carry_in')) {
            m.state = 'carry_in';
        }

        if (m.state === 'walk_out') {
            const dx = m.targetX - m.x;
            if (Math.abs(dx) > 1.2) {
                m.x += Math.sign(dx) * Math.min(Math.abs(dx), 0.42 * dt60);
            } else {
                m.x = m.targetX;
                m.state = 'deploy_ladder';
            }
        } else if (m.state === 'deploy_ladder') {
            m.ladderExt = Math.min(1.0, m.ladderExt + 0.025 * dt60);
            if (m.ladderExt >= 1.0) {
                m.state = 'climb_down';
            }
        } else if (m.state === 'climb_down') {
            const targetY = base.padY + m.ladderLen;
            m.y = Math.min(targetY, m.y + 0.35 * dt60);
            if (m.y >= targetY) {
                m.state = 'digging';
                m.timer = 150;
            }
        } else if (m.state === 'digging') {
            m.timer -= dt60;
            m.caveRadius = Math.min(9.5, m.caveRadius + 0.055 * dt60);
            if (rollChance(0.35, dt60) && sparks.length < 90) {
                sparks.push({
                    x: m.x + (Math.random() - 0.5) * 5,
                    y: m.y - 3,
                    vx: (Math.random() - 0.5) * 1.1,
                    vy: -0.4 - Math.random() * 0.8,
                    gravity: 0.07,
                    life: 14,
                    maxLife: 14,
                    size: 1.4,
                    color: Math.random() > 0.3 ? '#8c5b37' : '#ffd700'
                });
            }
            if (m.timer <= 0) {
                if (m.dugCaves.length < 4) {
                    m.dugCaves.push({
                        x: m.targetX,
                        y: base.padY + m.ladderLen,
                        rx: m.caveRadius * (1.15 + (Math.sin(m.caveSeed) * 0.2)),
                        ry: m.caveRadius * (0.78 + (Math.cos(m.caveSeed) * 0.15)),
                        seed: m.caveSeed
                    });
                }
                m.caveRadius = 0;
                m.hasSack = true;
                m.state = 'climb_up';
            }
        } else if (m.state === 'climb_up') {
            m.y = Math.max(base.padY, m.y - 0.28 * dt60);
            if (m.y <= base.padY) {
                m.y = base.padY;
                m.state = 'retract_ladder';
            }
        } else if (m.state === 'retract_ladder') {
            m.ladderExt = Math.max(0.0, m.ladderExt - 0.03 * dt60);
            if (m.ladderExt <= 0.0) {
                m.state = 'carry_in';
            }
        } else if (m.state === 'carry_in') {
            const dx = base.doorX - m.x;
            if (Math.abs(dx) > 1.2) {
                m.x += Math.sign(dx) * Math.min(Math.abs(dx), (dangerShip ? 0.75 : 0.32) * dt60);
            } else {
                m.state = 'idle';
                m.timer = 420 + Math.floor(Math.random() * 480);
                return;
            }
        }

        const isClimbing = m.state === 'climb_down' || m.state === 'climb_up';
        const isDigging = m.state === 'digging';
        const isWalking = m.state === 'walk_out' || m.state === 'carry_in';
        const faceDir = (m.state === 'carry_in') ? Math.sign(base.doorX - m.x) : Math.sign(m.targetX - base.doorX);
        const stride = (isWalking || isClimbing) ? Math.sin(timeSec * 16 + m.phase) * 1.6 : 0;
        const bob = isWalking ? Math.abs(Math.cos(timeSec * 16 + m.phase)) * 0.8 : (isDigging ? Math.sin(timeSec * 28) * 1.1 : 0);

        this.drawCrewMember(ctx, m.x, m.y, {
            suitColor: '#a855f7',
            faceDir: faceDir || 1,
            stride,
            bob,
            leanX: (m.hasSack && isWalking) ? (faceDir * 1.6) : 0,
            carryingSack: m.hasSack,
            climbing: isClimbing
        });
    }

    drawSubterraneanPocket(ctx, x, y, rx, ry = rx * 0.8, seed = 1.0) {
        ctx.save();
        ctx.fillStyle = 'rgba(7, 4, 3, 0.88)';
        ctx.strokeStyle = 'rgba(140, 91, 55, 0.55)';
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        const steps = 11;
        for (let i = 0; i < steps; i++) {
            const a = (i / steps) * Math.PI * 2;
            // Irregular cave-like rock chamber profile (flatter floor, jagged ceiling arch)
            const jag = 0.78 + 0.28 * Math.sin(a * 3.0 + seed) + 0.16 * Math.cos(a * 5.0 - seed * 1.7);
            const flatFloor = Math.sin(a) > 0.25 ? 0.68 : 1.0;
            const px = x + Math.cos(a) * rx * jag;
            const py = (y - 2) + Math.sin(a) * ry * jag * flatFloor;
            if (i === 0) ctx.moveTo(px, py);
            else ctx.lineTo(px, py);
        }
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.restore();
    }

    updateAndDrawHauler(ctx, base, dangerShip, sparks, timeSec, dt60) {
        const stack = base.cargoStack;
        const h = base.hauler;
        if (!h) return;

        let currentFloorY = base.padY;
        for (let i = 0; i < stack.length; i++) {
            const c = stack[i];
            const targetY = currentFloorY - c.size * 0.5;
            if (c.y < targetY - 0.2 || Math.abs(c.vy) > 0.05) {
                c.vy += 0.14 * dt60;
                c.x += c.vx * dt60;
                c.y += c.vy * dt60;
                c.angle += c.vAngle * dt60;
                c.x = Math.max(base.padX + 8, Math.min(base.padX + base.padW - 8, c.x));
                if (c.y >= targetY) {
                    c.y = targetY;
                    if (c.vy > 0.9 && sparks.length < 90) {
                        sparks.push({
                            x: c.x, y: base.padY,
                            vx: (Math.random() - 0.5) * 1.2, vy: -0.6 - Math.random() * 0.6,
                            gravity: 0.08, life: 12, maxLife: 12, size: 1.3, color: '#ffd260'
                        });
                    }
                    c.vy = -c.vy * 0.28;
                    c.vx *= 0.6;
                    c.vAngle *= 0.5;
                    if (Math.abs(c.vy) < 0.18) {
                        c.vy = 0;
                        c.vx = 0;
                        c.vAngle = 0;
                    }
                }
            } else {
                c.y = targetY;
                c.angle *= Math.pow(0.82, dt60);
            }
            currentFloorY = c.y - c.size * 0.5;
            this.drawPadCargoCrate(ctx, c);
        }

        if (h.state === 'idle') {
            if (!dangerShip && stack.length > 0) {
                h.state = 'fetching';
            } else {
                return;
            }
        }

        if (h.state === 'fetching') {
            if (stack.length === 0) {
                h.state = 'idle';
                return;
            }
            const bottomCrate = stack[0];
            const stopSide = Math.sign(base.doorX - bottomCrate.x) || -1;
            const hookX = bottomCrate.x + stopSide * (bottomCrate.size * 0.5 + 4);
            const dx = hookX - h.x;
            if (Math.abs(dx) > 1.5) {
                h.x += Math.sign(dx) * Math.min(Math.abs(dx), 0.78 * dt60);
            } else {
                h.state = 'attaching';
                h.timer = 22;
            }
        } else if (h.state === 'attaching') {
            h.timer -= dt60;
            if (h.timer <= 0) {
                if (stack.length === 0) {
                    h.state = 'idle';
                    return;
                }
                const yanked = stack.shift();
                const pullDir = Math.sign(base.doorX - yanked.x) || -1;
                h.draggedCrate = yanked;
                h.state = 'dragging';

                for (let i = 0; i < stack.length; i++) {
                    const upper = stack[i];
                    upper.vy = -0.35 - i * 0.15;
                    upper.vx = -pullDir * (0.45 + Math.random() * 0.55) + (Math.random() - 0.5) * 0.35;
                    upper.vAngle = -pullDir * (0.06 + Math.random() * 0.08);
                }
            }
        } else if (h.state === 'dragging') {
            const dc = h.draggedCrate;
            if (!dc) {
                h.state = 'idle';
                return;
            }
            const pullDir = Math.sign(base.doorX - dc.x) || -1;
            const heavePulse = 0.35 + 0.65 * Math.pow(Math.max(0, Math.sin(timeSec * 5.5 + h.phase)), 2);
            const weightFactor = dc.isLarge ? 0.19 : 0.27;
            const step = weightFactor * heavePulse * dt60;

            const ropeLen = 13;
            h.x += pullDir * step;
            const desiredCrateX = h.x - pullDir * ropeLen;
            if ((pullDir > 0 && dc.x < desiredCrateX) || (pullDir < 0 && dc.x > desiredCrateX)) {
                dc.x = desiredCrateX;
            }
            dc.y = base.padY - dc.size * 0.5;
            dc.angle = Math.sin(timeSec * 11 + h.phase) * 0.04;

            if (heavePulse > 0.75 && rollChance(0.18, dt60) && sparks.length < 90) {
                sparks.push({
                    x: dc.x - pullDir * (dc.size * 0.4),
                    y: base.padY,
                    vx: -pullDir * (0.4 + Math.random() * 0.5),
                    vy: -0.3 - Math.random() * 0.4,
                    gravity: 0.06, life: 10, maxLife: 10, size: 1.1, color: '#f59e0b'
                });
            }

            this.drawPadCargoCrate(ctx, dc);

            ctx.strokeStyle = '#d6bc8b';
            ctx.lineWidth = 1.2;
            ctx.beginPath();
            ctx.moveTo(h.x - pullDir * 1.5, base.padY - 3.8);
            ctx.lineTo(dc.x + pullDir * (dc.size * 0.5), dc.y);
            ctx.stroke();

            if (Math.abs(dc.x - base.doorX) < 5.0) {
                base.rooftopCargoQueue.push({ isLarge: dc.isLarge, size: dc.size });
                h.draggedCrate = null;
                h.state = stack.length > 0 ? 'fetching' : 'idle';
                return;
            }
        }

        const isDragging = h.state === 'dragging';
        const moveDir = isDragging
            ? (Math.sign(base.doorX - h.x) || -1)
            : (stack[0] ? (Math.sign(stack[0].x - h.x) || 1) : 1);
        const leanX = isDragging ? (moveDir * 2.8) : 0;
        const cycle = timeSec * (isDragging ? 11 : 18) + h.phase;
        const stride = (h.state === 'attaching') ? 0 : Math.sin(cycle) * (isDragging ? 2.2 : 1.7);
        const bob = (h.state === 'attaching') ? 1.2 : Math.abs(Math.cos(cycle)) * 0.8;

        this.drawCrewMember(ctx, h.x, base.padY, {
            suitColor: '#10b981',
            faceDir: moveDir,
            stride,
            bob,
            leanX
        });
    }

    drawPadCargoCrate(ctx, c) {
        ctx.save();
        ctx.translate(c.x, c.y);
        ctx.rotate(c.angle || 0);
        const hs = c.size * 0.5;
        ctx.fillStyle = c.isLarge ? '#2c1e14' : '#1e2417';
        ctx.strokeStyle = c.isLarge ? '#e67e22' : '#f1c40f';
        ctx.lineWidth = 1.3;
        ctx.fillRect(-hs, -hs, c.size, c.size);
        ctx.strokeRect(-hs, -hs, c.size, c.size);
        ctx.fillStyle = c.isLarge ? '#f39c12' : '#f1c40f';
        ctx.fillRect(-hs + 2, -1, c.size - 4, 2);
        ctx.restore();
    }
}