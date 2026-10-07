# Enemy Systems & Artificial Intelligence

## 1. Universal Projectile & Particle Spawner (`$000348BE`)

All non-player projectiles, particles, and ship thruster trails are allocated through a centralized spawner routine at `$000348BE`.

### Spawner Mode Register (`$000348D6`)

Before calling `jsr $000348BE`, the calling routine writes an integer mode selector to `$000348D6`:

* `#$0000`: **NPC Bullet / Particle Emission** — Flying enemy firing (`$00030ECE`), engine exhaust, and enemy explosion fragments (`$00034B96`).
* `#$0001`: **Primary Weapon** — Player ship primary fire (`$00032372`) and Ground Turret targeting fire (`$000360DA`).
* `#$0003`: **Player Thrust Trail** — Particle trail behind player ship (`$00035FE8`).

### Active Projectile Array (`$00034C6A`)

Allocated entities are written to a fixed array at `$00034C6A`. Each entry is a 20-byte (`$14`) struct:

* `+$00` [Word]: Active Life Counter / Type (`$0000` = Inactive, `$FFFF` = Array Terminator).
* `+$02` [Long]: Fixed-Point X Coordinate (Pixel position $\times 1000$).
* `+$06` [Long]: Fixed-Point Y Coordinate (Pixel position $\times 1000$).
* `+$0A` [Long]: Horizontal Velocity Vector ($VX$).
* `+$0E` [Long]: Vertical Velocity Vector ($VY$).

---

## 2. Ground Entities & Turrets (`$0003769E` Array)

Ground entities occupy a fixed array starting at `$0003769E`. Each entity uses a 12-byte (`$0C`) struct:

* `+$00` [Word]: Entity Active Flag (`0` = Empty, `1` = Active, `2` = Exploding).
* `+$02` [Word]: World X Coordinate (Pixels).
* `+$04` [Word]: World Y Coordinate (Pixels).
* `+$06` [Word]: Horizontal Movement Vector / Direction Step.
* `+$08` [Word]: Vertical Movement Vector / Direction Step.
* `+$0A` [Word]: Grid Traversal Timer.

### Ground Patrol Tanks (`$00035C24` & `$00035CD4`)

Non-shooting patrol tanks navigate level path nodes (`0x32`–`0x3A`) using an 8x8 pixel tile grid:

1. **Cell Alignment:** When traversal timer (`+$0A`) reaches `0`, the tank samples adjacent tiles on the 8x8 grid (`lsr.w #$03`).
2. **Vector Update:** Sets movement steps (`+$06`, `+$08`) toward the adjacent path node tile.
3. **Timer Reset:** Resets traversal timer (`+$0A`) to `8` (`move.w #$0008, ($000A, a0)`).
4. **Integration:** Moves for 8 frames, updating pixel coordinates and decrementing `+$0A` until centered on the next 8x8 cell.
5. **Collision Box:** Tanks use a bounding box of $\pm8\text{px}$ (X) by $\pm6\text{px}$ (Y) checked at `$00036042`. Destroying a tank awards 100 points (`#$00000064`) and sets state to `0x15` (Exploding).

### Stationary Ground Turrets (`$00036040`–`$000360DA`)

* **Targeting Iteration:** Routine `$00036040` loops over active entities in `$0003769E`.
* **Proximity Check:** Measures absolute distance between player position (`$00034C6A`) and turret coordinates (`+$04`). Engagement triggers when distance $< 200\text{px}$ (`$0003606E`).
* **Aimed Firing:** Calculates directional vectors toward player position and calls `jsr $000348BE` with spawner mode `$000348D6 = #$0001`.

---

## 3. Flying Enemies (`$000378F6` Array)

Flying enemies are managed via a active entity table at `$000378F6` populated from static template definitions at `$00031570`.

### Entity Template Structure (`$00031570` Array)

22-byte (`$16`) struct indexed by (Tile ID - `0xE3`). 

**The Base Tile Quirk:** The engine uses Tile `0xE3` (Multiplayer P2 Start) as a mathematical baseline. Subtracting `$E3` from an active enemy tile yields its struct index. This means Index 0 (`$00031570` to `$00031585`) is entirely empty `0000` padding in the ROM, and the first valid flying enemy (`0xE4`) sits at Index 1.

* `+$00` [Word]: Hit Points (`FFFF` = Invulnerable / -1).
* `+$06` [Word]: Score Value (`0064` = 100 points, `00FA` = 250 points).
* `+$08` [Word]: Weapon Firing Cooldown / PRNG Threshold (`0000` = Non-shooting entity).
* `+$0A` [Word]: Capabilities Mask (Bit 1 / `0x02` = Can Shoot).

#### Verified Specifications (`0xE4` - `0xEF`)
* **`0xE4`**: 8 HP, 2.0x speed, Shoots (100 pts)
* **`0xE5`**: Invulnerable, 0.0x speed (Stationary Mine), No Shoot (200 pts)
* **`0xE6`**: 6 HP, 2.0x speed, No Shoot (100 pts)
* **`0xE7`**: 3 HP, 1.0x speed, Shoots (150 pts)
* **`0xE8`**: 5 HP, 1.0x speed, No Shoot (250 pts)
* **`0xE9`**: 12 HP, 6.0x speed, No Shoot (90 pts)
* **`0xEA`**: 12 HP, 5.0x speed, No Shoot (100 pts)
* **`0xEB`**: Invulnerable, 0.0x speed (Stationary Mine), No Shoot (100 pts)
* **`0xEC`**: 6 HP, 2.5x speed, No Shoot (75 pts)
* **`0xED`**: 6 HP, 3.0x speed, No Shoot (200 pts)
* **`0xEE`**: 9 HP, 3.5x speed, No Shoot (100 pts)
* **`0xEF`**: 25 HP, 12.0x speed, No Shoot (80 pts)

### Active Entity Structure (`$000378F6` Array)

32-byte (`$20`) struct provisioned by spawn routine `$00033F74`:

* `+$00` [Word]: Active State (`$0000` = Inactive/Dead, `$0014` = Active, `$0032` = Exploding).
* `+$02` [Word]: Direction State (0=Right, 1=Down, 2=Left, 3=Up, 4..7=Conditional Swarm, 8..11=Cornering).
* `+$04` [Long]: Absolute Fixed-Point X Position.
* `+$08` [Long]: Absolute Fixed-Point Y Position.
* `+$16` [Word]: Hit Points (Default = 3).
* `+$1A` [Word]: Cornering Step Counter (Increments by 2 per frame up to 48).

### Movement & Speed Wave Table (`$0003100A`, `$000313C2`, `$000311FA`)

Flying enemies do not move at static linear rates. Speed is modulated continuously by a global wave timer:

* **Global Wave Index (`$000311FA`):** Increments by `8` each frame (`0, 8, 16, 24, 32, 40, 48, 56`), resetting at `64` (`$00031084`–`$00031098`).
* **Wave Displacement Table (`$000313C2`):** Stores signed sub-pixel displacement vectors per step. Entries vary in magnitude (including zero-velocity frames), causing enemies to decelerate, linger, and accelerate along cardinal paths.

### Waypoint Traversal & Blindfold Logic (`$00030F0E`)

At `$00030F0E`, the engine samples tile map `$00050460` at the enemy's current 8x8 grid coordinates (`lsr.l #$03` on pixel X/Y):

* **Direct Cardinal Nodes (`0xF0`–`0xF3`):** Subtracts `0xF0` and writes values `0`–`3` directly into direction state `+$02` (0=Right, 1=Down, 2=Left, 3=Up).
* **Swarm Sync Nodes (`0xF4`–`0xF7`):** Evaluates sign bit of global state `$0003181C` (`bmi.w` branch). Depending on state, forces turns in opposite directions to split or sync swarms.
* **Diagonal Reflectors (`0xF8`–`0xFB`):**
* Sets direction state `+$02` to `8`–`11` (8=Up-Right `0xF8`, 9=Down-Right `0xF9`, 10=Down-Left `0xFA`, 11=Up-Left `0xFB`).
* Triggers a 24-frame blindfold cycle (`+$1A`) during direction transitions to prevent re-triggering waypoint checks until clear.
* **Way-Point Blindfold:** While step counter `+$1A` is non-zero, routine `$00030F0E` **bypasses tile checking entirely**. This prevents enemies from snapping or re-triggering adjacent waypoint nodes while completing turns.

### Flying Enemy Firing Mechanics (`$00030E00`–`$00030ECE`)

Flying enemy weapons are completely un-aimed, non-directional hazards driven by system registers:

* **PRNG Gate & Burst Logic (`$0003603E`):**
Firing is evaluated by XORing the system PRNG register (`$00037F6A`) with frame ticks (`$00030B18`).
* Primary firing runs on a 150–240 frame interval (~3.0s–4.8s).
* A secondary PRNG check gives an approximate 30–40% chance to queue a rapid follow-up shot 8–12 frames after the first, producing occasional 2-shot bursts.


* **Trajectory Synthesis (`$00030E00`–`$00030E8C`):**
The engine unpacks 4 raw byte digits from system tick/PRNG registers (`$00036032`–`$00036035` and `$0003603A`–`$0003603D`) into registers $D0$–$D3$.
* $VX$ and $VY$ are assembled directly from these PRNG digits.
* Fixed offset biases are added from `$00030B1A` ($+1.0$ fixed $VX$) and `$00030B1E` ($+0.0$ $VY$).
* **No player tracking or vector normalization ($\Delta X / \text{dist}$) occurs.**


* **Muzzle Positioning (`$000315C8`):**
Applies direction-dependent muzzle offsets from table `$000315C8` based on entity direction state `+$02`, shifting the spawn position to the active front/side of the enemy sprite.
* **Spawner Call & Bullet Lifespan (`$000348BE`):**
Sets `$000348D6 = #$0000` (NPC projectile mode) and calls `jsr $000348BE` with `D0 = #150` ($0096) frames lifetime. Active bullets despawn after **3.0 seconds** (at 50Hz PAL) or upon solid wall/player impact.

---

## 4. Bullet Collision & Hit Detection (`$00034ABE`)

Routine `$00034ABE` handles player bullet impact against flying enemies.

### Spatial Bounding Window

Iterates through active player projectiles in `$00034C6A` and checks coordinates against flying enemies in `$000378F6`:

```assembly
00034ad2 2005                 move.l d5,d0          ; d0 = Bullet Pixel X
00034ad4 90aa 0004           sub.l ($0004,a2),d0   ; d0 = BulletX - EnemyX
00034ad8 0c80 0000 0030      cmp.l #$00000030,d0   ; Check Width: 0 <= d0 <= 48px
00034aea 2006                 move.l d6,d0          ; d0 = Bullet Pixel Y
00034aec 90aa 0008           sub.l ($0008,a2),d0   ; d0 = BulletY - EnemyY
00034af0 0c80 0000 0020      cmp.l #$00000020,d0   ; Check Height: 0 <= d0 <= 32px

```

* Bounding box is an unsigned $48 \times 32\text{px}$ rectangle relative to the enemy's top-left origin.

### Damage Application (`$00034B10`–`$00034BCE`)

1. **HP Reduction:** On valid collision, decrements hit points at struct offset `+$16` (`subq.w #$01, ($0016, a2)`).
2. **Destruction State:** When HP reaches `0`, sets enemy active state `+$00` to `#$0032` (Exploding).
3. **Explosion Particles:** Loads particle velocity vectors from table `$00036188` and calls `jsr $000348BE` (Mode `0`) to emit explosion debris.

### Active Projectile Array Layout ($00034C6A)
Entities allocated by universal spawner `$000348BE` use a 20-byte ($14) struct:
* +$00 [Word]: Lifespan Countdown Timer (Decremented by 1 each frame; despawns at 0).
* +$02 [Long]: Absolute Fixed-Point X Position.
* +$06 [Long]: Absolute Fixed-Point Y Position.
* +$0A [Long]: Horizontal Velocity Vector (VX).
* +$0E [Long]: Vertical Velocity Vector (VY).
* +$12 [Word]: Spawner Mode / Weapon Identifier ($000348D6).

### Bullet Lifespan Standards
* Initial Duration (D0): 150 frames (#$0096).
* Effective Lifetime: 3.0 seconds at 50Hz (PAL) / 2.5 seconds at 60Hz (NTSC).

