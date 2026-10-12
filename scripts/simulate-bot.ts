// use: npx tsx scripts/simulate-bot.ts
import { Room } from '../src/server/Room';
import { getLevelData } from '../src/server/levels';
import { spawnRacingBot } from '../src/server/game/bot-racing';
import { SERVER_CONFIG } from '../src/server/core/config';

// Force debug mode so telemetry prints
SERVER_CONFIG.debugMode = true;

// Mock Socket.IO server to prevent network sync crashes
const mockIo = {
    to: () => ({ emit: () => {} }),
    sockets: { sockets: new Map() }
} as any;

function runSimulation(levelIndex: number) {
    console.log(`\n🏎️  BOOTING HEADLESS BOT SIMULATOR FOR LEVEL ${levelIndex}...`);
    
    // Initialize standard room with lethal racing turned off (bump only, or true if you want instant death testing)
    const room = new Room(levelIndex, getLevelData(levelIndex), mockIo, () => {}, false, 0.4);
    
    // Find Player 2 spawn point, or fallback to known Level 50 safe coordinate
    const spawn = room.level.entities.find(e => e.type === 0xE3 || e.type === 'spawn') || { x: 658, y: 592 };
    
    // Spawn the bot
    const botEntity = spawnRacingBot(room.ecs, spawn.x, spawn.y, "SIM", room.level);
    console.log(`🏁 Bot spawned at (${spawn.x}, ${spawn.y}). Thrusters engaged.\n`);

    let ticks = 0;
    const MAX_TICKS = 15000; // ~4 minutes at 60 ticks/sec

    while (ticks < MAX_TICKS) {
        room.tick(false);
        ticks++;

        const p = room.ecs.players.get(botEntity);
        
        // 1. Crash Detection
        if (!p || p.isDead) {
            console.log(`\n❌ SIMULATION HALTED: Bot crashed at tick ${ticks}.`);
            // The crash telemetry and ASCII map are automatically printed by sysRacingBotAI
            process.exit(1);
        }

        // 2. Success Detection
        if (p.race && p.race.state === 2) {
            const totalTimeStr = ((p.race.finishTime! - p.race.startTime) / 1000).toFixed(2);
            const lapTimesStr = p.race.lapTimes.map(t => (t / 1000).toFixed(2) + "s").join(', ');
            
            console.log(`\n🏆 SIMULATION SUCCESS: Bot solved the map!`);
            console.log(`⏱️  Total Time: ${totalTimeStr}s`);
            console.log(`⏱️  Lap Splits: ${lapTimesStr}`);
            console.log(`⏱️  Engine Ticks: ${ticks}`);
            process.exit(0);
        }
    }

    console.log(`\n⚠️ SIMULATION TIMED OUT: Reached ${MAX_TICKS} ticks. Bot is stuck or flying in circles.`);
    process.exit(1);
}

// Execute on Level 50
runSimulation(50);