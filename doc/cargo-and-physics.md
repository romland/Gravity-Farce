# Cargo, Fuel & BCD Physics System

This document outlines the reverse-engineered mechanics for Cargo (crates), Fuel pods, and the extraordinary Base-10 (BCD) physics engine discovered within the Amiga *Gravity Force* binary.

## 1. The "Unpacked Decimal" Physics Engine

The most significant discovery of the reverse-engineering effort is that the Amiga engine **does not use standard binary fixed-point math** for its core velocity and trigonometry. It uses Unpacked Decimal Arrays (Base-10).

Instead of a single 32-bit integer, velocities and physics limits are stored as 4-byte arrays representing human-readable decimal digits: `[Integer, Tenths, Hundredths, Thousandths]`.

### Core Memory Map (Velocity & Modifiers)

| Address | Size | Description |
| --- | --- | --- |
| **`$00037F78`** | 4 Bytes | **Y-Velocity Array** (e.g., `02 00 00 00` = 2.000 pixels/frame). |
| **`$00037F7C`** | 1 Byte | **Y-Velocity Sign** (`00` = Up/Negative, `01` = Down/Positive). |
| **`$00037F90`** | 4 Bytes | **X-Velocity Array**. |
| **`$00037F94`** | 1 Byte | **X-Velocity Sign**. |
| **`$00037F9C`** | 4 Bytes | **Active Physics Modifier** (Loaded from cargo tiers). |
| **`$0002E196`** | Table | **Trigonometry Table** (Sin/Cos vectors stored as unpacked decimals). |

**Execution (`$00032C5E`):**
The engine calculates ship momentum by reading the Sin/Cos multiplier from the table, unpacking the base engine thrust, executing a long `mulu.w` across the base-10 digits, and repacking the result into the X/Y velocity arrays. 

---

## 2. Cargo Inventory & Capacity Mechanics

Cargo is managed via a strict Last-In-First-Out (LIFO) stack in memory, constrained by a strict weight limit.

### Cargo Tile Types
*   **`0xD1`:** Small Crate (Weight: 1 Tier)
*   **`0xD2`:** Large Crate (Weight: 2 Tiers)

### The Pickup Routine (`$0003647C`)
When the ship's bounding box intersects a crate:
1.  **Capacity Check:** The engine reads the crate's weight (1 or 2) and adds it to the **Total Weight Tier** at `$00037FCD`. 
2.  **Reject Gate:** It immediately executes `cmp.b #$04, $00037FCD`. If the resulting weight is 4 or higher, the pickup is aborted. **Maximum Cargo Capacity is strictly 3 weight tiers.**
3.  **Stack Push:** The crate ID is pushed onto the ship's inventory stack. The Stack Pointer is located at **`$00037F2A`**.
4.  **Physics Update:** It calls `jsr $000365CC` to recalculate the ship's physics based on the new weight tier.

---

## 3. Weight Tiers & Physics Penalties

The engine does *not* modify the base gravity constant (`$00037FB4`, which remains `1000`). Instead, it loads a packed 32-bit BCD modifier into `$00037F9C` based on the current Weight Tier (`$00037FCD`).

**Weight Class Table (`$00036606`):**
| Tier | Cargo Stack Weight | Hex Value | Decimal Equivalent | Delta |
| :---: | --- | --- | --- | --- |
| **0** | Empty (0) | `01 00 09 09` | **1.099** | - |
| **1** | 1 Small Crate (1) | `01 06 09 09` | **1.699** | +0.600 |
| **2** | 2 Small / 1 Large (2) | `02 02 09 09` | **2.299** | +0.600 |
| **3** | Max Capacity (3) | `02 08 09 09` | **2.899** | +0.600 |

*Behavioral impact:* This linear progression of exactly `0.600` per weight unit acts as a dynamic cap/drag modifier. As the ship gets heavier, the engine forces the velocity math to scale against this higher penalty limit, reducing effective thrust and increasing downward sink.

---

## 4. Homebase Unloading Routine (`$000351BA`)

Cargo is only processed when the ship executes a perfect, safe landing on a valid Homebase Pad (`0x15`, `0x1B`, `0x28`, `0x29`).

1.  **Safe Landing Gate:** Bypasses the crash handler (`$0003511E`).
2.  **Stack Pop:** It reads the Cargo Stack Pointer (`$00037F2A`) and decrements it (`sub.l #$1`).
3.  **Weight Reduction:** The weight of the popped crate is subtracted from the Total Weight Tier (`$00037FCD`).
4.  **Physics Restore:** Instantly calls `jsr $000365CC` to restore the lighter physics multiplier.
5.  **Scoring:** 
    *   If the popped crate was `0xD1`, it adds `5` to the score (`$00036B92`).
    *   If the popped crate was `0xD2`, it adds `7` to the score.

---

## 5. The Fuel Pod Fake-Out & HUD Tumbler

*   **Fuel Pod Tile:** `0xD0`
*   **Fuel Pool Address:** `$0003805A` (Initialized to `$00012AB0` / `76,464`)
*   **Drain Rate:** Subtracts `15` (`#$0F`) per frame while thrusting (`$00031B06`).

**The HUD Visualizer (`$0003249E`):**
When a Fuel Pod is picked up, it does *not* add directly to a binary score. It adds `600` to the target fuel value. The HUD routine compares the target value (`$00037F72`) against the active visual digits (`$00037F9C`) and calls an increment/decrement subroutine (`$0002E046` / `$0002E0FC`) to physically spin the UI numbers up or down frame-by-frame until they match.