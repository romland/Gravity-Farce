## How Prefabs Work

Breakdown of the current prefab architecture:

* **Why some prefabs cover many tiles in a rectangle right now:**
In `src/server/game/highres/ClusterPromoter.ts`, `extractPrefabs()` runs a 4-way flood-fill (`floodFillCluster`) across adjacent tiles of the same family (`BASE_STRUCTURE`, `BARREL_STACK`, `TEAL_BRICK`, `GRAVITY_EMITTER`, `ANTENNA_MAST`) and merges their bounding box into one big `{ x, y, w, h }` rectangle (`clusterToPrefab`).
Then `src/client/renderer/PrefabLayer.js` draws procedural placeholder rectangles (`fillRect`/`strokeRect` loops) over that bounding box!
* **How to create high-res WebP graphics (Resolution & Scale Rules):**
* **World Scale:** `1 Amiga tile (8×8 px)` = **`32×32 px` in game world space** (4× scale), and for crisp retina/4K zoom quality (like your `e5-enemy-384x256.webp` which is 2× oversampled for a `192×128` world hitbox), **author all prefab textures at 2× world resolution (`64×64 px` per 1×1 tile)** in `.webp` format with transparent backgrounds!
* **Exact Asset Resolution Guide:**
| Prefab / Tile Group | Amiga Tiles | World Size (`px`) | Recommended `.webp` Asset Size (2× Oversampled) |
| --- | --- | --- | --- |
| **Single Barrel / Crate** (`0x77–0x7B`, `0x86–0x8F`) | `1×1` tile | `32 × 32` | **`64 × 64 px`** (or `128 × 128 px` for a `2×2` stack) |
| **Base Command Module** (`0x67–0x6E`, `0x7C`) | `4×2` cluster | `128 × 64` | **`256 × 128 px`** (or `64 × 64 px` modular tiles) |
| **Antenna / Base Mast** (`0x7D–0x83`) | `1×2` or `1×3` | `32 × 64` / `32 × 96` | **`64 × 128 px`** / **`64 × 192 px`** |
| **Gravity Emitter** (`0x6F–0x72`) | `1×1` tile | `32 × 32` | **`64 × 64 px`** |
| **Landing Pad** (`0x15`, `0x29`) | `N×1` horizontal | `N*32 × 32` | **`64 × 64 px`** left-cap, mid-tile, right-cap (9-slice/3-slice) |




* **How to insert them:**
1. Drop the `.webp` files into `src/client/assets/environment/` (e.g., `src/client/assets/environment/barrel-stack.webp`, `base-structure.webp`).
2. Register them in `assetManager.loadMultiple({...})` inside `src/client/index.html` and pass `assetManager` into `PrefabLayer`.
3. In `PrefabLayer.js`, `drawBarrelStack` and `drawBaseStructure` automatically check `this.assetManager?.get(key)` first—if the `.webp` image is loaded, it draws the crisp sprite; otherwise it falls back to the procedural canvas art! (I have wired this sprite-ready support into `PrefabLayer.js` and `index.html` in the diff below so you can drop `.webp` files in immediately).
