# Single-Player Objectives, Cargo & Physics Systems

## 1. The "Unpacked Decimal" Physics Engine

The engine **does not use standard binary fixed-point math** for its core velocity and trigonometry. It uses Unpacked Decimal Arrays (Base-10). Instead of a single 32-bit integer, velocities and physics limits are stored as 4-byte arrays representing human-readable decimal digits: `[Integer, Tenths, Hundredths, Thousandths]`.

### Core Memory Map (Position & Velocity)

| Address | Size | Description |
| --- | --- | --- |
| **`$00037F44`** | Long | **32-bit Absolute X-Position Accumulator** |
| **`$00037F48`** | Long | **32-bit Absolute Y-Position Accumulator** |
| **`$00037F40`** | Word | **16-bit Rendering X-Coordinate** (Absolute X $\div$ 1000) |
| **`$00037F42`** | Word | **16-bit Rendering Y-Coordinate** (Absolute Y $\div$ 1000) |
| **`$00037F78`** | 4 Bytes | **Y-Velocity Array** (e.g., `02 00 00 00` = 2.000 pixels/frame) |
| **`$00037F7C`** | 1 Byte | **Y-Velocity Sign** (`00` = Up/Negative, `01` = Down/Positive) |
| **`$00037F90`** | 4 Bytes | **X-Velocity Array** |
| **`$00037F94`** | 1 Byte | **X-Velocity Sign** |
| **`$00037F9C`** | 4 Bytes | **Active Physics Modifier** (Loaded from cargo tiers) |
| **`$0002E196`** | Table | **Trigonometry Table** (Sin/Cos vectors stored as unpacked decimals) |

**Execution (`$00032C5E`):**
The engine calculates ship momentum by reading the Sin/Cos multiplier from the table, unpacking the base engine thrust, executing a long `mulu.w` across the base-10 digits, and repacking the result into the X/Y velocity arrays.

**Map Boundaries (`$000338AC`):**
The engine verifies the Y-Position accumulator against `#$000BF680` (784,000 decimal). Divided by 1000, this enforces a strict level depth limit of 784 pixels.

---

## 2. Ship Steering & Rotation (`$00031A4E`)

The ship steering system utilizes a modulo accumulator rather than standard angular limits.

* **`$00037F54`** [Long]: Angle Accumulator.
* **`$00037F58`** [Word]: Visual Angle Index (Player's current sprite rotation frame).
* **`$00037FB4`** [Long]: Rotation Turn Speed (Locked at `#$03E8` / 1000). Cargo weight does *not* modify turning speed.
* **`$00034577`** / **`$00034578`** [Byte]: Left / Right turning input flags.

The engine adds/subtracts the turn speed to the angle accumulator, constrained via modulo `$11940` (72,000). The accumulator is divided by 2000 and multiplied by 2, yielding 72 possible directional sprite rotation frames (Frame 54 represents perfectly upright).

---

## 3. Cargo Inventory & Capacity Mechanics

Cargo is managed via a strict Last-In-First-Out (LIFO) stack in memory, constrained by a hard weight limit.

### Cargo Tile Types

* **`0xD1`:** Small Crate (Weight: 1 Tier)
* **`0xD2`:** Large Crate (Weight: 2 Tiers)

### The Pickup Routine (`$0003647C`)

When the ship's bounding box intersects a crate:

1. **Capacity Check:** The engine reads the crate's weight (1 or 2) and adds it to the **Total Weight Tier** at `$00037FCD`.
2. **Reject Gate:** Executes `cmp.b #$04, $00037FCD`. If the resulting weight is $\ge 4$, the pickup is aborted. **Maximum Cargo Capacity is strictly 3 weight tiers.**
3. **Stack Push:** The crate ID is pushed onto the ship's inventory stack array (`$00037F23`). The Stack Pointer is located at `$00037F2A`.
4. **Physics Update:** Calls `jsr $000365CC` to recalculate the ship's physics based on the new weight tier and triggers audio (`jsr $00037374`).

---

## 4. Weight Tiers & Physics Penalties

The engine does *not* modify the base gravity constant (`$00037FB4`, which remains `1000`). Instead, it loads a packed 32-bit BCD modifier into `$00037F9C` based on the current Weight Tier (`$00037FCD`).

**Weight Class Table (`$00036606`):**

| Tier | Cargo Stack Weight | Hex Value | Decimal Equivalent | Delta |
| --- | --- | --- | --- | --- |
| **0** | Empty (0) | `01 00 09 09` | **1.099** | - |
| **1** | 1 Small Crate (1) | `01 06 09 09` | **1.699** | +0.600 |
| **2** | 2 Small / 1 Large (2) | `02 02 09 09` | **2.299** | +0.600 |
| **3** | Max Capacity (3) | `02 08 09 09` | **2.899** | +0.600 |

**Behavioral impact:** This linear progression of exactly `0.600` per weight unit acts as a dynamic cap/drag modifier. As the ship gets heavier, the engine forces the velocity math to scale against this higher penalty limit, reducing effective thrust and increasing downward sink.

---

## 5. Homebase Unloading Routine (`$000351BA`)

Cargo is only processed when the ship executes a perfect, safe landing on a valid Homebase Pad (`0x15`, `0x1B`, `0x28`, `0x29`).

### Safe Landing Handler (`$000352A8`)

* **Angle Gate Check:** The ship's visual angle (`$00037F58`) must be strictly between `$0034` (52) and `$0038` (56) to survive touchdown.
* **Velocity Gate Check:** If downward Y-Velocity (`$00037F78`) exceeds `02 00 00 00` (2.000 pixels/frame), the ship crashes.

### Unloading Execution

1. **Safe Landing Gate:** Validates pad touchdown and bypasses the crash handler.
2. **Stack Pop:** Reads the Cargo Stack Pointer (`$00037F2A`) and decrements it (`sub.l #$1`).
3. **Weight Reduction:** The weight of the popped crate is subtracted from the Total Weight Tier (`$00037FCD`).
4. **Physics Restore:** Instantly calls `jsr $000365CC` to restore the lighter physics multiplier.
5. **Scoring:** If the popped crate was `0xD1`, it adds `5` to the score (`$00036B92`). If `0xD2`, it adds `7`.

---

## 6. The Fuel Pod & HUD Tumbler

* **Fuel Pod Tile:** `0xD0`
* **Fuel Pool Address:** `$0003805A` (Initialized to `$00012AB0` / `76,464`)
* **Drain Rate:** Subtracts `15` (`#$0F`) per frame while thrusting (`$00031B06`).

**Fuel Refill (`$0003641A`):**
Picking up a Fuel Pod injects `50,000` (`$C350`) into the active fuel pool and caps it at `99,999` (`$1869F`).

**The HUD Visualizer (`$0003249E`):**
Values are not displayed instantly on the HUD. The target UI value (`$00037F72`) is continuously compared against the active visual digits (`$00037F9C`). Subroutines `$0002E046` (increment) and `$0002E0FC` (decrement) physically roll the digits per frame until they match.

---

## 7. Pickup Dispatch & Buff Types

Pickups are managed via an entity array starting at `$00037B26`. Offset `+$01` routes the pickup to specific handlers:

* **Type 0 (`0xD0`):** Branches to `$00036406` (Fuel Refill).
* **Type 1 (`0xD1`):** Branches to `$00036478` (Small Cargo).
* **Type 2 (`0xD2`):** Branches to `$00036490` (Large Cargo).
* **Type 5+ (`0xD5+`):** Branches to `$00036390` (Weapon/Ship Buffs).

### Weapon & Ship Buff Indexer (`$000362DE`)

Buffs are fetched from an 8-byte specification table at `$00036646`. The lookup index is derived via: `(Tile ID - 0xD5) * 8`.

**Buff Specification Structure:**

* `+$00` [Long]: **Capability Mask** (Written to `$00037FBA` to alter projectile firing vectors).
* `+$04` [Word]: Secondary state flag.
* `+$06` [Word]: **Lifespan/Charge Counter** (Written to `$00037FB8` to dictate duration before reverting to normal fire).

**Documented Buff IDs:**

* **`0xD5` (Index 0):** Primary Weapon Upgrade.
* **`0xD6` (Index 1):** **Double-Shot Powerup.** Sets the multi-bullet mask in `$00037FBA` to spawn parallel bullet entities.
* **`0xD7` (Index 2):** Spread/Secondary Variant.
* **`0xD8` (Index 3):** Utility/Engine Boost.

---

## 8. Auxiliary Engine Translation Logic

**GetTileAt Coordinate Translation (`$000355B8`):**
To evaluate map tile collisions, absolute pixel coordinates are converted to grid indices using column-major transposition:

1. Divides X and Y by 8 (8x8 grid).
2. Multiplies Y-index by 42 (level row width).
3. Adds X-index.
4. Adds base map address `$00050460` to access the exact tile ID.
