// e.g:
// node scripts/find-tiles.js 34-3A
// node scripts/find-tiles.js CC
import fs from 'fs';
import path from 'path';

const args = process.argv.slice(2);
if (args.length === 0) {
    console.error("Usage: node scripts/find-tiles.js <hex-or-range> [e.g. 34 or 34-3A]");
    process.exit(1);
}

const input = args[0].toUpperCase().replace(/0X/g, '');
let minTile, maxTile;

if (input.includes('-')) {
    const parts = input.split('-');
    minTile = parseInt(parts[0], 16);
    maxTile = parseInt(parts[1], 16);
} else {
    minTile = parseInt(input, 16);
    maxTile = minTile;
}

const dataPath = path.resolve(process.cwd(), 'src/server/data/org-levels.json');
if (!fs.existsSync(dataPath)) {
    console.error(`ERROR: Map data not found at ${dataPath}. Run the extractor first.`);
    process.exit(1);
}

const levels = JSON.parse(fs.readFileSync(dataPath, 'utf8'));

const hexStr = (num) => `0x${num.toString(16).toUpperCase().padStart(2, '0')}`;

console.log(`\nScanning for tiles ${hexStr(minTile)} to ${hexStr(maxTile)}...`);
console.log("".padEnd(90, "-"));
console.log(`| ${'LVL'.padEnd(4)} | ${'COUNT'.padEnd(5)} | ${'CLOSEST DIST'.padEnd(12)} | ${'CLOSEST TILES (X,Y)[ID]'.padEnd(55)} |`);
console.log("".padEnd(90, "-"));

let totalFound = 0;

for (const level of levels) {
    let spawnP1 = null;
    const matches = [];

    // Locate P1 Spawn (0xE2)
    for (let y = 0; y < level.map_data.length; y++) {
        for (let x = 0; x < level.map_data[y].length; x++) {
            if (level.map_data[y][x] === 0xE2 && !spawnP1) {
                spawnP1 = { x, y };
            }
        }
    }

    // Scan for targets and calculate distances
    for (let y = 0; y < level.map_data.length; y++) {
        for (let x = 0; x < level.map_data[y].length; x++) {
            const t = level.map_data[y][x];
            if (t >= minTile && t <= maxTile) {
                let dist = Infinity;
                if (spawnP1) {
                    dist = Math.sqrt(Math.pow(x - spawnP1.x, 2) + Math.pow(y - spawnP1.y, 2));
                }
                matches.push({ x, y, dist, tile: t });
            }
        }
    }

    if (matches.length > 0) {
        totalFound += matches.length;
        matches.sort((a, b) => a.dist - b.dist);
        
        const closestDist = matches[0].dist;
        const closestMatches = matches.filter(m => Math.abs(m.dist - closestDist) < 0.01).slice(0, 3); // Show up to 3 ties

        const coordsStr = closestMatches.map(m => `(${m.x},${m.y})[${hexStr(m.tile)}]`).join(', ');
        const distStr = closestDist === Infinity ? 'N/A' : closestDist.toFixed(2);

        console.log(`| ${level.level_id.toString().padEnd(4)} | ${matches.length.toString().padEnd(5)} | ${distStr.padEnd(12)} | ${coordsStr.padEnd(55)} |`);
    }
}
console.log("".padEnd(90, "-"));
console.log(`TOTAL DETECTED IN LEVELS: ${totalFound}\n`);