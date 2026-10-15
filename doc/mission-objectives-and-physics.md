# Objectives, Physics & Scoreboard Architecture

This document defines the authoritative rules for level objectives, physics isolation, and high-score tracking across all game disciplines in **Gravity Farce**.

---

## 1. Cavern Categories & Level Ranges

Levels extracted from the original Amiga binary are partitioned into three strict categories (`src/server/levels.ts`):

1. **Mission / Arcade Caverns (`00–49`)**:
   - **Cargo Missions**: If the cavern contains one or more cargo crates (`0xD1` Small = 1 weight / 5 pts, `0xD2` Large = 2 weight / 7 pts), the objective is to pick up all crates and unload them at your assigned **Home Base Pad** (`totalCargoRemaining === 0`).
   - **Navigation / Assault Missions**: If the cavern spawns with `initialCargoCount === 0`, the objective is to navigate the cavern and land safely on the designated **End Pad**.
2. **Race Courses (`50–63`)**:
   - Single-player (`50, 51, 53, 57`) and Multiplayer (`52, 54, 55, 56, 58–63`) checkpoint circuits (`0xDA–0xE1`).
3. **Dogfight Arenas (`64–65`)**:
   - Dedicated combat arenas for Player vs. Bot(s), Player vs. Player, and Team (`E2` vs. `E3`) elimination matches.

---

## 2. Permanent Home Base Assignment

To prevent disorientation and base-stealing across both Single-Player (SP) and Multiplayer (MP):

- Every pilot (human or bot) is assigned a permanent **Home Base Pad** (`homeSpawnX`, `homeSpawnY` corresponding to `0xE2` Player 1 or `0xE3` Player 2) upon their first spawn in a room.
- For the entire lifetime of that room, the pilot **always** respawns at their assigned Home Base and never swaps between `0xE2` and `0xE3`.
- If multiple ships share the same home platform, the server offsets their horizontal landing coordinates along the pad width (`X` axis) while keeping `Y` locked to the platform deck.
- Cargo can **only** be unloaded at the pilot's own assigned Home Base.

---

## 3. Physics Hash & Bot Isolation

High scores are strictly bound to the physical ruleset under which they were achieved (`RecordManager.generatePhysicsHash`):

- **Physics Constants**: Gravity (`0.010` Classic vs `0.015` Modern), Thrust (`0.070` vs `0.100`), Max Speed (`7.5` vs `10.0`), `lethalRacingEnemies`, and `raceBumpModifier`.
- **Bot Presence (`botCount`)**: Spawning AI bots into a cavern alters the tactical and physical environment. Whenever `botCount > 0`, `_bots_${botCount}` is hashed into the `physicsHash`, isolating those records onto their own leaderboard and displaying `[WITH BOTS: N]` in the Run Summary and Leaderboard headers.
- **Bot Pilot League (`:bot` suffix)**: Pilots registered with the **BOT / AI PILOT** flag (`server_aliases.json` -> `isBot: true`) compete on separate `:bot` leaderboards so human and AI records never pollute each other.

---

## 4. Single-Player Mission Leaderboards (Caverns `00–49`)

Mission mode features **three layers** of competitive progression:

### A. Per-Cavern Specialist Disciplines (Tracked per Cavern `00–49`)
1. **`BLITZ` (`sp_fastest`)**: Fastest cavern completion time (Primary: `timeMs` ASC, Secondary: `levelPoints` DESC).
2. **`PACIFIST` (`sp_sneakiest`)**: Lowest points scored during completion — rewards pure stealth/ghost flying without destroying enemies (Primary: `levelPoints` ASC, Secondary: `timeMs` ASC).
3. **`TREEHUGGER` (`sp_eco`)**: Least fuel consumed during completion (Primary: `fuelConsumed` ASC, Secondary: `timeMs` ASC).
4. **`PERFECTION` (`sp_cleared`)**: Fastest completion time with **100% enemy destruction** (all turrets, tanks, and destructible flying enemies eliminated).
5. **`SNIPER` (`sp_sharpshooter`)**: Fewest shots fired while achieving **100% enemy destruction** (Primary: `shotsFired` ASC, Secondary: `timeMs` ASC).

### B. 5-Lives Sequential Streak (`arcade_score` — Classic Ironman Run)
- Measures how many points a pilot can rack up on a single allocation of **5 lives** (`SERVER_CONFIG.defaultLives`) while playing mission caverns **strictly in sequence** (e.g., `C00 -> C12`, or `C10 -> C20`).
- **Zero-Friction Banking**:
  - When a pilot starts at any mission cavern $L$, `streakStartLevel = L`, `score = 0`, and `lives = 5`.
  - Each time the pilot beats cavern $L$ and advances sequentially to $L + 1$ (`NEXT LEVEL`), their accumulated score and remaining lives carry forward, and the server **immediately banks/updates** their `arcade_score` entry (recording the span `Cxx-Cyy`).
  - If the pilot loses all 5 lives (`GAME OVER`), their final accumulated score is also submitted.
  - If the pilot manually jumps to a non-sequential cavern, switches to a Race/Dogfight, or clicks `RETRY CAVERN`, their previous streak remains safely banked on the leaderboard and a brand-new 5-lives streak begins cleanly at the new cavern (`score = 0, lives = 5`).
- Arcade records (`arcade_score`) **only** count on Mission levels (`00–49`), never on Race or Dogfight levels.

### C. 50-Cavern Campaign Mastery (`campaign_*` — All-Cavern Aggregator)
- Unlike the 5-Lives Streak, **Campaign Mastery** does not care about lives or level order. Pilots can replay any individual cavern (`00–49`) as many times as they want to improve their personal best on that cavern.
- Every time a pilot completes a mission cavern, `RecordManager.recalculateCampaignMastery()` sums their best records across all mission caverns (`00–49`) they have ever cleared under that `physicsHash`:
  1. **`CAMPAIGN SCORE` (`campaign_score`)**:
     - **Primary**: Sum of the pilot's highest points scored on each cleared cavern (`DESC`).
     - **Secondary**: Sum of completion times from those best-score runs (`ASC`).
     - If a pilot has cleared 10 of the 50 caverns, their aggregate score across those 10 caverns is immediately ranked (`014200 PTS (10/50) | 06:12.400`). Clearing more caverns or improving a score on an existing cavern automatically raises their total.
  2. **`CAMPAIGN BLITZ` (`campaign_time`)**:
     - **Primary**: Total number of unique mission caverns cleared out of 50 (`DESC`).
     - **Secondary**: Sum of the pilot's fastest `BLITZ` times across those cleared caverns (`ASC`).
  3. **`CAMPAIGN ECO` (`campaign_fuel`)**:
     - **Primary**: Total number of unique mission caverns cleared out of 50 (`DESC`).
     - **Secondary**: Sum of the pilot's lowest `TREEHUGGER` fuel consumption across those cleared caverns (`ASC`).