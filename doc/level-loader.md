# Amiga Level Loader & Entity Parser

Map the routines responsible for copying the raw uncompressed level data from the ADF disk buffer into the active game state and parsing the tile entities.

## 1. Level Memory Copy (`$0003BA40`)

The Amiga engine stores uncompressed raw level data starting at Slow RAM base `$00C00000`. When a level is loaded:

1. The engine reads the Level Index into `D0`.
2. It multiplies `D0` by `525` (`MULU.W #$020D, D0`).
3. It bit-shifts the result left by 3 (`LSL.L #$03, D0`), which mathematically multiplies it by 8. 
   * `525 * 8 = 4200 bytes`. This exactly matches the transposed 42x100 tilemap size we proved earlier.
4. It adds this offset to `$00C00000` to find the start of the specific level data.

## 2. Entity Parsing Loop (`$00033E20`)
5. It enters a bulk memory copy loop (`$0003BA9C`), copying `1050` longwords (`$0419` loop iterations * 4 bytes = 4200 bytes) straight into the active level buffer at `$00050460`. It is a pure 1:1 `memcpy`, no decompression involved.

Immediately after the tilemap is written to `$00050460`, the engine sweeps the 4200-byte array to spawn dynamic entities.

* It clears the Ground Unit (Tank) array at `$0003769E` (`move.l #$00000000,$0003769e`).
* It increments through the map array at `$00050460` (`move.b (a3)+, d3`).
* It compares the tile ID (`D3`) against known entity thresholds:
  * **`CMP.B #$32, D3`**: Matches Ground Unit (Tank) Paths (`0x32` - `0x3A`).
  * **`CMP.B #$E2, D3` / `#$E3, D3`**: Matches Multiplayer Spawns.
  * **`CMP.B #$AE, D3`**: Detects Turrets.

## 3. Turret Spec Linker (`$0003404C`)

When a turret tile is found (IDs `0xAE` to `0xBC`):
1. The engine loads the base of the Spec Table (`LEA $00035B04, A6`).
2. It subtracts the base ID `0xAD` from the tile ID (`SUB.B #$AD, D6`), yielding a 1-based index.
3. It multiplies the index by 18 (`MULU.W #$0012, D6`), which is the exact size of the Turret Struct in bytes.
4. It adds the result to `A6`, pointing exactly at the Turret's config struct (e.g., `0xAE` perfectly resolves to `$00035B16`).

This proves that our extracted turret specification table at `$00035B16` is completely accurate.