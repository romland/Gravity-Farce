# Amiga Grid Transposition & Physics Specification

> **DO NOT ASSUME STANDARD 2D CARTESIAN MAP INDEXING OR DIRECT VECTOR ASSIGNMENT.**
> The Amiga level data is column-major and transposed relative to standard row-major parsing (`world_x = raw_y`, `world_y = raw_x`). 
> **Failing to not account for this transposition might introduce bugs:**
> 1. **Physics Collisions:** Force vectors will push in wrong directions (e.g., `0xCE` gravity will thrust ships UP into ceilings instead of LEFT down tunnels).
> 2. **Turret Combat:** Turrets will fire inward into their own wall tiles, despawning bullets on frame 0.
> 3. **Tile Mutations:** Destructible terrain edits using `[x][y]` instead of `[y][x]` will erase solid wall tiles on the wrong side of the level.
> 4. **Trigger Bounds:** Proximity triggers will check vertical columns instead of horizontal tunnel ranges, firing hazards through solid rock.

---

## 1. Memory Transposition (`world_x = raw_y`, `world_y = raw_x`)
The Amiga level buffer is a flat 4200-byte array (`uint8_t map[4200]`).

```text
Amiga (Column-Major): Index = (x * 42) + y  -> [Col 0 (42 tiles), Col 1 (42 tiles)...]
Loader (Row-Major):    Index = (y * 42) + x  -> [Row 0 (42 tiles), Row 1 (42 tiles)...]

```

Reading column-major memory into a row-major grid transposes the 2D matrix across its main diagonal.

---

## 2. Vector Struct Mapping

16-byte force table entry: `[field1, field2, field3, field4]` (4 longwords).

* `field3` = Amiga Y-axis delta (maps to TS `world_x`)
* `field4` = Amiga X-axis delta (maps to TS `world_y`)

```typescript
// Velocity delta mapping
const vx = field4 / 1000;
const vy = field3 / 1000;

// Example (Tile 0xCE): field3 = 0, field4 = -1000 => (vx: -1.0, vy: 0.0) [Straight Left]

```

---

## 3. Subsystem Impact & Logic Rules

### Tile Access & Mutations

* **Coordinates:** `tileX = Math.floor(worldX / 32)`, `tileY = Math.floor(worldY / 32)`
* **Array Indexing:** Always use `rawMap[tileY][tileX]`.
* *Note:* Mutating `rawMap[tileX][tileY]` deletes tiles across the diagonal axis.

### Turret Mounting & Rotation

Angles align relative to transposed surface normals to prevent frame-0 self-collisions:

* **Floor ($0^\circ$):** `0xAE`–`0xB2`, `0xBA`
* **Ceiling ($180^\circ$ / `Math.PI`):** `0xB3`, `0xB6`, `0xBB`, `0xBC`
* **East Wall ($+90^\circ$ / `Math.PI / 2`):** `0xB7`
* **West Wall ($-90^\circ$ / `-Math.PI / 2`):** `0xB8`
* **Diagonal Mount ($-45^\circ$ / `-Math.PI / 4`):** `0xB4`, `0xB5`, `0xB9`

### Triggers, Spawns & Hitboxes

* **Entity Spawns:** `position = { x: rawY * 32, y: rawX * 32 }`
* **Trigger Distances (`0xBD`–`0xCB`):** Evaluates horizontal delta `Math.abs(player.x - turret.x) <= range` along the transposed tunnel length.
* **Bullet Collision:** Delta threshold `Math.abs(dx) <= 7 && Math.abs(dy) <= 7`.
