### 1. Master Turret Specification Table (`$00035B16`)

Each turret entry is **18 bytes (`$12`)**:


---
| Tile ID | Spec Addr | Vector Ptr | Muzzle (X, Y) | HP (`+$08`) | Cooldown | Sound ID | Behavior / Pattern Description |
| --- | --- | --- | --- | --- | --- | --- | --- |
| **`0xAE`** | `$00035B16` | `$000359FA` | (+1, +3) | **4** | 80 | 8 | 3-Way Cone Variant |
| **`0xAF`** | `$00035B28` | `$000359FA` | (+1, +3) | **4** | 80 | 8 | 3-Way Cone Up |
| **`0xB0`** | `$00035B3A` | `$00035A16` | (+1, +3) | **5** | 80 | 10 | 4-Way Cone Up |
| **`0xB1`** | `$00035B4C` | `$00035A16` | (+1, +3) | **5** | 80 | 10 | 4-Way Cone Variant |
| **`0xB2`** | `$00035B5E` | `$00035A3A` | (+2, +0) | **5** | 40 | 9 | Straight Up Stream |
| **`0xB3`** | `$00035B70` | `$00035A3A` | (+2, +0) | **5** | 40 | 9 | Ceiling Straight Down |
| **`0xB4`** | `$00035B82` | `$00035A46` | (-1, +2) | **8** | 70 | 11 | Angled Spread Variant |
| **`0xB5`** | `$00035B94` | `$00035A46` | (-1, +2) | **8** | 70 | 11 | Angled Spread |
| **`0xB6`** | `$00035BA6` | `$00035A8A` | (+2, +7) | **5** | 40 | 9 | Straight Down Stream |
| **`0xB7`** | `$00035BB8` | `$00035A96` | (+6, +3) | **5** | 40 | 9 | Straight East Stream |
| **`0xB8`** | `$00035BCA` | `$00035AA2` | (-1, +3) | **5** | 40 | 9 | Straight West Stream |
| **`0xB9`** | `$00035BDC` | `$00035AAE` | (-1, +0) | **8** | 80 | 10 | Wide High-Angle Fan |
| **`0xBA`** | `$00035BEE` | `$00035AEA` | (+1, +2) | **9** | 40 | 12 | 5-Way Half-Circle Fan |
| **`0xBB`** | `$00035C00` | `$000359FA` | (+1, +3) | **9** | 80 | 9 | Heavy 3-Way Cone |
| **`0xBC`** | `$00035C12` | `$000359FA` | (+1, +3) | **9** | 80 | 9 | Heavy 3-Way Cone Variant |

### 2. Bullet Vector Arrays (Fixed-Point $Vx, Vy$)

The vectors are pairs of 32-bit values $(Vx, Vy)$ terminated by the sentinel value `0x00002710` ($10,000$):

* **3-Way Upward Cone (`$000359FA`):**
1. $Vx = -707$, $Vy = -707$ (Up-Left 45°)
2. $Vx = 0$, $Vy = -1000$ (Straight Up 90°)
3. $Vx = +707$, $Vy = -707$ (Up-Right 45°)
4. Sentinel: `0x2710`


* **4-Way Upward Cone (`$00035A16`):**
1. $Vx = -1061$, $Vy = -1061$
2. $Vx = -389$, $Vy = -1449$
3. $Vx = +389$, $Vy = -1449$
4. $Vx = +1061$, $Vy = -1061$
5. Sentinel: `0x2710`


* **Single Straight Stream (`$00035A3A`):**
1. $Vx = 0$, $Vy = -1000$
2. Sentinel: `0x2710`


* **5-Way Fan (`$00035AEA`):**
1. 5 distinct $(Vx, Vy)$ direction vectors covering $180^\circ$.
2. Sentinel: `0x2710`
