# TODO dig deeper on this

This dump at **`$00036576`** (specifically starting at `$000365CC`) gives us a massive piece of the configuration puzzle

### What `$00036576` Actually Is:

This is the **Difficulty & Game Mode Physics Initializer**.

1. It reads a mode/difficulty configuration byte from **`$00037FCD`**.
2. It multiplies it by `16` (`lsl.l #$04, d6`), treating it as an index into a 16-byte configuration parameter table starting at **`$00036606`**.
3. It copies tuning parameters directly into global memory variables—including loading the longword at offset `+$0c` straight into **`$00037FB4`** (our core gravity/physics constant scale of `1000`!).

on level load the engine might adjust gravity and physics constants based on the level type.
