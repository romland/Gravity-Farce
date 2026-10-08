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
        height: 32,
        tileX: Math.floor(x / 32),
        tileY: Math.floor(y / 32)
    });
    return e;
}

export function sysCargo(ecs: Registry, room: Room) {
    if (!room.level || !room.level.rawMap) return;

    for (const [pe, p] of ecs.players.entries()) {
        if (p.isDead) {
            if (p.cargoStack.length > 0) {
                // IMPNOTE: The Hard Reset - Authentic Amiga punishment. 
                // Cargo instantly respawns at its original starting coordinates if the player explodes.
                p.cargoStack = [];
                for (const [ce, cargo] of ecs.cargos.entries()) {
                    if (cargo.heldBy === p.id) {
                        cargo.active = true;
                        cargo.heldBy = undefined;
                        if (room.level.rawMap[cargo.tileY]?.[cargo.tileX] !== undefined) {
                            room.level.rawMap[cargo.tileY][cargo.tileX] = cargo.typeId;
                            room.broadcastTileUpdate(cargo.tileX, cargo.tileY, cargo.typeId);
                        }
                    }
                }
            }
            continue;
        }
        const pt = ecs.transforms.get(pe)!;

        // 1. Homebase Unloading Logic
        if (p.isLanded && p.cargoStack.length > 0) {
            const tileX = Math.floor(pt.x / 32);
            const tileY = Math.floor(pt.y / 32) + 1; // Inspect the tile directly beneath the ship
            const tileId = room.level.rawMap[tileY]?.[tileX];
            const isHomePad = tileId === 0x15 || tileId === 0x1B || tileId === 0x28 || tileId === 0x29;

            let isAtStartBase = false;
            for (const ent of room.level.entities) {
                if (ent.type === 'spawn') {
                    if (Math.hypot(pt.x - ent.x, pt.y - ent.y) < 150) {
                        isAtStartBase = true;
                        break;
                    }
                }
            }

            if (isHomePad && isAtStartBase) {
                if (p.unloadTimer > 0) {
                    p.unloadTimer--;
                } else {
                    const crateId = p.cargoStack.pop()!;
                    const points = crateId === 0xD1 ? 5 : 7;
                    p.score += points;
                    p.unloadTimer = 30; // Frame cooldown between unloading crates
                    ecs.events.push({ type: 'sound', soundId: 10, x: pt.x, y: pt.y });
                    ecs.events.push({ type: 'floating_text', text: `CARGO SECURED (+${points})`, color: '#2ecc71', x: pt.x, y: pt.y - 30 });

                    // Fully destroy the entity now that it is secured
                    for (const [ce, cargo] of ecs.cargos.entries()) {
                        if (cargo.heldBy === p.id && cargo.typeId === crateId && !cargo.active) {
                            ecs.destroy(ce);
                            break;
                        }
                    }
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

            if (p.isLanded && Math.hypot(pt.x - ct.x, pt.y - ct.y) < 48 && currentWeight + cargo.weight <= 3) {
                cargo.active = false;
                cargo.heldBy = p.id;
                p.cargoStack.push(cargo.typeId);
                ecs.events.push({ type: 'sound', soundId: 9, x: pt.x, y: pt.y });
                ecs.events.push({ type: 'poof', x: ct.x, y: ct.y });
                ecs.events.push({ type: 'floating_text', text: 'CARGO ACQUIRED', color: '#f39c12', x: pt.x, y: pt.y - 30 });
                
                // Authoritatively clear the tile to sync the visuals for all clients
                if (room.level.rawMap[cargo.tileY]?.[cargo.tileX] !== undefined) {
                    room.level.rawMap[cargo.tileY][cargo.tileX] = 0x00;
                    room.broadcastTileUpdate(cargo.tileX, cargo.tileY, 0x00);
                }
            }
        }
    }

    let totalMapCargo = 0;
    for (const [ce, cargo] of ecs.cargos.entries()) {
        if (cargo.active) totalMapCargo++;
    }
    let totalPlayerCargo = 0;
    for (const [oe, op] of ecs.players.entries()) {
        if (!op.isDead) totalPlayerCargo += op.cargoStack.length;
    }
    const totalCargoRemaining = totalMapCargo + totalPlayerCargo;

    if (totalCargoRemaining === 0 && room.initialCargoCount > 0) {
        for (const [pe, p] of ecs.players.entries()) {
            if (!p.advancing) {
                p.advancing = true;
                const pt = ecs.transforms.get(pe);
                if (pt) {
                    ecs.events.push({ type: 'floating_text', text: 'CAVERN SECURED', color: '#4facfe', x: pt.x, y: pt.y - 60 });
                }
                setTimeout(() => room.transitionPlayer(p.id), 3000);
            }
        }
    }
}
