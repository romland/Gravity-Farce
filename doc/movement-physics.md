# Engine Physics & Movement Modifiers

This document maps the core physics integration loops, environmental force modifiers (Gravity Wells), and the memory addresses responsible for entity velocity. 

## 1. Core Physics Memory Map

| Address | Size | Description |
| --- | --- | --- |
| **`$00037F40`** | Word | Player Absolute X Coordinate (Pixels). |
| **`$00037F42`** | Word | Player Absolute Y Coordinate (Pixels). |
| **`$00037F50`** | Long | Player X-Velocity (32-bit fixed point). |
| **`$00037F54`** | Long | Player Y-Velocity (32-bit fixed point). |
| **`$00037FB4`** | Long | **Physics Constant** (Standard Gravity / Thrust scale). Defaults to `1000` (`#$000003E8`). |
| **`$00050460`** | Pointer | Base address of the active level tilemap buffer. |

---

## 2. Velocity Integration & Terminal Limits (`$00031A4E`)

The main vertical physics integration loop handles adding thrust/gravity to the player's current trajectory. It utilizes the constant stored at `$00037FB4` to apply acceleration.

* **Terminal Velocity Cap:** The engine explicitly caps maximum velocity on any axis to `72,000` (`#$00011940` in fixed-point math).
* **Math Flow:**
  1. Read velocity (`$00037F54`).
  2. Add/Subtract Physics Constant (`$00037FB4`).
  3. Compare against `#$00011940`. If exceeded, clamp velocity.

> **FUTURE AUDIT NOTE (CARGO WEIGHT):**
> When a player picks up a crate, the ship gets heavier. The engine likely modifies the Physics Constant at `$00037FB4` or introduces a secondary downward delta variable in this integration loop. When we audit cargo, we will place a read/write watchpoint on `$00037FB4` to observe how mass alters the acceleration constant.

---

## 3. The `GetTileAt(X, Y)` Routine (`$000355B8`)

The engine does not maintain a separate collision bitmask; it reads the 8-bit tile ID directly from the memory map to evaluate forces and crashes.

**Input:** `D0` = X coordinate, `D1` = Y coordinate
1. Divides X and Y by 8 (`LSR.W #$03`) to convert pixels to the 16x16 tile grid coordinates.
2. Multiplies the Y-grid value by 42 (`MULU.W #$002A`) to account for level row width.
3. Adds the X-grid value.
4. Adds the resulting offset to the map base address `$00050460`.
5. **Output:** `A0` returns the exact memory address containing the tile ID.

---

## 4. Gravity Wells / Magnetic Forces (`$000357C4`)

Gravity wells (`0xCC`–`0xCF`) act as localized environmental forces. They apply an absolute fixed-point acceleration directly to the player's velocity axes.

### Evaluation Routine
1. The engine takes the player's top-left coordinates (`$00037F40`, `$00037F42`).
2. It adds `+7` to X and `+6` to Y to find the exact center of the ship's 14x14 collision box.
3. Calls `GetTileAt(X, Y)`.
4. Checks if the returned tile ID is between `0xCC` and `0xCF`.

### Force Vector Array (`$00035852`)

> **CRITICAL REVERSE-ENGINEERING DIRECTIVE: NEVER GUESS POLARITY.**
> A boolean or direction flag means nothing without reading the math assembly. Previously, we guessed that a `00` direction flag meant Positive/Right, which completely reversed the physics. In GF, `00` means Negative (Left/Up) and `01` means Positive (Right/Down).

If the ship overlaps a gravity well, the engine subtracts `0xCC` from the ID, multiplies by 12, and indexes into a local 12-byte Force Vector structure starting at `$00035852`.

All magnets apply a uniform force magnitude of `0x02000000` per frame to their respective axis:

| Tile ID | Direction | Direction Flag | Vector Logic | Magnitude |
| --- | --- | --- | --- | --- |
| **`0xCC`** | **RIGHT**| `0x01` (Positive) | Add to X-Velocity | `0x02000000` |
| **`0xCD`** | **DOWN** | `0x01` (Positive) | Add to Y-Velocity | `0x02000000` |
| **`0xCE`** | **LEFT** | `0x00` (Negative) | Subtract from X-Velocity | `0x02000000` |
| **`0xCF`** | **UP** | `0x00` (Negative) | Subtract from Y-Velocity | `0x02000000` |

### Interaction with Turrets
Immediately following the magnet check, the engine checks the exact same centered tile ID against the `0xBD`–`0xCB` threshold (`$00035910`). This confirms that **Turret Trigger Zones** use the same center-point overlap logic as Gravity Wells to wake up and begin firing.
