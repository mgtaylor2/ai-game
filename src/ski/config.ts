/** Every tuning constant for Alpine Rush lives here, grouped by system, so feel can be changed in one place. */
export const CONFIG = {
  seed: 1337,

  visual: {
    skyTop: 0x2e6fd1,
    skyHorizon: 0xbfdbf7,
    sunHalo: 0xfff2d0,
    // Deliberately below pure white: snow is the brightest thing on screen and is lit by a >1 intensity
    // sun, so leaving headroom here is what keeps highlights from clipping to a flat white sheet.
    snowColor: 0xdfe7f2,
    snowShadowTint: 0x8fa9cc,
    // Pushed brighter than a "correct" orange on purpose: ACES plus sub-1.0 exposure pulls mid
    // saturated tones down noticeably, and the rider is the one thing that must stay readable against
    // a full screen of bright snow.
    jacketColor: 0xff6a2a,
    helmetColor: 0xffc94a,
    goggleColor: 0x2f6fbf,
    pineColor: 0x1f4d33,
    fogColor: 0xcfe0f2,
    // Thin enough to keep several hundred metres of mountain readable -- the spec's 0.0025 hides the
    // piste ahead behind haze at this corridor scale and flattens the whole frame to white.
    fogDensity: 0.0011,
    exposure: 0.92,
    maxPixelRatio: 1.5,
  },

  spline: {
    controlSpacing: 30,
    lateralWavelengthMin: 150,
    lateralWavelengthMax: 220,
    lateralAmplitudeMin: 25,
    lateralAmplitudeMax: 40,
    lateralRerollChance: 0.1,
    gradeMainMinDeg: 12,
    gradeMainMaxDeg: 18,
    gradeFlatDeg: 7.5,
    gradeSteepDeg: 23,
    gradeFlatChance: 0.12,
    gradeSteepChance: 0.12,
    gradeHoldMin: 5,
    gradeHoldMax: 14,
  },

  terrain: {
    corridorHalfWidth: 24,
    pisteHalfWidth: 18,
    /**
     * Valley walls are `gain * excess^2` metres above the corridor, where `excess` is how far past
     * `corridorHalfWidth` you are. Load-bearing and easy to get wrong by an order of magnitude: at the
     * 70 m terrain edge, `excess` is 46, so 0.012 gives a ~25 m rise (a believable valley side that the
     * forest sits on) while 0.14 gives ~296 m -- a near-vertical wall that fills the whole frame and
     * cascades into spurious takeoffs. Sanity-check by confirming surface normals near the piste keep
     * `normal.y` close to 1.
     */
    valleyWallGain: 0.012,
    valleyWallCapExcess: 55,
    /**
     * Multiplies `curvature * lateralDistance` into a banked cross-slope. Peak spline curvature is about
     * 0.046 rad/m, so this is roughly `tan(bankAngle) / 0.046` at the piste edge: 3.5 banks turns by
     * ~9 degrees, which supports a carve without sliding the rider off the groomed lane.
     */
    bankGain: 3.5,
    rollerShortWavelength: 14,
    rollerShortAmp: 0.35,
    rollerLongWavelength: 140,
    rollerLongAmp: 1.6,
    mogulScale: 3.2,
    mogulAmp: 0.55,
    kickerChanceMax: 2,
    kickerUpSigmaMin: 8.5,
    kickerUpSigmaMax: 11.5,
    kickerDownSigmaMin: 2.7,
    kickerDownSigmaMax: 3.6,
    kickerAmpMin: 1.15,
    kickerAmpMax: 2.3,
    kickerLateralOffsetMax: 9,
    kickerStartChunk: 2,
  },

  chunk: {
    length: 100,
    ahead: 8,
    behind: 2,
    rows: 64,
    denseSpacing: 1.65,
    sparseSpacing: 6.5,
    denseHalfWidth: 33,
    outerHalfWidth: 70,
    lodFullDistance: 190,
    lodMediumDistance: 430,
    aoRadius: 6,
    aoStrength: 0.55,
  },

  decor: {
    treeNearDensity: 0.3,
    treeFarDensity: 0.8,
    treeVariants: 3,
    // One unit of scale is a ~3 m pine, so this is a 5-10 m tree. Anything near 1.0 reads as scrub
    // against a 48 m-wide corridor rather than as a forest flanking the piste.
    treeScaleMin: 1.6,
    treeScaleMax: 3.2,
    treeMaxTilt: 0.1,
    heroTreeChance: 0.3,
    rockOutcropChance: 0.35,
    logChance: 0.08,
    bushChance: 0.5,
    obstacleStartChunk: 3,
    obstacleMaxPerChunk: 4,
    obstacleRockChance: 0.25,
  },

  pickups: {
    orbColor: 0x4fd8ff,
    orbPoints: 50,
    orbCount: {
      line: 8,
      arc: 9,
      zigzag: 10,
    },
    zigzagOffset: 9,
    boostChance: 0.3,
    boostDuration: 3,
    boostAccel: 14,
    boostFovKick: 6,
    shieldChance: 0.1,
    magnetRadius: 3,
    collectRadius: 1.3,
  },

  gates: {
    chance: 0.45,
    count: 3,
    spacing: 32,
    lateralOffset: 6,
    poleGap: 7,
    scorePass: 250,
    passRadius: 3.5,
    missRadius: 16,
  },

  physics: {
    gravity: 9.81,
    maxEdgeAngle: Math.PI / 4,
    edgeEase: 4.2,
    gripDrifty: 1.8,
    gripCarving: 9.5,
    yawEdgeGain: 2.35,
    yawSpeedFull: 7,
    lateralAccelCapBase: 44,
    corridorAssistInner: 12,
    corridorAssistOuter: 24,
    friction: 0.34,
    drag: 0.0034,
    tuckDragFactor: 0.65,
    carveSpeedScrub: 0.55,
    maxSpeed: 42,
    speedRampDistance: 4000,
    speedRampImprovement: 0.35,
    floorSpeedStart: 13,
    floorSpeedEnd: 33,
    floorRampDistance: 3500,
    boundaryDistance: 21,
    boundaryPushStrength: 6,
    stallSpeed: 3.5,
    stallTime: 2.2,
    respawnCollisionGrace: 1.2,
  },

  air: {
    takeoffDropThreshold: 2.6,
    takeoffKeepFraction: 0.35,
    jumpImpulse: 4.9,
    airTurnRate: 1.15,
    spinRate: (720 * Math.PI) / 180,
    spinRampTime: 0.25,
    cleanLandingToleranceDeg: 30,
    switchLandingToleranceDeg: 130,
    bigAirTime: 1.15,
    wipeoutTumbleTime: 1.5,
    wipeoutSpinFactor: 0.4,
  },

  scoring: {
    spinPer180: 150,
    grabScore: 120,
    bigAirScore: 100,
    switchScore: 80,
    comboWindow: 6,
    comboPerChain: 0.25,
    comboMax: 8,
  },

  camera: {
    stiffness: 6,
    damping: 0.85,
    heightOffset: 3.9,
    followDistance: 9.2,
    leash: 5,
    minHeightAboveTerrain: 1.35,
    lookAheadRider: 6.5,
    lookAheadSpline: 12,
    lookAheadSplineBlend: 0.25,
    maxRollDeg: 5.2,
    fovMin: 70,
    fovMax: 85,
  },

  snow: {
    grooveFrequency: 17,
    roughness: 0.94,
    glitterSpecularPower: 118,
    glitterGate: 0.98,
    glitterBoost: 3.5,
    wrapFillStrength: 0.35,
  },

  effects: {
    trailSegments: 320,
    trailMinSpeed: 5,
    trailLifetime: 6,
    sprayPoolSize: 400,
    powderPoolSize: 200,
    shockwavePoolSize: 10,
    snowflakeCount: 2000,
    snowBoxSize: { x: 80, y: 40, z: 100 },
  },

  scenery: {
    // `heightOffset` is relative to the camera, so ridges keep sitting on the horizon as the run descends.
    ridgeLayers: [
      { distance: 900, followFactor: 0.93, height: 220, heightOffset: -30 },
      { distance: 1400, followFactor: 0.88, height: 340, heightOffset: -10 },
    ],
    cloudCount: 4,
    // The run always heads toward +z, so a sun near that heading is stared into for the whole game and
    // blows the frame out. Keeping it high and well off-axis side-lights the terrain instead, which is
    // what makes the rollers and moguls read at all, and still swings into frame on hard turns for rays.
    sunElevationDeg: 35,
    sunAzimuthDeg: 65,
    sunIntensity: 2.5,
    shadowMapDesktop: 4096,
    shadowMapMobile: 2048,
    shadowBoxSize: 62,
  },

  post: {
    // Sunlit snow sits just under this threshold, so bloom picks out the sun, the orbs and specular
    // glints rather than smearing the entire slope.
    bloomThreshold: 0.95,
    bloomStrength: 0.42,
    bloomRadius: 0.55,
    dofNearStart: 45,
    dofNearRange: 130,
    chromaticAberrationBase: 0.0015,
    chromaticAberrationImpact: 0.01,
    vignetteStrength: 0.35,
    grainStrength: 0.03,
    filmicContrast: 1.12,
    filmicSaturation: 1.08,
    speedStreakThreshold: 32,
  },

  adaptive: {
    frameTimeTargetMs: 16.7,
    frameTimeStepDownMs: 19.5,
    emaAlpha: 0.08,
    pixelRatioStep1: 1.12,
  },

  mobile: {
    steerZoneFraction: 0.4,
    pixelRatio: 1.25,
  },

  hud: {
    speedDisplayScale: 3.6,
  },
} as const;

export type Config = typeof CONFIG;
