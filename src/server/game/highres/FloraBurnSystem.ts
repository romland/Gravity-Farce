import type { Registry } from '../../core/ecs';
import type { Room } from '../../Room';
import { TILE_DICTIONARY } from '../../core/tiles';

export const SERVER_FLORA_BURN_CONFIG = {
    enabled: true,
    nozzleOffsetPx: 14,       // Distance from ship center to rear thruster nozzle
    jetLengthPx: 42,          // Length of hot exhaust plume behind the nozzle
    jetRadiusPx: 22,          // Radius of exhaust cone capable of igniting flora
    thrustHeatPerTick: 1.0,   // Heat accumulated per tick of direct exhaust contact
    heatDecayPerTick: 0.15,   // Cooling rate when thruster stops hitting the plant
    igniteThresholdTicks: 5.0 // Cumulative thrust ticks required to ignite
};

export interface FloraBurnRecord {
    originT: number;
    ignitedAtTick: number;
}

export class FloraBurnSystem {
    public static update(ecs: Registry, room: Room) {
        if (!SERVER_FLORA_BURN_CONFIG.enabled) return;
        const flora = room.level?.highRes?.flora;
        if (!flora || flora.length === 0) return;

        const cfg = SERVER_FLORA_BURN_CONFIG;
        const rawMap = room.level?.rawMap;

        for (const [pe, p] of ecs.players.entries()) {
            if (p.isDead || p.isLanded || !p.inputs.up) continue;
            const f = ecs.fuelTanks.get(pe);
            if (!f || f.current <= 0) continue;
            const t = ecs.transforms.get(pe);
            if (!t) continue;

            // Exhaust points opposite to ship nose angle
            const backX = -Math.cos(t.angle);
            const backY = -Math.sin(t.angle);
            const buttX = t.x + backX * cfg.nozzleOffsetPx;
            const buttY = t.y + backY * cfg.nozzleOffsetPx;
            const plumeEndX = buttX + backX * cfg.jetLengthPx;
            const plumeEndY = buttY + backY * cfg.jetLengthPx;

            for (let idx = 0; idx < flora.length; idx++) {
                if (room.floraBurns.has(idx)) continue;
                const a = flora[idx];
                if (a.kind === 'DRIP_EMITTER' || a.length <= 0) continue;

                // Quick horizontal bounding reject
                if (Math.abs(a.x - buttX) > cfg.jetLengthPx + cfg.jetRadiusPx + 36) continue;

                const dirY = a.kind === 'VINE' ? 1 : -1;
                const minY = dirY > 0 ? a.y : a.y - a.length;
                const maxY = dirY > 0 ? a.y + a.length : a.y;
                if (maxY < Math.min(buttY, plumeEndY) - cfg.jetRadiusPx) continue;
                if (minY > Math.max(buttY, plumeEndY) + cfg.jetRadiusPx) continue;

                // Sample 3 points along the hot exhaust plume behind the ship butt
                let bestDist = Infinity;
                let hitY = buttY;
                for (const s of [0.2, 0.6, 1.0]) {
                    const px = buttX + (plumeEndX - buttX) * s;
                    const py = buttY + (plumeEndY - buttY) * s;
                    if (rawMap) {
                        const tid = rawMap[Math.floor(py / 32)]?.[Math.floor(px / 32)] ?? 0;
                        if (TILE_DICTIONARY[tid]?.solid || TILE_DICTIONARY[tid]?.pad) break;
                    }
                    const clampedY = Math.max(minY, Math.min(maxY, py));
                    // Enforce that the contact point on the plant lies strictly behind the ship nozzle
                    const dotRear = (a.x - buttX) * backX + (clampedY - buttY) * backY;
                    if (dotRear < -4) continue;

                    const d = Math.hypot(px - a.x, py - clampedY);
                    if (d < bestDist) {
                        bestDist = d;
                        hitY = clampedY;
                    }
                }

                if (bestDist <= cfg.jetRadiusPx) {
                    const prevHeat = room.floraHeat.get(idx) || 0;
                    const nextHeat = prevHeat + cfg.thrustHeatPerTick;
                    if (nextHeat >= cfg.igniteThresholdTicks) {
                        const rawT = Math.abs(hitY - a.y) / Math.max(1, a.length);
                        const originT = Number(Math.max(0.05, Math.min(0.95, rawT)).toFixed(2));
                        room.floraBurns.set(idx, {
                            originT,
                            ignitedAtTick: room.globalWaveTimer
                        });
                        room.floraHeat.delete(idx);
                        room.broadcastFloraBurn(idx, originT);
                    } else {
                        room.floraHeat.set(idx, nextHeat);
                    }
                }
            }
        }

        // Cool down un-ignited plants
        if (room.floraHeat.size > 0) {
            for (const [idx, heat] of room.floraHeat.entries()) {
                const cooled = heat - cfg.heatDecayPerTick;
                if (cooled <= 0) room.floraHeat.delete(idx);
                else room.floraHeat.set(idx, cooled);
            }
        }
    }
}