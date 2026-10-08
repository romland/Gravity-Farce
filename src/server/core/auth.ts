import fs from 'fs';
import path from 'path';

const VALID_CHARS = `!#$%&'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[]^_abcdefghijklmnopqrstuvwxyz{|}~¡¢£¤¥¦§¨©ª«¬\xad®¯°±²³´µ¶·¸¹º»¼½¾¿ÀÁÂÃÄÅÆÇÈÉÊËÌÍÎÏÐÑÒÓÔÕÖ×ØÙÚÛÜÝÞßàáâãäåæçèéêëìíîïðñòóôõö÷øùúûüýþÿ`
const EASY_CHARS = `ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789`;

export class AuthManager {
    private dbPath: string;
    private aliases: Record<string, { uuid: string, approved: boolean }> = {}; // Mapping of ALIAS -> Object

    constructor(filename: string = 'server_aliases.json') {
        this.dbPath = path.resolve(process.cwd(), filename);
        this.load();
    }

    public validateOrClaim(alias: string, uuid: string, allowNew: boolean = true, requireApproval: boolean = false): { success: boolean, message?: string } {
        if (!alias || typeof alias !== 'string') return { success: false, message: 'INVALID ALIAS' };

        if (alias.length !== 3) {
            return { success: false, message: 'MUST BE EXACTLY 3 CHARACTERS' };
        }
        
        for (let i = 0; i < 3; i++) {
            if (!VALID_CHARS.includes(alias[i])) {
                return { success: false, message: 'CONTAINS INVALID CHARACTERS' };
            }
        }
        
        const existing = this.aliases[alias];
        if (existing) {
            if (existing.uuid !== uuid) {
                return { success: false, message: 'ALIAS ALREADY IN USE' };
            }

            if (!existing.approved) {
                return { success: false, message: 'ACCOUNT PENDING ADMIN APPROVAL' };
            }

            return { success: true };
        }
        
        // Enforce strict 1:1 mapping - ensure this UUID doesn't already own a different alias
        for (const [existingAlias, data] of Object.entries(this.aliases)) {
            if (data.uuid === uuid) {
                return { success: false, message: `DEVICE ALREADY REGISTERED AS ${existingAlias}` };
            }
        }

        if (!allowNew) {
            return { success: false, message: 'REGISTRATION CLOSED' };
        }

        // Always save as a predictable object structure
        this.aliases[alias] = { uuid, approved: !requireApproval };
        this.save();

        if (requireApproval) {
            return { success: false, message: 'ACCOUNT CREATED. PENDING ADMIN APPROVAL' };
        }

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
        if (fs.existsSync(this.dbPath)) {
            const data = JSON.parse(fs.readFileSync(this.dbPath, 'utf8'));
            let needsMigration = false;
            for (const key in data) {
                if (typeof data[key] === 'string') {
                    data[key] = { uuid: data[key], approved: true };
                    needsMigration = true;
                }
            }
            this.aliases = data;
            if (needsMigration) this.save();
        }
    }

    private save() {
        fs.writeFileSync(this.dbPath, JSON.stringify(this.aliases, null, 2));
    }
}

export const authDB = new AuthManager();