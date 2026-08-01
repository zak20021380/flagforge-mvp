import type { QualityTier, UnitKind, UnitStats } from './types';

export const PORTRAIT_LAYOUT = {
  viewport: {
    desktopMaxWidth: 520,
    desktopMaxAspect: 0.625,
    resizeDebounceMs: 90,
  },
  arena: {
    halfWidth: 13.4,
    halfLength: 31.5,
    groundWidth: 27.6,
    groundLength: 64,
    foundationWidth: 29,
    foundationLength: 65.2,
    laneOffset: 6.25,
    laneBoundary: 2.7,
    sideRoadWidth: 3.25,
    centerRoadWidth: 3.8,
    roadLength: 52.5,
    riverZ: 8.6,
    riverWidth: 25.8,
    deploymentCenterZ: 17,
    deploymentDepth: 7.4,
    deploymentWidth: 22.4,
    sideWallX: 12.85,
    sideWallLength: 60,
    castleZ: 26.35,
    castleWidthScale: 0.74,
    gateOffset: 4.8,
    deliveryOffset: 5.7,
    interiorOffset: 1.3,
    unitBoundsX: 12.15,
    unitBoundsZ: 29.8,
    aiSpawnMinZ: 14.5,
    aiSpawnMaxZ: 19.7,
    route: {
      flagApproachZ: 5,
      flagApproachThresholdZ: 5.15,
      returnMergeZ: 13.4,
      returnMergeThresholdZ: 12.9,
      returnLaneScale: 0.58,
      attackMergeZ: 12.9,
      attackMergeThresholdZ: 12.4,
      attackLaneScale: 0.54,
      infiltrationDepth: 0.45,
    },
  },
  camera: {
    // Aim point: chest height in the central combat band, biased a little behind the
    // flag platform so the objective sits just above the optical centre.
    targetX: 0,
    targetY: 1.4,
    // Framing is interpolated between two tuned anchors on the real render aspect.
    // narrow = phone portrait (360x800 / 393x873 / 412x915 all land on ~0.450),
    // wide = the widest the CSS shell can ever be (min(vw, 520, vh * 0.625)).
    narrowAspect: 0.45,
    wideAspect: 0.625,
    narrowFov: 0.8,
    wideFov: 0.76,
    narrowPitchDegrees: 45,
    widePitchDegrees: 46,
    narrowDistance: 54,
    wideDistance: 51,
    narrowTargetZ: -6.2,
    wideTargetZ: -8,
    // Same-aspect phones still differ in CSS height, so the HUD eats a different share
    // of the frame. Trim the aim (and marginally the distance) against a reference
    // height; the correction fades out toward the desktop shell aspect, where the
    // enemy gate arch rather than the HUD share is the binding constraint.
    referenceHeight: 873,
    heightTrimMin: 0.86,
    heightTrimMax: 1.16,
    targetZHeightTrim: -10.4,
    distanceHeightTrim: -6.5,
    maxTargetZTrim: 1.3,
    maxDistanceTrim: 0.9,
    // Safety net for aspects narrower than the tuned phone anchor (21:9 and taller).
    // The small cap keeps the portrait presentation close and allows intentional side crop.
    deployCoverageMargin: 0.15,
    maxCoverageTrim: 1.2,
    // Portrait-safe clamps.
    minFov: 0.74,
    maxFov: 0.84,
    minPitchDegrees: 43,
    maxPitchDegrees: 48,
    minDistance: 48,
    maxDistance: 60,
    minTargetZ: -9.5,
    maxTargetZ: -4.8,
    minHeight: 34,
    maxHeight: 46,
    minBackDistance: 32,
    maxBackDistance: 50,
    // Brief, subtle dolly-in used for flag capture / gate opening / breach (world units).
    emphasisPush: 1.5,
  },
} as const;

// All tower gameplay coordinates live here so the procedural art and deterministic
// traversal remain in sync without collision queries or runtime pathfinding.
export const CENTRAL_TOWER = {
  baseWidth: 7.3,
  baseDepth: 6.6,
  shaftHeight: 7.3,
  topPlatformWidth: 6.15,
  topPlatformDepth: 5.35,
  // 9.16 is 12.4% above the previous 8.15-unit deck: enough lift to read taller
  // without changing the portrait framing or letting the objective dominate it.
  topSurfaceY: 9.16,
  topUnitY: 9.32,
  topWalkHalfWidth: 2.25,
  topWalkHalfDepth: 1.82,
  flagRootOffsetY: 0.03,
  flagPickupHeightTolerance: 0.9,
  ladderBaseDropRadius: 1.65,
  climbSpeed: 3.45,
  queueMoveScale: 0.82,
  queueArrivalRadius: 0.18,
  maximumQueuePerLadder: 3,
  ladders: {
    // Navigation-area names stay stable for flag/drop rules; visually these are
    // the left and right side ladders respectively.
    player: {
      id: 'player',
      side: 'left',
      facingYaw: 1.18,
      groundEntry: { x: -4.15, y: 0.16, z: -2.65 },
      groundAlign: { x: -3.4, y: 0.16, z: -1.4 },
      climbTop: { x: -2.65, y: 9.32, z: -1.1 },
      topExit: { x: -2.02, y: 9.32, z: -0.78 },
      groundQueueOrigin: { x: -4.15, y: 0.16, z: -3.25 },
      groundQueueStep: { x: 0, y: 0, z: -0.95 },
      topQueuePositions: [
        { x: -1.9, y: 9.32, z: -0.72 },
        { x: -0.85, y: 9.32, z: -1.35 },
        { x: -0.75, y: 9.32, z: 0.2 },
      ],
    },
    enemy: {
      id: 'enemy',
      side: 'right',
      facingYaw: -1.96,
      groundEntry: { x: 4.15, y: 0.16, z: 2.65 },
      groundAlign: { x: 3.4, y: 0.16, z: 1.4 },
      climbTop: { x: 2.65, y: 9.32, z: 1.1 },
      topExit: { x: 2.02, y: 9.32, z: 0.78 },
      groundQueueOrigin: { x: 4.15, y: 0.16, z: 3.25 },
      groundQueueStep: { x: 0, y: 0, z: 0.95 },
      topQueuePositions: [
        { x: 1.9, y: 9.32, z: 0.72 },
        { x: 0.85, y: 9.32, z: 1.35 },
        { x: 0.75, y: 9.32, z: -0.2 },
      ],
    },
  },
  safeFlagDrops: {
    towerTop: { x: 0, y: 9.19, z: 0 },
    playerBase: { x: -4.15, y: 0.12, z: -2.65 },
    enemyBase: { x: 4.15, y: 0.12, z: 2.65 },
  },
} as const;

// The red castle is the portrait-facing enemy objective. Its assault routes use
// authored world-space points so queues and falls never need collision queries.
export const ENEMY_CASTLE_ASSAULT = {
  wallTopY: 4.78,
  climbSpeed: 2.8,
  accessSpeed: 3.2,
  queueMoveScale: 0.86,
  queueArrivalRadius: 0.2,
  maximumQueuePerLadder: 3,
  attackableClimberMinY: 2.25,
  fallDuration: 0.68,
  wallBounds: {
    minX: -6.65,
    maxX: 6.65,
    minZ: 24.05,
    maxZ: 25.5,
  },
  rangerSupport: {
    left: { x: -5.25, y: 0.16, z: 21.2 },
    right: { x: 5.25, y: 0.16, z: 21.2 },
  },
  ladders: {
    left: {
      id: 'left',
      groundEntry: { x: -5.3, y: 0.16, z: 22.45 },
      groundAlign: { x: -5.3, y: 0.16, z: 23.42 },
      climbTop: { x: -5.3, y: 4.78, z: 23.96 },
      topExit: { x: -5.3, y: 4.78, z: 24.7 },
      groundQueueOrigin: { x: -5.3, y: 0.16, z: 21.9 },
      groundQueueStep: { x: -0.08, y: 0, z: -1.08 },
      defenderGroundEntry: { x: -5.3, y: 0.16, z: 27.15 },
      defenderTopEntry: { x: -5.3, y: 4.78, z: 25.34 },
      defenderGuard: { x: -5.3, y: 4.78, z: 24.82 },
      breachGroundExit: { x: -5.3, y: 0.16, z: 26.75 },
    },
    right: {
      id: 'right',
      groundEntry: { x: 5.3, y: 0.16, z: 22.45 },
      groundAlign: { x: 5.3, y: 0.16, z: 23.42 },
      climbTop: { x: 5.3, y: 4.78, z: 23.96 },
      topExit: { x: 5.3, y: 4.78, z: 24.7 },
      groundQueueOrigin: { x: 5.3, y: 0.16, z: 21.9 },
      groundQueueStep: { x: 0.08, y: 0, z: -1.08 },
      defenderGroundEntry: { x: 5.3, y: 0.16, z: 27.15 },
      defenderTopEntry: { x: 5.3, y: 4.78, z: 25.34 },
      defenderGuard: { x: 5.3, y: 4.78, z: 24.82 },
      breachGroundExit: { x: 5.3, y: 0.16, z: 26.75 },
    },
  },
} as const;

export const CONFIG = {
  arena: {
    halfWidth: PORTRAIT_LAYOUT.arena.halfWidth,
    halfLength: PORTRAIT_LAYOUT.arena.halfLength,
    blueDeployMinZ: -PORTRAIT_LAYOUT.arena.deploymentCenterZ - PORTRAIT_LAYOUT.arena.deploymentDepth / 2,
    blueDeployMaxZ: -PORTRAIT_LAYOUT.arena.deploymentCenterZ + PORTRAIT_LAYOUT.arena.deploymentDepth / 2,
    redDeployMinZ: PORTRAIT_LAYOUT.arena.deploymentCenterZ - PORTRAIT_LAYOUT.arena.deploymentDepth / 2,
    redDeployMaxZ: PORTRAIT_LAYOUT.arena.deploymentCenterZ + PORTRAIT_LAYOUT.arena.deploymentDepth / 2,
    flagPickupRadius: 1.05,
    flagDeliveryZ: PORTRAIT_LAYOUT.arena.castleZ - PORTRAIT_LAYOUT.arena.deliveryOffset,
    castleInteriorZ: PORTRAIT_LAYOUT.arena.castleZ + PORTRAIT_LAYOUT.arena.interiorOffset,
  },
  match: {
    durationSeconds: 180,
    gateOpenSeconds: 13,
    breachCountdownSeconds: 5,
    maxActiveUnits: 24,
  },
  energy: {
    maximum: 10,
    initial: 5,
    regenPerSecond: 0.72,
    overtimeMultiplier: 1.45,
  },
  ai: {
    thinkMin: 0.62,
    thinkMax: 1.05,
    deploymentPadding: 1.2,
  },
  unit: {
    separationRadius: 1.05,
    separationStrength: 1.6,
    targetRefreshMin: 0.18,
    targetRefreshMax: 0.34,
  },
} as const;

export const UNIT_STATS: Record<UnitKind, UnitStats> = {
  vanguard: {
    cost: 3,
    maxHealth: 170,
    damage: 32,
    speed: 3.25,
    attackRange: 1.35,
    aggroRange: 7.5,
    attackCooldown: 1.05,
    windup: 0.42,
    scale: 1,
  },
  ranger: {
    cost: 3,
    maxHealth: 92,
    damage: 26,
    speed: 3.05,
    attackRange: 8.4,
    aggroRange: 10.5,
    attackCooldown: 1.3,
    windup: 0.55,
    projectileSpeed: 17,
    scale: 0.94,
  },
  raider: {
    cost: 2,
    maxHealth: 88,
    damage: 20,
    speed: 4.65,
    attackRange: 1.15,
    aggroRange: 5.4,
    attackCooldown: 0.82,
    windup: 0.28,
    scale: 0.9,
  },
  ironGuard: {
    cost: 5,
    maxHealth: 310,
    damage: 41,
    speed: 2.35,
    attackRange: 1.5,
    aggroRange: 8.3,
    attackCooldown: 1.55,
    windup: 0.62,
    scale: 1.16,
  },
};

export const QUALITY_SETTINGS: Record<QualityTier, {
  hardwareScaling: number;
  shadowMapSize: number;
  decorations: number;
  antialias: boolean;
}> = {
  low: { hardwareScaling: 1.35, shadowMapSize: 512, decorations: 0.55, antialias: false },
  standard: { hardwareScaling: 1, shadowMapSize: 768, decorations: 0.78, antialias: true },
  high: { hardwareScaling: 1, shadowMapSize: 1024, decorations: 1, antialias: true },
};

export const UNIT_LABELS: Record<UnitKind, string> = {
  vanguard: 'Vanguard',
  ranger: 'Ranger',
  raider: 'Raider',
  ironGuard: 'Iron Guard',
};
