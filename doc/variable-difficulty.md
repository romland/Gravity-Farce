This dump at **`$00036576`** (specifically starting at `$000365CC`) gives us a massive piece of the configuration puzzle, even though it isn't an enemy spawner directly:

### What `$00036576` Actually Is:

This is the **Difficulty & Game Mode Physics Initializer**.

1. It reads a mode/difficulty configuration byte from **`$00037FCD`**.
2. It multiplies it by `16` (`lsl.l #$04, d6`), treating it as an index into a 16-byte configuration parameter table starting at **`$00036606`**.
3. It copies tuning parameters directly into global memory variables—including loading the longword at offset `+$0c` straight into **`$00037FB4`** (our core gravity/physics constant scale of `1000`!).

This proves that when a level loads, the engine adjusts gravity and physics constants based on the level type.

---

### How We Find the Real Homing Missile Entity ID

Since `$00036576` configures the environment, the routine that actually reads level file objects and spawns enemies into active slots must be one of the other startup routines.

Let's check the next two unmapped initialization entries from the top-level startup list to find the level entity stream parser:

```text
d 000355D2 30
d 00036666 30

```

Run those in WinUAE. One of them will handle reading the level file's entity/object stream and assigning type codes. Standing by!