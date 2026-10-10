# Exploding nemies

---

### Structure & Coordinate System

From the spawner routines (`0x34b6e` and `0x360bc`):
Each fragment is stored as **four 32-bit big-endian signed integers** (16 bytes total):


$$\left[ \Delta X, \; \Delta Y, \; V_x, \; V_y \right]$$

* **Units:** Coordinates and velocities are scaled fixed-point integers ($\times 1{,}000$, where $1{,}000 = 1.0\text{ pixel}$).


* **Horizontal Axis ($X$):** Positive is **Right**, Negative is **Left**.
* **Vertical Axis ($Y$):** Positive is **Down**, Negative is **Up** (standard screen space).
* **Lifetime:** All fragments live for exactly **100 frames** (`d0 = 0x64`) unless they hit rock first.



---

### 1. Ground Tank Explosions (`0x32` – `0x3A`): Table at `0x36136`

Reading from `0x36136` to the `0xFFFF` terminator at `0x36186`: exactly **5 fragments** are defined.

| # | Address | $\Delta X$ (px) | $\Delta Y$ (px) | $V_x$ (px/frame) | $V_y$ (px/frame) | Angle & Trajectory |
| --- | --- | --- | --- | --- | --- | --- |
| **1** | `0x36136` | `+4.000` (`0x0FA0`) | `+2.000` (`0x07D0`) | **-0.866** (`0xFFFFFC9E`) | **-0.500** (`0xFFFFFE0C`) | **Up-Left** (~$210^\circ$), low arc |
| **2** | `0x36146` | `+6.000` (`0x1770`) | `0.000` (`0x0000`) | **-0.500** (`0xFFFFFE0C`) | **-0.866** (`0xFFFFFC9E`) | **Up-Left** (~$240^\circ$), high arc |
| **3** | `0x36156` | `+8.000` (`0x1F40`) | `0.000` (`0x0000`) | **0.000** (`0x0000`) | **-1.000** (`0xFFFFFC18`) | **Straight Up** ($270^\circ$) |
| **4** | `0x36166` | `+10.000` (`0x2710`) | `0.000` (`0x0000`) | **+0.500** (`0x01F4`) | **-0.866** (`0xFFFFFC9E`) | **Up-Right** (~$300^\circ$), high arc |
| **5** | `0x36176` | `+11.904` (`0x2EE0`) | `+2.000` (`0x07D0`) | **+0.866** (`0x0362`) | **-0.500** (`0xFFFFFE0C`) | **Up-Right** (~$330^\circ$), low arc |

* **Terminator:** `0xFFFF` at `0x36186`.
* **Physics Shape:** An upward fountain spread between $-30^\circ$ and $+30^\circ$ of vertical. Every piece has a speed of exactly **1.0 px/frame** ($\sqrt{0.866^2 + 0.5^2} = 1.0$).



---

### 2. Flying Enemy Explosions: Table at `0x36188`

Reading from `0x36188` to the `0xFFFF` terminator at `0x36208`: exactly **8 fragments** are defined.

| # | Address | $\Delta X$ (px) | $\Delta Y$ (px) | $V_x$ (px/frame) | $V_y$ (px/frame) | Compass Heading | Trajectory |
| --- | --- | --- | --- | --- | --- | --- | --- |
| **1** | `0x36188` | `+24.000` (`0x5DC0`) | `0.000` (`0x0000`) | **0.000** (`0x0000`) | **-1.000** (`0xFFFFFC18`) | **N** ($270^\circ$) | **Straight Up** |
| **2** | `0x36198` | `+47.000` (`0xB798`) | `+16.000` (`0x3E80`) | **+1.000** (`0x03E8`) | **0.000** (`0x0000`) | **E** ($0^\circ$) | **Straight Right** |
| **3** | `0x361A8` | `+24.000` (`0x5DC0`) | `+31.000` (`0x7918`) | **0.000** (`0x0000`) | **+1.000** (`0x03E8`) | **S** ($90^\circ$) | **Straight Down** |
| **4** | `0x361B8` | `0.000` (`0x0000`) | `+16.000` (`0x3E80`) | **-1.000** (`0xFFFFFC18`) | **0.000** (`0x0000`) | **W** ($180^\circ$) | **Straight Left** |
| **5** | `0x361C8` | `0.000` (`0x0000`) | `0.000` (`0x0000`) | **-0.707** (`0xFFFFFD3D`) | **-0.707** (`0xFFFFFD3D`) | **NW** ($225^\circ$) | **Diagonal Up-Left** |
| **6** | `0x361D8` | `+47.000` (`0xB798`) | `0.000` (`0x0000`) | **+0.707** (`0x02C3`) | **-0.707** (`0xFFFFFD3D`) | **NE** ($315^\circ$) | **Diagonal Up-Right** |
| **7** | `0x361E8` | `+47.000` (`0xB798`) | `+31.000` (`0x7918`) | **+0.707** (`0x02C3`) | **+0.707** (`0x02C3`) | **SE** ($45^\circ$) | **Diagonal Down-Right** |
| **8** | `0x361F8` | `0.000` (`0x0000`) | `+31.000` (`0x7918`) | **-0.707** (`0xFFFFFD3D`) | **+0.707** (`0x02C3`) | **SW** ($135^\circ$) | **Diagonal Down-Left** |

* **Terminator:** `0xFFFF` at `0x36208`.
* **Physics Shape:** A symmetric 8-spoke star burst spaced by $45^\circ$.
* **Speed:** Normalized to **1.0 px/frame** ($\sqrt{0.707^2 + 0.707^2} = 1.0$).
* **Spawn Offsets ($\Delta X, \Delta Y$):**
Flying enemies have a bounding box of roughly **48 $\times$ 32 pixels** ($47{,}000 \times 31{,}000$ fixed-point):
* Fragments 1–4 originate from the midpoints of the 4 outer edges: Top Center, Right Center, Bottom Center, Left Center.
* Fragments 5–8 originate from the 4 outer corners: Top-Left, Top-Right, Bottom-Right, Bottom-Left.



---

### Ready-to-Use TypeScript Implementation

```typescript
// src/server/entities/debris.ts

export interface FragmentDef {
  dx: number; // spawn offset in pixels
  dy: number;
  vx: number; // velocity in pixels per frame
  vy: number;
}

// Ground Tanks (0x32 - 0x3A)
export const TANK_FRAGMENTS: FragmentDef[] = [
  { dx: 4.0,  dy: 2.0, vx: -0.866, vy: -0.500 },
  { dx: 6.0,  dy: 0.0, vx: -0.500, vy: -0.866 },
  { dx: 8.0,  dy: 0.0, vx:  0.000, vy: -1.000 },
  { dx: 10.0, dy: 0.0, vx:  0.500, vy: -0.866 },
  { dx: 11.9, dy: 2.0, vx:  0.866, vy: -0.500 },
];

// Flying Enemies (0xE6-0xEA, 0xEC-0xEF)
export const FLYING_ENEMY_FRAGMENTS: FragmentDef[] = [
  { dx: 24.0, dy:  0.0, vx:  0.000, vy: -1.000 }, // N
  { dx: 47.0, dy: 16.0, vx:  1.000, vy:  0.000 }, // E
  { dx: 24.0, dy: 31.0, vx:  0.000, vy:  1.000 }, // S
  { dx:  0.0, dy: 16.0, vx: -1.000, vy:  0.000 }, // W
  { dx:  0.0, dy:  0.0, vx: -0.707, vy: -0.707 }, // NW
  { dx: 47.0, dy:  0.0, vx:  0.707, vy: -0.707 }, // NE
  { dx: 47.0, dy: 31.0, vx:  0.707, vy:  0.707 }, // SE
  { dx:  0.0, dy: 31.0, vx: -0.707, vy:  0.707 }, // SW
];

```