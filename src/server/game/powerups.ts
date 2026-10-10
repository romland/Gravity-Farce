import { Registry, type Entity } from '../core/ecs';
import type { Room } from '../Room';

const POWERUP_CHARGES: Record<number, number> = {
    0xD0: 50000,
    0xD5: 150,
    0xD6: 100,
    0xD7: 100,
    0xD8: 100
};

export function spawnPowerup(ecs: Registry, x: number, y: number, typeId: number): Entity {
    const e = ecs.create();
    ecs.transforms.set(e, { x, y, angle: 0 });
    ecs.powerups.set(e, {
        active: true,
        typeId,
        charges: POWERUP_CHARGES[typeId] || 100,
        width: 32,
        height: 32
    });
    return e;
}

export function sysPowerups(ecs: Registry, room: Room) {
    if (!room.level || !room.level.rawMap) return;

    for (const [pe, p] of ecs.players.entries()) {
        if (p.isDead) continue;
        const pt = ecs.transforms.get(pe)!;

        for (const [pue, powerup] of ecs.powerups.entries()) {
            if (!powerup.active) continue;
            const put = ecs.transforms.get(pue)!;

            if (p.isLanded && Math.hypot(pt.x - put.x, pt.y - put.y) < 48) {
                powerup.active = false;
                if (powerup.typeId === 0xD0) {
                    p.fuel = Math.min(99999, (p.fuel || 0) + powerup.charges);
                    ecs.events.push({ type: 'floating_text', text: 'FUEL +50000', color: '#e67e22', x: put.x, y: put.y - 30 });
                    room.tracker.logEvent(p.id, { type: 'fuel_taken', amount: powerup.charges, x: put.x, y: put.y });
                } else if (powerup.typeId === 0xD6) {
                    p.doubleShotAmmo = (p.doubleShotAmmo || 0) + powerup.charges;
                    ecs.events.push({ type: 'floating_text', text: 'DOUBLE SHOT', color: '#2ecc71', x: put.x, y: put.y - 30 });
                    room.tracker.logEvent(p.id, { type: 'powerup_taken', typeId: powerup.typeId, x: put.x, y: put.y });
                } else {
                    p.doubleShotAmmo = (p.doubleShotAmmo || 0) + powerup.charges;
                    ecs.events.push({ type: 'floating_text', text: 'POWERUP', color: '#9b59b6', x: put.x, y: put.y - 30 });
                    room.tracker.logEvent(p.id, { type: 'powerup_taken', typeId: powerup.typeId, x: put.x, y: put.y });
                }

                ecs.events.push({ type: 'sound', soundId: 11, x: put.x, y: put.y });
                ecs.events.push({ type: 'poof', x: put.x, y: put.y });
                ecs.destroy(pue);

                const tileX = Math.floor(put.x / 32);
                const tileY = Math.floor(put.y / 32);
                if (room.level.rawMap[tileY]?.[tileX] !== undefined) {
                    room.level.rawMap[tileY][tileX] = 0x00;
                    room.broadcastTileUpdate(tileX, tileY, 0x00);
                }
            }
        }
    }
}