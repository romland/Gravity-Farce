import fs from 'fs';
import path from 'path';

const VALID_CHARS = `!#$%&'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[]^_abcdefghijklmnopqrstuvwxyz{|}~¡¢£¤¥¦§¨©ª«¬\xad®¯°±²³´µ¶·¸¹º»¼½¾¿ÀÁÂÃÄÅÆÇÈÉÊËÌÍÎÏÐÑÒÓÔÕÖ×ØÙÚÛÜÝÞßàáâãäåæçèéêëìíîïðñòóôõö÷øùúûüýþÿ`
const EASY_CHARS = `ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789`;

export class AuthManager {
    private dbPath: string;
    private aliases: Record<string, string> = {}; // Mapping of ALIAS -> UUID

    constructor(filename: string = 'server_aliases.json') {
        this.dbPath = path.resolve(process.cwd(), filename);
        this.load();
    }

    public validateOrClaim(alias: string, uuid: string): { success: boolean, message?: string } {
        if (!alias || typeof alias !== 'string') return { success: false, message: 'INVALID ALIAS' };

        if (alias.length !== 3) {
            return { success: false, message: 'MUST BE EXACTLY 3 CHARACTERS' };
        }
        
        for (let i = 0; i < 3; i++) {
            if (!VALID_CHARS.includes(alias[i])) {
                return { success: false, message: 'CONTAINS INVALID CHARACTERS' };
            }
        }
        
        if (this.aliases[alias]) {
            if (this.aliases[alias] !== uuid) {
                return { success: false, message: 'ALIAS ALREADY IN USE' };
            }
            return { success: true };
        }
        
        // If the alias doesn't exist, claim it for this UUID!
        this.aliases[alias] = uuid;
        this.save();
        return { success: true };
    }

    public generateRandom(): string {
        let attempt = '';
        do {
            attempt = '';
            for (let i = 0; i < 3; i++) attempt += EASY_CHARS.charAt(Math.floor(Math.random() * EASY_CHARS.length));
        } while (this.aliases[attempt]);
        return attempt;
    }

    private load() {
        if (fs.existsSync(this.dbPath)) this.aliases = JSON.parse(fs.readFileSync(this.dbPath, 'utf8'));
    }

    private save() {
        fs.writeFileSync(this.dbPath, JSON.stringify(this.aliases, null, 2));
    }
}

export const authDB = new AuthManager();