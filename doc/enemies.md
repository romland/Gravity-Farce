# Enemy Systems & Artificial Intelligence

## 1. Ground Units (Tanks)

Ground Tanks are simple, non-shooting patrol hazards that navigate a contiguous line of path nodes (`0x32`–`0x3A`).

### Memory Structure (`$0003769E` Array)
Each Tank occupies a 12-byte (`$0C`) struct:
* `+$00` [Word]: Active Status Flag.
* `+$02` [Word]: World X Coordinate (Pixels).
* `+$04` [Word]: World Y Coordinate (Pixels).
* `+$06` [Word]: X Velocity / Direction Step.
* `+$08` [Word]: Y Velocity / Direction Step.
* `+$0A` [Word]: Grid Traversal Timer.

### Grid Traversal AI (`$00035C24` & `$00035CD4`)
The engine uses a strict cell-based movement algorithm, utilizing an internal 8x8 pixel grid (hence `LSR.W #$03` division math):

1. **Node Detection:** When the Traversal Timer (`+$0A`) reaches `0`, the tank stops moving. It samples adjacent tiles in the level map to find the next path node.
2. **Vector Assignment:** It sets the X/Y velocity variables (`+$06`, `+$08`) to point toward the next node.
3. **Timer Reset:** It resets the Traversal Timer to exactly `8` (`MOVE.W #$0008, ($000A, A0)`).
4. **Movement Phase:** For the next 8 frames, it bypasses node detection. It simply adds the velocity to the pixel coordinates and decrements the timer (`SUBQ.W #$01, ($000A, A0)`). 

Once the timer hits 0, it has perfectly arrived at the exact center of the next 8x8 cell, and the cycle repeats.

### Hitbox & Collision (`$00036042`)
Tanks have a strict, asymmetrical bounding box:
* **X-Axis:** ±8 pixels
* **Y-Axis:** ±6 pixels
Destroying a tank awards exactly `100` points (`#$00000064`), and transitions the tank to state `#$0015` (Exploding), which triggers the particle spawner at `$000348BE`.

## 2. Advanced Enemies (Flying / Combat)
Complex flying enemies (`0xE4` - `0xEF`, including `0xEC`) use a rigid waypoint and cardinal vector system.

### Template Array (`$00031570`)
Each advanced enemy type is defined by a 22-byte (`$16`) template struct.
When parsing the map, the engine subtracts `0xE3` from the Tile ID to index this table.

* `+$06` [Word]: **Score Value** (`0064` = 100 points, `00FA` = 250 points).
* `+$08` [Word]: **Speed Scalar** (`03E8` = 1.0x, `07D0` = 2.0x, `09C4` = 2.5x).
* `+$0A` [Long]: **Flight Pattern Base Pointer**.
* *(Gap: Bytes `$0E` through `$14` are present but not fully mapped).*

### Active Enemy Array (`$000378F6`)
When spawned (`$00033F74`), the engine provisions a 32-byte (`$20`) struct for the active entity.

* `+$00` [Word]: Active Flag / State.
* `+$02` [Word]: Internal Trajectory State Timer / Direction Index.
* `+$04` [Long]: Absolute X Coordinate (Pixels).
* `+$08` [Long]: Absolute Y Coordinate (Pixels).
* `+$12` [Long]: Current Velocity Base.
* `+$1C` [Long]: Active Behavior Pointer (e.g., `$0003153A`).

### Flight Paths & Movement (`$00030B50` & `$000313C2`)
The Amiga does not use curves or sine waves for these enemies. They fly in perfect cardinal lines.
The engine reads 32-bit fixed-point vectors from `$000313C2`:
* State 0: `X: 1, Y: 0` (Right)
* State 1: `X: 0, Y: 1` (Down)
* State 2: `X: -1, Y: 0` (Left)
* State 3: `X: 0, Y: -1` (Up)

### Waypoints (`0xF0` - `0xFB`)
The engine uses these tiles as rigid directional triggers (Evaluated at `$00030F0E`).

1. The engine checks the map tile at the enemy's current coordinates.
2. If the tile is `>= 0xF0`, it subtracts `0xF0` to derive a Waypoint ID (`0` through `11`).
3. If the ID is `0` through `3`, it writes the ID directly into the enemy's State (`$0002, A0`), instantly changing its direction to Right, Down, Left, or Up.
4. **Swarm Sync (IDs `4` - `11`):** Higher waypoints branch to conditional logic that reads a global state variable (`$0003181C`). If the level toggles this state, enemies hitting `0xF4` will turn UP instead of LEFT, creating synchronized swarm patterns.
5. **State Freezing:** The Amiga compares the state against `#$0008` (`00030B70 cmp.w #$0008`). If a waypoint forces the state to `8` or higher (like `0xF8`), the enemy halts movement entirely. In the modern port, we apply a modulo (`waypointId % 4`) to safely route them back inward.
5. **Micro-Maneuvers (`0xF8` - `0xFB`):** Setting state to 8+ triggers a special 24-frame movement sequence (`$000311FC`).
   * The engine reads a custom X/Y velocity vector from a 48-byte table at `$00031242`.
   * It updates the enemy's internal frame counter (`+$1A`).
   * **Crucially**, while `+$1A` is non-zero, the waypoint map reader (`$00030F0E`) completely ignores the map. This acts as a 24-frame blindfold, allowing enemies to gracefully execute complex intersection maneuvers and fly over gaps in the track without snapping or re-triggering nodes.

---

## 3. Current Implementation Gaps (Pending Reverse Engineering)

### Gap 1: Tank Weapon RNG
* **Status:** Tanks (`0x32`) fire upward randomly.
* **Missing:** The exact global routine that iterates the tanks and spawns the bullet.

### Gap 2: Advanced Enemy Weapons
* **Status:** Flying enemies (`0xEC`) fire at the player.
* **Missing:** We know `F8`-`FB` execute micro-maneuvers, but we have not yet found the bullet spawner routines. They must be handled in a separate iteration loop over `$000378F6`.
