export const RENDER_CONFIG = {
    flora: {
        enabled: true,
        proxRadius: 56,          // Tight radius (px) where ship hull parts flora
        thrustRadius: 88,        // Radius (px) when engine thruster is firing
        proxExponent: 2.0,       // Quadratic falloff so edge approach is gentle, close contact bends deeply
        maxBendAngle: 1.15,      // Maximum bend angle (radians)
        bendStrength: 0.85,      // Base parting force multiplier
        thrustMultiplier: 1.30,  // Extra push multiplier when thrusting
        activeSpringK: 0.08,     // Spring stiffness while ship is parting the plant
        restSpringK: 0.035,      // Gentle return stiffness when ship leaves
        damping: 0.85,           // Velocity damping per frame
        windSpeed: 1.8,          // Ambient subterranean draft speed
        vineWindAmp: 7.0,        // Ambient sway amplitude (px) for hanging vines
        fernWindAmp: 5.0,        // Ambient sway amplitude (px) for floor ferns
        shroomWindAmp: 4.0,      // Ambient sway amplitude (px) for glow shrooms
        vineWashScale: 0.72,     // How far vine tips displace per radian of bend
        fernWashScale: 26.0,     // How far fern fronds displace per radian of bend
        shroomWashScale: 20.0,   // How far glow shrooms displace per radian of bend
        dripSpawnChance: 0.006,  // Chance per frame per emitter to spawn a water drop
        maxDrips: 35             // Max concurrent falling water drops
    },
    rock: {
        recessedEnabled: true,
        recessedOpacity: 1.0,   // Global opacity for the recessed cavern shadow
        recessedParallax: 0.35,  // Scroll factor for Layer -1 recessed cavern wall
        bedrockColor: '#261a14',
        strataColor: 'rgba(18, 11, 8, 0.45)',
        strataStepY: 28,
        strataHeight: 10,
        midBevelColor: '#5c3c26',
        midBevelWidth: 28,
        innerRimColor: '#8c5b37',
        innerRimWidth: 12,
        outerOutlineColor: '#b98250',
        outerOutlineWidth: 3.5
    },
    parallax: {
        enabled: true,
        pillarCount: 45,
        moteCount: 65,
        nearPillarDepth: 0.32,
        farPillarDepth: 0.18,
        moteParallax: 0.45
    }
};

if (typeof window !== 'undefined') {
    window.GF_RENDER_CONFIG = RENDER_CONFIG;
}