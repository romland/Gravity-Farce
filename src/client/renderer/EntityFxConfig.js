/**
 * Curated high-visibility sci-fi color palettes for 'prng' color resolution.
 * Each entry has [outerGlowHex, coreHex, rgbStringForPrebakedHalo].
 */
export const FX_PRNG_PALETTES = {
    plasma: [
        { glow: '#00f2fe', core: '#e0ffff', rgb: '0, 242, 254' },   // Electric Cyan
        { glow: '#ff2a54', core: '#ffd6de', rgb: '255, 42, 84' },   // Crimson Red
        { glow: '#a855f7', core: '#f3e8ff', rgb: '168, 85, 247' },  // Void Violet
        { glow: '#10b981', core: '#d1fae5', rgb: '16, 185, 129' },  // Isotope Emerald
        { glow: '#f59e0b', core: '#fef3c7', rgb: '245, 158, 11' },  // Reactor Amber
        { glow: '#38bdf8', core: '#e0f2fe', rgb: '56, 189, 248' }   // Cerulean Ion
    ],
    radiation: [
        { glow: '#39ff14', core: '#eaffd0', rgb: '57, 255, 20' },   // Uranium Green
        { glow: '#00f2fe', core: '#d8ffff', rgb: '0, 242, 254' },   // Cherenkov Blue
        { glow: '#ffbe0b', core: '#fff3b0', rgb: '255, 190, 11' },  // Yellowcake Amber
        { glow: '#ff007f', core: '#ffd6eb', rgb: '255, 0, 127' }    // Actinide Magenta
    ],
    fire: [
        { glow: '#ff6b1a', core: '#fff3a0', rgb: '255, 107, 26' },  // Afterburner Orange
        { glow: '#00f2fe', core: '#ffffff', rgb: '0, 242, 254' },   // Ion Thruster Cyan
        { glow: '#ff2a54', core: '#ffe0e6', rgb: '255, 42, 84' }    // Overdrive Crimson
    ]
};

/**
 * Declarative Effect Profiles per Enemy / Entity Type.
 * All coordinates (ox, oy, x1, y1, x2, y2, rx, ry) are in NORMALIZED local box space:
 *   x: -0.5 (left collision edge)  to +0.5 (right collision edge)
 *   y: -0.5 (top collision edge)   to +0.5 (bottom collision edge)
 *   Values > 0.5 (e.g. 0.56) intentionally overflow outside the collision box!
 */
export const ENTITY_FX_PROFILES = {
    // ========================================================================
    // e5-enemy-384x256.webp: Indestructible Armored Core Sphere (0xE5, 0xEB)
    // Round sphere leaves 4 empty hitbox corners; needs unmistakable invulnerability shield
    // ========================================================================
    '0xE5': {
        layers: [
            {
                kind: 'CONTAINMENT_SHIELD',
                color: '#00f2fe',
                palette: 'plasma',
                cornerBrackets: true,
                hexField: true,
                alpha: 0.38,
                pulseSpeed: 3.2
            },
            {
                kind: 'FURNACE_PULSE',
                color: '#ff6b1a',
                rgb: '255, 107, 26',
                zones: [
                    { ox: 0.0, oy: 0.0, rx: 0.16, ry: 0.09 },
                    { ox: -0.26, oy: 0.0, rx: 0.09, ry: 0.08 },
                    { ox: 0.26, oy: 0.0, rx: 0.09, ry: 0.08 }
                ],
                pulseSpeed: 4.5,
                alpha: 0.55
            },
            {
                kind: 'TESLA_CRACKLE',
                mode: 'lick_hull',
                color: 'prng',
                palette: 'plasma',
                rx: 0.46,
                ry: 0.44,
                arcCount: 3,
                segments: 7,
                speed: 'mixed', // Mixes slow crawling arcs and fast snapping arcs
                jaggedness: 0.08,
                thickness: 1.8
            }
        ]
    },

    '0xEB': {
        inherit: '0xE5'
    },

    // ========================================================================
    // e7-enemy-384x256.webp: Stepped Coaxial Condenser (0xE7, 0xE4)
    // Central vertical spire (0, -0.47 to +0.47), hollow inner windows, tapered wings
    // ========================================================================
    '0xE7': {
        layers: [
            {
                // Fills the empty upper & lower outer quadrants from the top/bottom spires!
                kind: 'TESLA_CRACKLE',
                mode: 'center_out_h',
                color: 'prng',
                palette: 'plasma',
                origins: [
                    { ox: 0.0, oy: -0.46, targetY: -0.34, spanX: 0.48 },
                    { ox: 0.0, oy: 0.46, targetY: 0.34, spanX: 0.48 }
                ],
                arcCount: 2,
                segments: 6,
                speed: 14.0,
                jaggedness: 0.09,
                thickness: 1.9,
                tipGlow: true
            },
            {
                // Rising Jacob's Ladder arcs inside the two hollow internal frame windows!
                kind: 'JACOBS_LADDER',
                color: '#00f2fe',
                coreColor: '#ffffff',
                chambers: [
                    { x1: -0.13, x2: -0.04, yBottom: 0.15, yTop: -0.15 },
                    { x1: 0.04, x2: 0.13, yBottom: 0.15, yTop: -0.15 }
                ],
                riseSpeed: 1.35,
                segments: 5,
                thickness: 1.7
            },
            {
                // Corner radiation pockets so the 192x128 hitbox corners are visibly hazardous
                kind: 'RADIATION_AURA',
                mode: 'corners',
                color: 'prng',
                palette: 'radiation',
                corners: 'all',
                radius: 0.24,
                alpha: 0.28,
                pulseSpeed: 3.0,
                moteCount: 6
            }
        ]
    },

    '0xE4': {
        // 8 HP Shooter variant using e7 chassis with aggressive overdrive red/prng arcs
        layers: [
            {
                kind: 'TESLA_CRACKLE',
                mode: 'center_out_h',
                color: 'prng',
                palette: 'plasma',
                origins: [
                    { ox: 0.0, oy: -0.46, targetY: -0.38, spanX: 0.52 },
                    { ox: 0.0, oy: 0.46, targetY: 0.38, spanX: 0.52 }
                ],
                arcCount: 3,
                segments: 7,
                speed: 'mixed',
                jaggedness: 0.11,
                thickness: 2.1,
                tipGlow: true
            },
            {
                kind: 'JACOBS_LADDER',
                color: '#ff2a54',
                coreColor: '#ffe0e6',
                chambers: [
                    { x1: -0.13, x2: -0.04, yBottom: 0.16, yTop: -0.16 },
                    { x1: 0.04, x2: 0.13, yBottom: 0.16, yTop: -0.16 }
                ],
                riseSpeed: 1.85,
                segments: 5,
                thickness: 1.9
            },
            {
                kind: 'RADIATION_AURA',
                mode: 'full_box',
                color: '#ff2a54',
                rgb: '255, 42, 84',
                alpha: 0.22,
                pulseSpeed: 4.2,
                moteCount: 8
            }
        ]
    },

    // ========================================================================
    // e8-enemy-384x256.webp: Twin-Sphere Tesla Barbell (0xE8, 0xEE)
    // Central vertical Tesla coil + 2 spheres; huge empty top/bottom corner quadrants
    // ========================================================================
    '0xE8': {
        layers: [
            {
                // High-voltage arcs from top & bottom central Tesla coils out to the 4 hitbox corners
                kind: 'TESLA_CRACKLE',
                mode: 'center_out_h',
                color: 'prng',
                palette: 'plasma',
                origins: [
                    { ox: 0.0, oy: -0.46, targetY: -0.32, spanX: 0.46 },
                    { ox: 0.0, oy: 0.46, targetY: 0.32, spanX: 0.46 }
                ],
                arcCount: 2,
                segments: 7,
                speed: 'mixed',
                jaggedness: 0.10,
                thickness: 2.0,
                tipGlow: true
            },
            {
                // Slow crawling plasma licking around both spheres & central conduit
                kind: 'TESLA_CRACKLE',
                mode: 'lick_lobes',
                color: 'prng',
                palette: 'plasma',
                lobes: [
                    { ox: -0.28, oy: 0.0, rx: 0.19, ry: 0.30 },
                    { ox: 0.28, oy: 0.0, rx: 0.19, ry: 0.30 }
                ],
                arcCount: 2,
                segments: 6,
                speed: 4.5,
                jaggedness: 0.07,
                thickness: 1.5
            },
            {
                // Side vent ion discharges poking slightly outside the left/right ports
                kind: 'PLASMA_VENT',
                color: 'prng',
                palette: 'plasma',
                vents: [
                    { ox: -0.47, oy: 0.0, dirX: -1, dirY: 0, len: 0.09 },
                    { ox: 0.47, oy: 0.0, dirX: 1, dirY: 0, len: 0.09 }
                ],
                pulseSpeed: 8.0
            }
        ]
    },

    // ========================================================================
    // e9-enemy-384x256.webp: Heavy Hydraulic Piston Frame (0xE9, 0xEA, 0xEF)
    // 4 corner blocks, exposed vertical outer piston rods, 2 hollow internal chambers
    // ========================================================================
    '0xE9': {
        layers: [
            {
                // Pulsing nuclear radiation leaking from a PRNG-selected corner & internal chambers
                kind: 'RADIATION_AURA',
                mode: 'prng_corner_and_core',
                color: 'prng',
                palette: 'radiation',
                radius: 0.34,
                alpha: 0.36,
                pulseSpeed: 2.8,
                moteCount: 10
            },
            {
                // High-energy plasma conduits arcing along the exposed left & right vertical piston rods
                kind: 'TESLA_CRACKLE',
                mode: 'point_to_point',
                color: 'prng',
                palette: 'plasma',
                pairs: [
                    { x1: -0.42, y1: -0.24, x2: -0.42, y2: 0.24 },
                    { x1: 0.42, y1: -0.24, x2: 0.42, y2: 0.24 },
                    { x1: -0.24, y1: -0.38, x2: 0.24, y2: -0.38 },
                    { x1: -0.24, y1: 0.38, x2: 0.24, y2: 0.38 }
                ],
                segments: 6,
                speed: 'mixed',
                jaggedness: 0.06,
                thickness: 1.8
            }
        ]
    },

    // ========================================================================
    // ec-enemy-384x256.webp: Twin-Thruster Server Platform (0xEC, 0xED, 0xE6)
    // Top blue crystal cone, dual server bays, 2 bottom exhaust nozzles
    // ========================================================================
    '0xEC': {
        layers: [
            {
                // Roaring twin thruster plumes at the bottom nozzles + heat shimmer
                kind: 'THRUSTER_PLUME',
                color: 'prng',
                palette: 'fire',
                nozzles: [
                    { ox: -0.255, oy: 0.44, width: 0.12, len: 0.14 },
                    { ox: 0.255, oy: 0.44, width: 0.12, len: 0.14 }
                ],
                pulseSpeed: 18.0
            },
            {
                // Top nose-cone antenna crackling horizontally across the upper armor shoulders
                kind: 'TESLA_CRACKLE',
                mode: 'center_out_h',
                color: '#00f2fe',
                palette: 'plasma',
                origins: [
                    { ox: 0.0, oy: -0.45, targetY: -0.31, spanX: 0.46 }
                ],
                arcCount: 2,
                segments: 6,
                speed: 11.0,
                jaggedness: 0.07,
                thickness: 1.7,
                tipGlow: true
            },
            {
                // Animated Cylon/diagnostic laser sweep inside the left & right server bays
                kind: 'SCANNER_SWEEP',
                color: 'prng',
                palette: 'plasma',
                bays: [
                    { ox: -0.26, oy: -0.04, w: 0.26, h: 0.34 },
                    { ox: 0.26, oy: -0.04, w: 0.26, h: 0.34 }
                ],
                speed: 2.6
            }
        ]
    },

    // ========================================================================
    // tank-256x96.webp: Armored Ground Crawler (64x48 collision box)
    // ========================================================================
    'TANK': {
        layers: [
            {
                // Arcs from top turret antenna out to front & rear sloped fenders to fill 64x48 box
                kind: 'TESLA_CRACKLE',
                mode: 'center_out_h',
                color: 'prng',
                palette: 'plasma',
                origins: [
                    { ox: -0.04, oy: -0.44, targetY: 0.08, spanX: 0.46 }
                ],
                arcCount: 1,
                segments: 5,
                speed: 8.5,
                jaggedness: 0.08,
                thickness: 1.4,
                tipGlow: true
            },
            {
                kind: 'RADIATION_AURA',
                mode: 'prng_corner_and_core',
                color: 'prng',
                palette: 'radiation',
                radius: 0.32,
                alpha: 0.22,
                pulseSpeed: 2.5,
                moteCount: 3
            }
        ]
    },

    // ========================================================================
    // Static Turrets & Pickups (DRY ECS reuse!)
    // ========================================================================
    'TURRET': {
        layers: [
            {
                kind: 'TESLA_CRACKLE',
                mode: 'center_out_h',
                color: 'prng',
                palette: 'plasma',
                origins: [
                    { ox: 0.0, oy: -0.42, targetY: 0.15, spanX: 0.44 }
                ],
                arcCount: 1,
                segments: 4,
                speed: 7.0,
                jaggedness: 0.09,
                thickness: 1.2,
                tipGlow: false
            }
        ]
    }
};

// Populate derived heavy/variant profiles cleanly (DRY)
ENTITY_FX_PROFILES['0xEE'] = {
    layers: [
        ...ENTITY_FX_PROFILES['0xE8'].layers,
        {
            kind: 'RADIATION_AURA',
            mode: 'corners',
            color: 'prng',
            palette: 'radiation',
            corners: 'all',
            radius: 0.26,
            alpha: 0.32,
            pulseSpeed: 3.4,
            moteCount: 8
        }
    ]
};

ENTITY_FX_PROFILES['0xEA'] = {
    layers: [
        ...ENTITY_FX_PROFILES['0xE9'].layers,
        {
            kind: 'TESLA_CRACKLE',
            mode: 'lick_hull',
            color: 'prng',
            palette: 'plasma',
            rx: 0.45,
            ry: 0.42,
            arcCount: 2,
            segments: 6,
            speed: 12.0,
            jaggedness: 0.09,
            thickness: 1.7
        }
    ]
};

ENTITY_FX_PROFILES['0xEF'] = {
    // 25 HP Boss-tier Juggernaut: Full-box radioactive aura + violent multi-arc Tesla cage
    layers: [
        {
            kind: 'RADIATION_AURA',
            mode: 'full_box',
            color: 'prng',
            palette: 'radiation',
            radius: 0.48,
            alpha: 0.42,
            pulseSpeed: 4.0,
            moteCount: 14,
            overflow: 1.15
        },
        ...ENTITY_FX_PROFILES['0xE9'].layers,
        {
            kind: 'TESLA_CRACKLE',
            mode: 'lick_hull',
            color: 'prng',
            palette: 'plasma',
            rx: 0.50,
            ry: 0.48,
            arcCount: 4,
            segments: 7,
            speed: 'mixed',
            jaggedness: 0.12,
            thickness: 2.2
        }
    ]
};

ENTITY_FX_PROFILES['0xED'] = {
    layers: [
        ...ENTITY_FX_PROFILES['0xEC'].layers,
        {
            kind: 'RADIATION_AURA',
            mode: 'prng_corner_and_core',
            color: 'prng',
            palette: 'radiation',
            radius: 0.30,
            alpha: 0.30,
            pulseSpeed: 3.2,
            moteCount: 6
        }
    ]
};

ENTITY_FX_PROFILES['0xE6'] = {
    layers: [
        ...ENTITY_FX_PROFILES['0xEC'].layers,
        {
            kind: 'TESLA_CRACKLE',
            mode: 'lick_hull',
            color: 'prng',
            palette: 'plasma',
            rx: 0.46,
            ry: 0.36,
            arcCount: 2,
            segments: 6,
            speed: 'mixed',
            jaggedness: 0.08,
            thickness: 1.6
        }
    ]
};