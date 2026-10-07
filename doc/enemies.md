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

## 2. Advanced Enemies (Flying / Combat)
*(Pending reverse-engineering of `$00031570` subsystem)*