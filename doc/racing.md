**Racing notes**

The key is here:

```m68k
00036e62 4eb9 0003 55b8    jsr $000355b8        ; Subroutine: GetTileAt(Ship.X, Ship.Y)
00036e68 1010              move.b (a0),d0       ; d0 = Tile ID under ship
00036e6a 0400 00d9         sub.b #$d9,d0        ; BOOM! Tile ID - 0xD9! 

```

This subtraction converts the invisible tile `0xDA` into `1`, `0xDB` into `2`, all the way to `0xE1` into `8`.

Teardown of the Race Checkpoint Engine:

### The Racing Variables (The `$000370C_` Block)

* **`$000370CA`**: **Race State**
* `0` = Waiting to Start
* `1` = Race in Progress
* `2` = Race Finished


* **`$000370CB`**: **Next Expected Checkpoint** (1 through 8)
* **`$000370CC`**: **Current Lap**
* **`$000370CD`**: **Total Laps Required**

### The Logic Flow

**1. The "Are We Racing?" Gate**

```m68k
00036e6e tst.b $000370ca           ; Is Race State == 0?
00036e74 beq.w $00036fae           ; If 0 (Waiting to Start), jump to $36FAE

```

If the race hasn't started, it jumps down to `$36FAE`, which does:

```m68k
00036fae cmp.b #$01,d0             ; Did we just touch Checkpoint 1?
00036fb2 beq.w $00036fb8           ; If yes, START THE RACE!

```

**2. The Checkpoint Verification**
If we *are* racing (State = 1):

```m68k
00036e78 cmp.b $000370cb,d0        ; Does touched checkpoint match expected checkpoint?
00036e7e beq.w $00036e84           ; If YES, process the hit!
00036e82 rts                       ; If NO, ignore and return

```

**3. Processing a Valid Checkpoint Hit**

```m68k
00036e84 move.b $000370cb,d0       
00036e8a addq.b #$01,$000370cb     ; Increment "Next Expected Checkpoint"
00036e90 cmp.b #$09,$000370cb      ; Did we just cross checkpoint 8 (meaning next is 9)?
00036e98 beq.w $00036ee4           ; If YES, process Lap Completion!

```

If it's just a normal checkpoint (2 through 8), it falls through, sets up an audio parameter (`move.l #$12, d0`), and calls `$00037374` to play the **"Checkpoint Ding"** sound effect!

**4. Lap Completion & Race Victory**
If we hit checkpoint 8, we jump to `$00036ee4`:

```m68k
00036eec move.b #$01,$000370cb     ; Reset expected checkpoint back to 1
00036ef4 addq.b #$01,$000370cc     ; Increment Current Lap
00036efa move.b $000370cd,d4       ; Load Total Laps Required
00036f00 cmp.b $000370cc,d4        ; Have we reached the required laps?
00036f06 bne.w $00036f66           ; If NO, branch to "Lap Finished" sound (#$12)

```

But if Current Laps == Required Laps:

```m68k
00036f12 move.b #$02,$000370ca     ; Set Race State = 2 (VICTORY / FINISHED)
00036f2a move.l #$00000013,d0      ; Load Victory Jingle ID (#$13)
; ...
00036f5e jsr $00037374             ; Play VICTORY SOUND!

```

### Our Port

The checkpoints are just sequential ID checks. Just need to read the tile directly under the player, check if it's between `0xDA` and `0xE1`, and run the state machine.

---
---
---

**Race Initialization** / **Checkpoint Light Sequencer**.

1. **`00036FB8` (Start Race):** It sets `RaceState = 1`, `NextCheckpoint = 2`, `CurrentLap = 0`, plays sound `#$12` (the race start ding), and calls the light toggler.
2. **`00037020` (Lap UI):** Converts the lap count to an ASCII string.
3. **`0003709A` (Blink Lights):** The `eor.b #$ff` block is **XORing the memory array**. It is literally flipping the color palette bytes of the checkpoint lights to make them blink on the screen!

### The Multiplayer Architecture (How we do it better)

In the original Amiga game, the race variables (`$000370CA` race state, `$000370CB` next checkpoint, etc.) were **global memory addresses**. This means the original engine could only really track one race state at a time.

To make this fully multiplayer so players can race *against* each other simultaneously, we simply attach these variables to the **Player ECS Component** instead of making them global.
