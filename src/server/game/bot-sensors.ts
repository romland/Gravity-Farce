// ----------------------------------------------------------------------------
// Unified Tactical Sensors (Used by all Combat/Mission Bots)
// ----------------------------------------------------------------------------
import { Registry, type Entity } from '../core/ecs';
import type { Room } from '../Room';
import { raycastEnvironment } from '../core/math';
import { TILE_DICTIONARY } from '../core/tiles';
import { SERVER_CONFIG } from '../core/config';
import { getTurretSpecByTile } from './turret-defs';
import { getAngleDiff } from './bot-utils';

// ----------------------------------------------------------------------------
// Unified Tactical Sensors (Used by all Combat/Mission Bots)
// ----------------------------------------------------------------------------

export interface TacticalSensors {
    friendlyInLineOfFire: boolean;
    repelX: number;
    repelY: number;
    isEmergency: boolean;
    throttleMultiplier: number;
}

export function evaluateTacticalSensors(
    ecs: Registry, 
    myEnt: Entity, 
    myT: import('../core/ecs').Transform, 
    myV: import('../core/ecs').Velocity, 
    bot: import('../core/types').BotState, 
    noseAngle: number = 0, 
    targetDist: number = Infinity
): TacticalSensors {
    const tactics: TacticalSensors = { friendlyInLineOfFire: false, repelX: 0, repelY: 0, isEmergency: false, throttleMultiplier: 1.0 };
    const myId = (ecs.players.get(myEnt) as any)?.id || (ecs.players.get(myEnt) as any)?.uuid;

    // 1. SQUADMATES (Friendly Fire & Clumping Avoidance)
    const bots = Array.from(ecs.bots.entries());
    for (const [otherE] of bots) {
        if (otherE === myEnt) continue;
        const pt = ecs.transforms.get(otherE);
        const pp = ecs.players.get(otherE);
        if (!pt || pp?.isDead) continue;

        const distToFriend = Math.hypot(pt.x - myT.x, pt.y - myT.y);
        if (distToFriend < targetDist && targetDist !== Infinity) {
            const angleToFriend = Math.atan2(pt.y - myT.y, pt.x - myT.x);
            const diff = Math.abs(getAngleDiff(noseAngle, angleToFriend));
            if (Math.sin(diff) * distToFriend < 24) tactics.friendlyInLineOfFire = true;
        }
        if (distToFriend < 70 && distToFriend > 1) {
            const push = Math.pow((70 - distToFriend) / 70, 2) * 4.0;
            tactics.repelX -= ((pt.x - myT.x) / distToFriend) * push;
            tactics.repelY -= ((pt.y - myT.y) / distToFriend) * push;
        }
    }

    // 2. INCOMING BULLETS (Evasion)
    const projectilesMap = (ecs as any).bullets || (ecs as any).projectiles;
    if (projectilesMap) {
        for (const [pe, proj] of projectilesMap.entries()) {
            if (proj.ownerId === myId) continue;
            const pt = ecs.transforms.get(pe) || (proj as any);
            const pv = ecs.velocities.get(pe) || (proj as any);
            if (!pt || !pv) continue;

            const dx = pt.x - myT.x;
            const dy = pt.y - myT.y;
            const distToBullet = Math.hypot(dx, dy);

            if (distToBullet < 250) {
                const relativeVx = pv.vx - myV.vx;
                const relativeVy = pv.vy - myV.vy;
                const dotProduct = (dx * relativeVx + dy * relativeVy);
                if (dotProduct < 0) {
                    const timeToImpact = -dotProduct / (relativeVx * relativeVx + relativeVy * relativeVy);
                    if (timeToImpact > 0 && timeToImpact < 25) { 
                        const projX = pt.x + pv.vx * timeToImpact;
                        const projY = pt.y + pv.vy * timeToImpact;
                        const myProjX = myT.x + myV.vx * timeToImpact;
                        const myProjY = myT.y + myV.vy * timeToImpact;
                        const missDist = Math.hypot(projX - myProjX, projY - myProjY);
                        if (missDist < 35) {
                            const evadeAngle = Math.atan2(pv.vy, pv.vx) + (Math.PI / 2);
                            tactics.repelX += Math.cos(evadeAngle) * 8.0;
                            tactics.repelY += Math.sin(evadeAngle) * 8.0;
                            tactics.isEmergency = true;
                        }
                    }
                }
            }
        }
    }

    // 3. MAP ENEMIES & HUMANS (Ram Avoidance & Turret Arcs)
    const checkMapEnemy = (ee: Entity, width: number, height: number, type: string) => {
        if (bot.targetId === `${type}_${ee}` || bot.targetId === String(ee)) return; // Don't yield to our target

        const et = ecs.transforms.get(ee);
        if (!et) return;
        
        const radius = Math.max(width, height) / 2;
        const distToEnemy = Math.hypot(et.x - myT.x, et.y - myT.y);
        const avoidDist = type === 'human' ? 90 : radius + 70;
        
        if (distToEnemy < avoidDist && distToEnemy > 1) {
            const push = Math.pow((avoidDist - distToEnemy) / avoidDist, 2) * 6.0;
            tactics.repelX -= ((et.x - myT.x) / distToEnemy) * push;
            tactics.repelY -= ((et.y - myT.y) / distToEnemy) * push;
        }

        // Turret specific firing arc avoidance
        if (type === 'turret') {
            const turret = ecs.turrets.get(ee);
            if (turret && turret.active && distToEnemy < 350) {
                const spec = getTurretSpecByTile(turret.turretType);
                const angleToBot = Math.atan2(myT.y - et.y, myT.x - et.x);
                for (const vec of spec.vectors) {
                    const fireAngle = Math.atan2(vec.vy, vec.vx);
                    const diff = getAngleDiff(angleToBot, fireAngle);
                    if (Math.abs(diff) < 0.35) {
                        const strafeForce = (0.35 - Math.abs(diff)) * 25.0; 
                        const sign = diff > 0 ? 1 : -1;
                        const evadeAngle = fireAngle + (Math.PI / 2) * sign;
                        tactics.repelX += Math.cos(evadeAngle) * strafeForce;
                        tactics.repelY += Math.sin(evadeAngle) * strafeForce;
                        tactics.isEmergency = true; 
                    }
                }
            }
        }
    };

    const humans = Array.from(ecs.players.entries()).filter(([e, p]) => !p.isDead && !ecs.bots.has(e));
    for (const [he] of humans) checkMapEnemy(he, 32, 32, 'human');
    for (const [ee, tank] of ecs.tanks.entries()) if (tank.active) checkMapEnemy(ee, tank.width, tank.height, 'tank');
    for (const [ee, flying] of ecs.flyingEnemies.entries()) if (flying.active) checkMapEnemy(ee, flying.width, flying.height, 'flying');
    for (const [ee, turret] of ecs.turrets.entries()) if (turret.active) checkMapEnemy(ee, turret.width, turret.height, 'turret');

    return tactics;
}
