### 1. Turret Memory Struct Format (`$12` / 18 bytes per entry)

Force vectors natively match screen coordinates (where +Y is downwards).  
Every 18-byte specification struct dictates exactly how a turret operates:

| Offset | Type | Field Name | Description |
| --- | --- | --- | --- |
| `+$00` | Long | **Vector Pointer** | Memory address pointing to the `(Vx, Vy)` firing arc array. |
| `+$04` | Word | **Muzzle X** | X-offset from tile center for bullet spawn. |
| `+$06` | Word | **Muzzle Y** | Y-offset from tile center for bullet spawn. |
| `+$08` | Byte | **Max HP** | Hit points required to destroy the turret. |
| `+$09` | Byte | *(Padding)* | Always `$00`. |
| `+$0A` | Word | **Score Value** | Points awarded upon destruction (e.g., `150`, `120`, `100`). |
| `+$0C` | Word | **Cooldown** | Frames between bursts (e.g., `80`, `40`). |
| `+$0E` | Word | **Anim / Flags** | Internal state flags or animation variants. |
| `+$10` | Word | **Sound ID** | Audio sample to play on fire. |

---

### 2. Master Turret Specification Table (`$00035B16`)


---
| Tile ID | Spec Addr | Vector Ptr | Muzzle (X, Y) | HP (`+$08`) | Cooldown | Sound ID | Behavior / Pattern Description |
| --- | --- | --- | --- | --- | --- | --- | --- |
| **`0xAE`** | `$00035B16` | `$000359FA` | (+1, +3) | **4** | 80 | 8 | 3-Way Cone Variant |
| **`0xAF`** | `$00035B28` | `$000359FA` | (+1, +3) | **4** | 80 | 8 | 3-Way Cone Up |
| **`0xB0`** | `$00035B3A` | `$00035A16` | (+1, +3) | **5** | 80 | 10 | 4-Way Cone Up |
| **`0xB1`** | `$00035B4C` | `$00035A16` | (+1, +3) | **5** | 80 | 10 | 4-Way Cone Variant |
| **`0xB2`** | `$00035B5E` | `$00035A3A` | (+2, +0) | **5** | 40 | 9 | Straight Up Stream |
| **`0xB3`** | `$00035B70` | `$00035A3A` | (+2, +0) | **5** | 40 | 9 | Straight Up Stream Variant |
| **`0xB4`** | `$00035B82` | `$00035A46` | (-1, +2) | **8** | 70 | 11 | 8-Way Arc Fan |
| **`0xB5`** | `$00035B94` | `$00035A46` | (-1, +2) | **8** | 70 | 11 | 8-Way Arc Fan |
| **`0xB6`** | `$00035BA6` | `$00035A8A` | (+2, +7) | **5** | 40 | 9 | Straight Down Stream |
| **`0xB7`** | `$00035BB8` | `$00035A96` | (+6, +3) | **5** | 40 | 9 | Straight East Stream |
| **`0xB8`** | `$00035BCA` | `$00035AA2` | (-1, +3) | **5** | 40 | 9 | Straight West Stream |
| **`0xB9`** | `$00035BDC` | `$00035AAE` | (-1, +0) | **8** | 80 | 10 | 7-Way Massive Fan |
| **`0xBA`** | `$00035BEE` | `$00035AEA` | (+1, +2) | **9** | 40 | 12 | 5-Way Half-Circle Fan |
| **`0xBB`** | `$00035C00` | `$000359FA` | (+1, +3) | **9** | 80 | 9 | Heavy 3-Way Cone |
| **`0xBC`** | `$00035C12` | `$000359FA` | (+1, +3) | **9** | 80 | 9 | Heavy 3-Way Cone Variant |

---

### 3. Bullet Vector Arrays (Fixed-Point $Vx, Vy$)

The vectors are pairs of 32-bit values $(Vx, Vy)$ terminated by the sentinel value `0x00002710` ($10,000$):

* **3-Way Upward Cone (`$000359FA`):**
1. $Vx = -707$, $Vy = -707$
2. $Vx = 0$, $Vy = -1000$
3. $Vx = +707$, $Vy = -707$
4. Sentinel: `0x2710`


* **4-Way Upward Cone (`$00035A16`):**
1. $Vx = -1061$, $Vy = -1061$
2. $Vx = -389$, $Vy = -1449$
3. $Vx = +389$, $Vy = -1449$
4. $Vx = +1061$, $Vy = -1061$
5. Sentinel: `0x2710`

* **8-Way Arc Fan (`$00035A46`):**
1. $Vx = -1000$, $Vy = 0$
2. $Vx = -901$, $Vy = -434$
3. $Vx = -623$, $Vy = -782$
4. $Vx = -223$, $Vy = -975$
5. $Vx = 223$, $Vy = -975$
6. $Vx = 623$, $Vy = -782$
7. $Vx = 901$, $Vy = -434$
8. $Vx = 1000$, $Vy = 0$
9. Sentinel: `0x2710`

* **Straight Streams:**
- **UP (`$00035A3A`):** $Vx = 0$, $Vy = -1000$
- **DOWN (`$00035A8A`):** $Vx = 0$, $Vy = 1000$
- **EAST (`$00035A96`):** $Vx = 1000$, $Vy = 0$
- **WEST (`$00035AA2`):** $Vx = -1000$, $Vy = 0$

* **7-Way Massive Spread (`$00035AAE`):**
1. $Vx = -1880$, $Vy = 684$
2. $Vx = -1000$, $Vy = 0$
3. $Vx = -1414$, $Vy = -1414$
4. $Vx = 0$, $Vy = -1000$
5. $Vx = 1414$, $Vy = -1414$
6. $Vx = 1000$, $Vy = 0$
7. $Vx = 1880$, $Vy = 684$
8. Sentinel: `0x2710`

* **5-Way Arc Fan (`$00035AEA`):**
1. $Vx = -1000$, $Vy = 0$
2. $Vx = -707$, $Vy = -707$
3. $Vx = 0$, $Vy = -1000$
4. $Vx = 707$, $Vy = -707$
5. $Vx = 1000$, $Vy = 0$
6. Sentinel: `0x2710`
