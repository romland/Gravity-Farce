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