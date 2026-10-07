import { Registry, type Entity } from '../core/ecs';
import type { Room } from '../Room';

export function spawnCargo(ecs: Registry, x: number, y: number, typeId: number): Entity {
    const e = ecs.create();
    ecs.transforms.set(e, { x, y, angle: 0 });
    ecs.cargos.set(e, {
        active: true,
        typeId,
        weight: typeId === 0xD1 ? 1 : 2,
        scoreValue: typeId === 0xD1 ? 5 : 7,
        width: 32,
        height: 32
    });
    return e;
}

export function sysCargo(ecs: Registry, room: Room) {
    if (!room.level || !room.level.rawMap) return;

    for (const [pe, p] of ecs.players.entries()) {
        if (p.isDead) continue;
        const pt = ecs.transforms.get(pe)!;

        // 1. Homebase Unloading Logic
        if (p.isLanded && p.cargoStack.length > 0) {
            const tileX = Math.floor(pt.x / 32);
            const tileY = Math.floor(pt.y / 32) + 1; // Inspect the tile directly beneath the ship
            const tileId = room.level.rawMap[tileY]?.[tileX];
            const isHomePad = tileId === 0x15 || tileId === 0x1B || tileId === 0x28 || tileId === 0x29;

            if (isHomePad) {
                if (p.unloadTimer > 0) {
                    p.unloadTimer--;
                } else {
                    const crateId = p.cargoStack.pop()!;
                    p.score += (crateId === 0xD1 ? 5 : 7);
                    p.unloadTimer = 30; // Frame cooldown between unloading crates
                    ecs.events.push({ type: 'sound', soundId: 10, x: pt.x, y: pt.y });
                }
            } else {
                p.unloadTimer = 0;
            }
        } else {
            p.unloadTimer = 0;
        }

        // 2. Authoritative World Pickup
        const currentWeight = p.cargoStack.reduce((sum, id) => sum + (id === 0xD1 ? 1 : 2), 0);
        for (const [ce, cargo] of ecs.cargos.entries()) {
            if (!cargo.active) continue;
            const ct = ecs.transforms.get(ce)!;

            if (Math.hypot(pt.x - ct.x, pt.y - ct.y) < 24 && currentWeight + cargo.weight <= 3) {
                cargo.active = false;
                p.cargoStack.push(cargo.typeId);
                ecs.events.push({ type: 'sound', soundId: 9, x: pt.x, y: pt.y });
                ecs.events.push({ type: 'poof', x: ct.x, y: ct.y });
                ecs.destroy(ce);
                
                // Authoritatively clear the tile to sync the visuals for all clients
                const cTileX = Math.floor(ct.x / 32);
                const cTileY = Math.floor(ct.y / 32);
                if (room.level.rawMap[cTileY]?.[cTileX] !== undefined) {
                    room.level.rawMap[cTileY][cTileX] = 0x00;
                    room.broadcastTileUpdate(cTileX, cTileY, 0x00);
                }
            }
        }
    }
}