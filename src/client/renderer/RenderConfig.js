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
        maxDrips: 35,            // Max concurrent falling water drops
        broadleafEnabled: true,
        caveFlowerEnabled: true,
        vineBlossomsEnabled: true,
        firefliesEnabled: true,
        fireflyRadius: 1.8,
        fireflyAlpha: 0.45,
        localHaloEnabled: true,
        shroomHaloRadius: 16.0,
        shroomHaloAlpha: 0.22,
        flowerHaloRadius: 14.0,
        flowerHaloAlpha: 0.20,
        vineTipHaloRadius: 7.0,
        vineTipHaloAlpha: 0.16
    },
    rock: {
        recessedEnabled: true,
        recessedOpacity: 1.0,   // Global opacity for the recessed cavern shadow
        recessedParallax: 0.35,  // Scroll factor for Layer -1 recessed cavern wall
        bedrockColor: '#261a14',
        strataColor: 'rgba(18, 11, 8, 0.45)',
        strataStepY: 28,
        strataHeight: 10,
        strataWarpAmp1: 12,
        strataWarpAmp2: 4,
        grainEnabled: true,
        grainSpeckleCount: 750,
        grainFissureCount: 22,
        midBevelColor: '#5c3c26',
        midBevelWidth: 28,
        innerRimColor: '#8c5b37',
        innerRimWidth: 12,
        outerOutlineColor: '#b98250',
        outerOutlineWidth: 3.5,
        stalactitesEnabled: true,
        stalactiteMaxSpanPx: 140, // Max horizontal thickness of a rock feature to receive internal stalactite/stalagmite faceting
        stalactiteRidgeAlpha: 0.38,
        stalactiteShadeAlpha: 0.42,
        wetSheenEnabled: true,
        wetSheenColor: 'rgba(155, 228, 255, 0.32)',
        wetSheenWidth: 1.8,
        wetDripRangeX: 140,
        wetDripRangeY: 380,
        mineralVeinsEnabled: true,
        mineralVeinDensityDivisor: 55000
    },
    parallax: {
        enabled: true,
        pillarCount: 45,
        moteCount: 65,
        nearPillarDepth: 0.32,
        farPillarDepth: 0.18,
        moteParallax: 0.45,
        nebulaEnabled: true,
        nebulaCount: 7,
        nebulaParallax: 0.12,
        nebulaOpacity: 0.45,
        godRaysEnabled: true,
        godRayCount: 5,
        godRayOpacity: 0.40
    },
    lighting: {
        enabled: true,
        scale: 0.25,
        ambientIntensity: 0.28,   // Master multiplier for baked environmental lightmap
        pulseSpeed: 2.2,
        pulseAmplitude: 0.06,
        shroomRadius: 68,
        shroomIntensity: 0.24,
        flowerRadius: 56,
        flowerIntensity: 0.20,
        vineTipRadius: 36,
        vineTipIntensity: 0.14,
        padRadius: 80,
        padIntensity: 0.18,
        baseRadius: 95,
        baseIntensity: 0.20,
        gravityRadius: 85,
        gravityIntensity: 0.22,
        beaconRadius: 48,
        beaconIntensity: 0.22,
        raceMarkerRadius: 52,
        raceMarkerIntensity: 0.26,
        raceMarkerLocalGlowRadius: 24,
        raceMarkerLocalGlowAlpha: 0.24,
        activeCheckpointGlowRadius: 28,
        activeCheckpointGlowAlpha: 0.45,
        shipLightEnabled: true,
        shipIdleRadius: 44,
        shipIdleIntensity: 0.08,
        shipThrustRadius: 90,
        shipThrustIntensity: 0.20
    },
    details: {
        enabled: true,
        thrusterDustEnabled: true,
        thrusterScorchEnabled: true,
        thrusterWallReachPx: 46,
        scorchHeatDecay: 0.012,
        maxHeatSpots: 28,
        waterInteractionsEnabled: true,
        dripRippleMaxCount: 25,
        bulletImpactsEnabled: true,
        bulletScorchMarksEnabled: true,
        ricochetSparkCount: 6,
        maxSparks: 90,
        foliageShreddingEnabled: true,
        maxLeafConfetti: 40,
        bulletWakeEnabled: true,
        bulletWakeRadius: 28,
        turretBarrelSmokeEnabled: true,
        turretSmokeChance: 0.018,
        maxSmokePuffs: 35,
        landingEffectsEnabled: true,
        hardLandingVyThreshold: 1.25,
        padVentCountPerSide: 4,        // Number of slow vapor puffs per side on touchdown
        padVentSpeedX: 0.42,           // Gentle horizontal drift speed so vapor stays near the ship
        padVentLifeTicks: 88,          // Long, slow dissolve time (in frames)
        padVentAlpha: 0.34,            // Soft, subtle mist opacity
        padVentGrowRate: 0.06,         // Slow expansion rate as mist dissolves
        padWeightInteractionEnabled: true,
        shyFloraEnabled: true,
        shySpeedThreshold: 4.2,
        shyShipRadius: 95,
        shyBulletRadius: 85,
        shyRecoveryRate: 0.015,
        gravityStreamsEnabled: true,
        gravityMotesPerTile: 2,
        gravityStreamSpeed: 1.4,
        gravityStreamColor: 'rgba(185, 120, 255, 0.38)',
        crystalGlintsEnabled: true,
        crystalVertexStride: 19,
        crystalGlintAlpha: 0.75,
        crashStainsEnabled: true,
        crashStainRadius: 38,
        crashStainAlpha: 0.72,
        crashRayCount: 14,
        crashFloraCharRadius: 68,
        maxPrefabScorches: 40,
        crashSmokeEnabled: true,
        crashSmokeDurationTicks: 210, // ~3.5 seconds of lingering smoke emission at 60fps
        crashSmokeSpawnChance: 0.42,  // Chance per frame to emit a dark smoke puff while active
        crashSmokeAlpha: 0.75,        // High-visibility peak opacity for dark crash smoke
        maxCrashPlumes: 12,           // Max concurrent smoking crash sites
        smokePushRadius: 75,          // Radius where ships push smoke particles aside
        smokePushForce: 0.85,          // Strength of ship thruster wash deflection on smoke
        waterPoolsEnabled: true,
        maxWaterPools: 6,              // Max subterranean pools per level
        waterRarityChance: 0.85,       // Chance for a qualifying basin to hold water
        waterMinSpanTiles: 2,          // Minimum width (in 32px tiles) of a rock/tree basin
        waterMaxSpanTiles: 10,         // Maximum width (in 32px tiles) of a rock/tree basin
        waterMinBankRiseTiles: 1,      // Left & right banks must rise at least this many tiles above the pool floor
        waterDepthPx: 18,              // Depth of water surface inside the bottom of the rock basin
        waterOverlapPx: 24,            // How far water extends into surrounding solid tiles (clipped by RockLayer)
        waterAllowTreeBases: true,     // Allow water to pool against Ground->Tree transitions and tree roots
        waterAllowedGroundTiles: [
            0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0A, 0x0B, 0x0C, 0x0D, 0x0F,
            0x11, 0x12, 0x14, 0x16, 0x17, 0x19, 0x1A, 0x22, 0x23,
            0x5E, 0x5F, 0x60, 0x61, 0x62, 0x63, 0x64, 0x65, 0x66,
            0x73, 0x74, 0x76, 0x84, 0x85
        ],
        waterAllowedTreeTiles: [
            // Ground->Tree base transitions:
            0x2A, 0x31, 0x34, 0x39, 0x3A,
            // Solid Tree trunks & vine bases:
            0x2B, 0x2C, 0x2D, 0x2E, 0x2F, 0x30, 0x35, 0x36, 0x37, 0x38
        ],
        stalactitesEnabled: true,      // Master toggle for hanging ceiling stalactites
        stalactiteInRacesEnabled: false, // Disabled in race levels so pilots never mistake them for solid obstacles
        stalactiteShatterEnabled: true,
        stalactiteAlpha: 0.88,         // Opacity of hanging ceiling stalactites
        stalactiteRimAlpha: 0.55,      // Opacity of the ochre mineral ridge line
        stalactiteMinLength: 22,       // Minimum stalactite spike length (px)
        stalactiteMaxLength: 48,       // Maximum stalactite spike length (px)
        stalactiteMinHalfWidth: 4.2,   // Minimum stalactite base half-width (px)
        stalactiteMaxHalfWidth: 8.0,   // Maximum stalactite base half-width (px)
        maxHangingStalactites: 55,
        shockwaveRingsEnabled: true,
        shockwaveMaxRadius: 280,
        shockwaveDurationTicks: 70,    // Guaranteed frame lifetime before cleanup
        gravityArcsEnabled: true
    }
};

if (typeof window !== 'undefined') {
    window.GF_RENDER_CONFIG = RENDER_CONFIG;
}
