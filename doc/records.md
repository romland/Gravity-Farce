# Gravity Farce - Records Subsystem

## The Problem
Single-player (SP) and Multi-player (MP) are fundamentally different disciplines. A fast time in MP requires dodging enemy fire and navigating chaos, whereas SP is a pure racing line time-trial. Additionally, if the server admin changes the global `gravity` or `thrust` constants, all previous high scores become instantly invalid.

## The Solution: Composite Keys
Leaderboards are strictly isolated by dynamically generating a composite key for every entry:
`<metric>:lvl_<level_id>:<mode>:phys_<hash>`

*Example:* `fastest_lap:lvl_3:SP:phys_4a23b816`

If the physics settings are tweaked, the hash changes, generating a pristine, clean leaderboard organically without wiping the old data.

## Data Caps & Personal Bests
To prevent the `server_records.json` file from growing infinitely and to ensure leaderboard diversity:
1. **Strictly One Entry Per Player:** If a player achieves a new time, it is compared against their existing entry for that specific key. It only saves if it is a new Personal Best (PB).
2. **Hard Limit:** Each leaderboard is hard-capped (e.g., top 50 entries). If a player's PB falls out of the top 50, it is discarded. 

## Composite Sorting (Time & Score Combinations)
To support complex criteria (like ranking players by time, but breaking ties by score), the `SortOrder` system supports composite keys evaluated sequentially against a `value` and `secondaryValue`:

*   `'asc'`: Simple ascending (Lowest primary wins - e.g., Time only)
*   `'desc'`: Simple descending (Highest primary wins - e.g., Score only)
*   `'asc_desc'`: Lowest primary wins. Ties broken by Highest secondary. 
*   `'asc_asc'`: Lowest primary wins. Ties broken by Lowest secondary.

### Example Single-Player Map Leaderboards:
When a player completes a single-player sector, three distinct records are pushed:
1. **Fastest:** `sort: 'asc_desc'`
   * `value`: Time (Lowest wins)
   * `secondaryValue`: Score (Highest wins if times are exact)
2. **Sneakiest:** `sort: 'asc_asc'`
   * `value`: Score (Lowest score wins - avoiding combat!)
   * `secondaryValue`: Time (Lowest time wins if scores tie)
3. **Cleared (100% Kills):** `sort: 'asc'`
   * Only logged if `enemiesRemaining === 0`. Evaluates purely by Time (`value`).
4. **Sharpshooter (100% Kills):** `sort: 'asc_asc'`
   * Only logged if `enemiesRemaining === 0`.
   * `value`: Fewest bullets fired (Lowest wins).
   * `secondaryValue`: Time (Lowest time wins tiebreakers).
5. **Eco-Run:** `sort: 'desc_asc'`
   * `value`: Fuel remaining (Highest fuel wins).
   * `secondaryValue`: Time (Lowest time wins tiebreakers).

## Server-Driven UI Routing
The server decides *what* leaderboards to show and *when*. It pushes a target-specific `leaderboard` event to the ECS event bus. The client catches this and renders a dynamic HTML overlay.

*Example Payload:*
```json
{
  "type": "leaderboard",
  "target": "socket_id_of_player",
  "boards": [
    {
      "title": "FASTEST RACE TIMES",
      "entries": [ { "alias": "AAA", "value": 12450 } ]
    },
    {
      "title": "FASTEST LAP TIMES",
      "entries": [ { "alias": "AAA", "value": 3120 } ]
    }
  ]
}
```