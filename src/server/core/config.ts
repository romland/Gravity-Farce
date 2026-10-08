import fs from 'fs';
import path from 'path';

export interface ServerConfig {
    debugMode: boolean;
    lethalRacingEnemies: boolean;
    raceBumpModifier: number;
    port: number;
    tickRate: number;
    useClassicPhysics: boolean;
    allowNewRegistrations: boolean;
    requireManualApproval: boolean;
    maxPlayers: number;
}

const DEFAULT_CONFIG: ServerConfig = {
    debugMode: process.env.NODE_ENV !== 'production',
    lethalRacingEnemies: false, // Configurable toggle for race course hazards
    raceBumpModifier: 0.6, // Modifier for the bump force
    port: parseInt(process.env.PORT || '10000', 10),
    tickRate: 60, // Server updates per second
    useClassicPhysics: true, // Amiga purist mode vs modern
    allowNewRegistrations: true, // If false, only known players can connect
    requireManualApproval: false, // If true, new players must be set to 'approved: true' in JSON
    maxPlayers: 50 // Global connection cap
};

export class ConfigManager {
    private configPath: string;
    public current: ServerConfig;

    constructor(filename: string = 'data/server_config.json') {
        this.configPath = path.resolve(process.cwd(), filename);
        this.current = { ...DEFAULT_CONFIG };
        this.load();
    }

    private load() {
        if (fs.existsSync(this.configPath)) {
            try {
                const data = JSON.parse(fs.readFileSync(this.configPath, 'utf8'));
                this.current = { ...DEFAULT_CONFIG, ...data }; // Merge disk overrides on top of defaults
            } catch (e) {
                console.error("Failed to parse server_config.json, using defaults.");
            }
        }
        this.save(); // Ensures the file exists with all default keys merged
    }

    public save() {
        const dir = path.dirname(this.configPath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        fs.writeFileSync(this.configPath, JSON.stringify(this.current, null, 2));
    }
}

export const configManager = new ConfigManager();
export const SERVER_CONFIG = configManager.current;