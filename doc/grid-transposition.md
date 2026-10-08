# Amiga Grid Transposition Specification

> The original level data is column-major and transposed relative to standard row-major parsing (`world_x = raw_y`, `world_y = raw_x`). 
> **Be careful and do account for this transposition or there will be bugs in map memory access:**
> 1. **Physics Collisions:** Force vectors will push in wrong directions (e.g., `0xCE` gravity will thrust ships UP into ceilings instead of LEFT down tunnels).
> 2. **Tile Mutations:** Destructible terrain edits using `[x][y]` instead of `[y][x]` will erase solid wall tiles on the wrong side of the level.
> 3. **Trigger Bounds:** Proximity triggers will check vertical columns instead of horizontal tunnel ranges, firing hazards through solid rock.
> *(Note: Turret vectors are completely unaffected by map transposition. They natively map to true screen space!)*

---

## 1. Memory Transposition (`world_x = raw_y`, `world_y = raw_x`)
The Amiga level buffer is a flat 4200-byte array (`uint8_t map[4200]`).

```text
Amiga (Column-Major): Index = (x * 42) + y  -> [Col 0 (42 tiles), Col 1 (42 tiles)...]
Loader (Row-Major):    Index = (y * 42) + x  -> [Row 0 (42 tiles), Row 1 (42 tiles)...]

```

Reading column-major memory into a row-major grid transposes the 2D matrix across its main diagonal.

---

## 2. Subsystem Impact & Logic Rules

### Physics & Vectors are NATIVE (Not Transposed)
**CRITICAL:** The transposition applies *exclusively* to the 4200-byte map buffer layout. It does **NOT** apply to the physics engine, entity rendering, or orce vectors. 
* `(Vx, Vy)` vector arrays for bullets are standard screen-space Cartesian (`+Y = Down`).
* Gravity Well force magnitudes are standard screen-space.
* Turret muzzle offsets are standard screen-space.
**Do not swap X and Y fields when reading structs.**

### Tile Access & Mutations

* **Coordinates:** `tileX = Math.floor(worldX / 32)`, `tileY = Math.floor(worldY / 32)`
* **Array Indexing:** Always use `rawMap[tileY][tileX]`.
* *Note:* Mutating `rawMap[tileX][tileY]` deletes tiles across the diagonal axis.

### Triggers, Spawns & Hitboxes

* **Entity Spawns:** `position = { x: rawY * 32, y: rawX * 32 }`
* **Trigger Distances (`0xBD`–`0xCB`):** Evaluates horizontal delta `Math.abs(player.x - turret.x) <= range` along the transposed tunnel length.
* **Bullet Collision:** Delta threshold `Math.abs(dx) <= 7 && Math.abs(dy) <= 7`.
