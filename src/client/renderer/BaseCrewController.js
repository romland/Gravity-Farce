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
            for (const b of baseStructs) {
                if (Math.abs((b.x + b.w * 0.5) - (pad.x + pad.w * 0.5)) < pad.w + 96 && Math.abs((b.y + b.h) - pad.y) < 64) {
                    doorX = Math.max(pad.x + 6, Math.min(pad.x + pad.w - 6, b.x + b.w * 0.5));
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

            const digSpotX = this.findDigSpotX(pad, doorX, rng);

            this.bases.push({
                padX: pad.x,
                padY: pad.y,
                padW: pad.w,
                doorX,
                workers,
                cargoStack: [],
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
                    timer: 180 + Math.floor(rng() * 240),
                    hasSack: false,
                    phase: rng() * Math.PI * 2,
                    dugCaves: []
                }
            });
        }
    }

    findDigSpotX(pad, doorX, rng) {
        const minX = pad.x + 10;
        const maxX = pad.x + pad.w - 10;
        if (maxX <= minX) return pad.x + pad.w * 0.5;
        for (let attempt = 0; attempt < 6; attempt++) {
            const cx = minX + rng() * (maxX - minX);
            if (Math.abs(cx - doorX) > 14) return cx;
        }
        return pad.x + pad.w * 0.7;
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
        }
    }

    updateAndDrawWorkers(ctx, base, landedShip, dangerShip, timeSec, dt60) {
        for (let w = 0; w < base.workers.length; w++) {
            const wk = base.workers[w];
            let speed = wk.walkSpeed;
            wk.welding = false;

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
                speed = wk.runSpeed;
                const serviceOffsets = [-11, 11, -18, 18];
                wk.targetX = Math.max(base.padX + 6, Math.min(base.padX + base.padW - 6, landedShip.x + serviceOffsets[w % serviceOffsets.length]));
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
                wk.welding = true;
            }

            if (dangerShip && Math.abs(wk.x - base.doorX) < 3.0) continue;

            const stride = isMoving ? Math.sin(timeSec * (speed > 0.5 ? 22 : 13) + wk.phase) * 1.8 : 0;
            const bob = isMoving ? Math.abs(Math.cos(timeSec * (speed > 0.5 ? 22 : 13) + wk.phase)) * 0.9 : 0;

            this.drawCrewMember(ctx, wk.x, base.padY, {
                suitColor: wk.suitColor,
                faceDir: dx >= 0 ? 1 : -1,
                stride,
                bob
            });

            if (wk.welding && Math.sin(timeSec * 38 + wk.phase) > 0.55) {
                ctx.fillStyle = '#a8f5ff';
                ctx.beginPath();
                ctx.arc(wk.x + (landedShip.x > wk.x ? 2.5 : -2.5), base.padY - 4.5, 1.8, 0, Math.PI * 2);
                ctx.fill();
            }
        }
    }

    updateAndDrawLadderMiner(ctx, base, dangerShip, sparks, timeSec, dt60) {
        const m = base.miner;
        if (!m) return;

        for (let i = 0; i < m.dugCaves.length; i++) {
            const dc = m.dugCaves[i];
            this.drawSubterraneanPocket(ctx, dc.x, dc.y, dc.r);
        }

        if (m.caveRadius > 0.5) {
            this.drawSubterraneanPocket(ctx, m.targetX, base.padY + m.ladderLen, m.caveRadius);
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
                m.targetX = base.padX + 12 + Math.random() * Math.max(8, base.padW - 24);
                if (Math.abs(m.targetX - base.doorX) < 12) {
                    m.targetX = Math.min(base.padX + base.padW - 10, base.doorX + 18);
                }
                m.x = base.doorX;
                m.y = base.padY;
                m.ladderExt = 0;
                m.caveRadius = 0;
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
                    m.dugCaves.push({ x: m.targetX, y: base.padY + m.ladderLen, r: m.caveRadius });
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

    drawSubterraneanPocket(ctx, x, y, r) {
        ctx.save();
        ctx.fillStyle = 'rgba(7, 4, 3, 0.88)';
        ctx.strokeStyle = 'rgba(140, 91, 55, 0.55)';
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.arc(x, y - 2, r, 0, Math.PI * 2);
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