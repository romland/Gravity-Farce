# Amiga Homing Missile & Enemy AI Architecture

This document details the reverse-engineered execution flow, memory structures, and tracking logic for guided missiles and dynamic entities in Gravity Force, traced directly from 68k assembly.

---

## 1. Core Memory Map & Subroutines

| Address | Type | Description |
| --- | --- | --- |
| **`$00031570`** | Table Base | Master Enemy/Missile Specification Table (**22 bytes / `$16` per entry**). |
| **`$00036188`** | Trajectory Array | Precompiled directional delta stepping tables for entity guidance/pathing. |
| **`$00034AC4`** | Routine | Proximity & Range Scanner Loop (checks player distance against `#$0030` tile delta). |
| **`$000348BE`** | Routine | Motion Queue Parameter-Packer (pushes `vx, vy` deltas into scratchpad buffer). |
| **`$000348EA`** | Routine | Projectile/Entity Integration Loop (scales by `1000` / `#$03e8`, checks bitmask terrain at `$00056000`, and updates world coordinates). |
| **`$00034C6A`** | Scratchpad Buffer | Active motion queue buffer holding active entity trajectory updates per frame. |

---

## 2. How We Traced It (Top-Down Execution Path)

1. **Eliminating Subsystems:** By systematically mapping input polling, viewport rendering, sound channels, palette cycling, and Y-physics integration, we isolated the remaining unmapped routines in the main alive-player loop (`$0003000A`).
2. **Proximity Scanning (`$00034AC4`):** Tracing down the execution tree revealed an active iterator looping through an entity descriptor list (`a2`), checking for the list terminator (`#$ffff`), and comparing the player's world coordinates (`d5`, `d6`) against entity offsets (`+$04`, `+$08`) to determine activation range.
3. **Entity Specification Indexing (`$00034B52`):** Once within range, the engine reads the entity ID from the descriptor, multiplies by the struct size (`22 bytes`), and indexes into the master spec table at `$00031570`.
4. **Trajectory & Motion Dispatch (`$00034B68` & `$000348BE`):** Instead of calculating complex floating-point vectors every frame, guidance logic steps through directional delta tables stored at `$00036188`, packs them via `$000348BE`, and hands them to the movement integration loop at `$000348EA`.

---

## 3. Entity Struct Layout ($00031570 Table)

Each entry in the master enemy spec table occupies **22 bytes** (`$16`):

* **Offset `+$00` to `+$10`:** Position coordinates, state flags, and type identifiers.
* **Offset `+$12`:** Movement velocity multiplier / tracking sensitivity.
* **Offset `+$14`:** Score value / reward flag (added to destruction tallies when eliminated).

---

## 4. Implementation Notes (`src/server/game/homing-missile.ts`)

The authentic Amiga tracking behavior has been isolated into its own server-side ECS system (`sysHomingMissiles`), keeping custom gameplay modifications safely quarantined:
* **Activation Radius:** Matches the Amiga proximity check threshold (`minDist = 400` pixels / `#$0030` scale).
* **Steering Logic:** Evaluates relative player delta and applies smooth trajectory updates.
* **Collision & Explosions:** Emits server events and triggers player destruction upon contact.