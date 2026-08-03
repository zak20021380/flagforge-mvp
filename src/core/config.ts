import type { ArenaRiverChannel, QualityTier, UnitKind, UnitStats } from './types';

// Authored forest-arena alignment. These are intentionally centralized because the render roots
// and their linked gameplay coordinates must move together when the artwork is tuned.
export const ARENA_TEXTURE_ROTATION = 0;
export const ARENA_TEXTURE_U_SCALE = 1;
export const ARENA_TEXTURE_V_SCALE = 1;
export const ARENA_TEXTURE_U_OFFSET = 0;
export const ARENA_TEXTURE_V_OFFSET = 0;

/**
 * Authored arena artwork -> world mapping. Single source of truth: the render surface
 * (src/render/terrain.ts) and every object placed on a painted landmark derive from it.
 *
 * public/assets/textures/arena/flagforge-arena-forest.png is 1248 x 2256, the expanded-top
 * revision of the 1248 x 1936 original (archived as flagforge-arena-forest1.png). A row-signature
 * cross-correlation between the two files puts the original content at row offset +160 with a
 * column offset of 0: the canvas grew SYMMETRICALLY — 160px of extra forest above the red side and
 * 160px below the blue side — not 320px on top alone. A symmetric growth leaves the surface center
 * where it was, so centerZ stays 20.7720465 and only the edges move outward
 * (far edge z = 107.1955860, near edge z = -65.6514930).
 *
 * World units per pixel are unchanged from the original artwork (0.07661631 on X, 0.07661661 on Z),
 * so the painting is never stretched.
 *
 * Ground UVs run v = 0 at the -Z near edge to v = 1 at the +Z far edge and the texture is loaded
 * with invertY, so PNG row 0 (the top) lands on the +Z far edge and pixel Y grows toward the camera.
 */
export const ARENA_ARTWORK_SURFACE = {
  pixelWidth: 1248,
  pixelHeight: 2256,
  width: 95.617149,
  length: 172.847079,
  centerX: 0,
  centerZ: 20.7720465,
} as const;

const ARTWORK_WORLD_PER_PIXEL_X = ARENA_ARTWORK_SURFACE.width / ARENA_ARTWORK_SURFACE.pixelWidth;
const ARTWORK_WORLD_PER_PIXEL_Z = ARENA_ARTWORK_SURFACE.length / ARENA_ARTWORK_SURFACE.pixelHeight;
const ARTWORK_FAR_EDGE_Z = ARENA_ARTWORK_SURFACE.centerZ + ARENA_ARTWORK_SURFACE.length / 2;

/** World X of a texture column; pixel X is left-origin. */
export const artworkPixelToWorldX = (pixelX: number): number =>
  ARENA_ARTWORK_SURFACE.centerX - ARENA_ARTWORK_SURFACE.width / 2 + pixelX * ARTWORK_WORLD_PER_PIXEL_X;

/** World Z of a texture row; pixel Y is top-origin and the PNG top edge is the +Z far edge. */
export const artworkPixelToWorldZ = (pixelY: number): number =>
  ARTWORK_FAR_EDGE_Z - pixelY * ARTWORK_WORLD_PER_PIXEL_Z;

/**
 * Landmarks measured on the artwork itself — grass-vs-stone greenness (g - (r + b) / 2) for the two
 * painted boundary walls, cream-floor luminance for the central platform:
 *
 * Landmark                 pixel (x, y)     UV (u, v)                     world (x, z)
 * Red boundary wall        (624, 535)       (0.5, 0.237150709)            (0, 66.205698)
 * Blue boundary wall       (624, 1670)      (0.5, 0.740248227)            (0, -20.754158)
 * Central octagon center   (622.25, 1072)   (0.498597756, 0.475177305)    (-0.134079, 25.062577)
 *
 * Lane cross-check: the painted center road stays inside x -0.08..-0.27 over the whole field and the
 * painted side roads pass ±6.2 at mid-field, which matches arena.laneOffset 6.25.
 *
 * The octagon row above is documentation only: the objective tower is placed on the computed arena
 * center (see CENTRAL_TOWER_ROOT_Z) rather than on the painted plaza, which the artist drew ~2.3
 * units toward the red half.
 */
const RED_BOUNDARY_PIXEL_Y = 535;
const BLUE_BOUNDARY_PIXEL_Y = 1670;

export const RED_BOUNDARY_Z = artworkPixelToWorldZ(RED_BOUNDARY_PIXEL_Y);
export const BLUE_BOUNDARY_Z = artworkPixelToWorldZ(BLUE_BOUNDARY_PIXEL_Y);

/**
 * Painted water channels and their bridge decks — the traversal barrier used by ground movement.
 *
 * The rivers and the bridges exist only in the artwork (there is no river or bridge mesh anywhere in
 * the scene), so their gameplay bounds are measured on the PNG and converted with the same pixel ->
 * world mapping the boundary walls use. Water pixels were classified as b > r + 18 and b > g + 4
 * inside the battlefield columns; a "deck" column run is a band of columns that stays dry across the
 * whole channel, which is exactly the painted bridge:
 *
 * channel     water rows    world z             deck columns          world x
 * red side     858..897     41.459 .. 38.470    522..580 / 664..721   -7.815..-3.371 / 3.065..7.432
 * blue side   1242..1286    12.038 ..  8.667    508..572 / 669..732   -8.887..-3.984 / 3.448..8.275
 *
 * This is the same measurement quoted in the CENTRAL_TOWER_ROOT_Z note below. Each painted deck
 * carries a two-pixel railing along its edges, so the walkable span is inset by
 * ARENA_BRIDGE_RAIL_INSET per side and unit bodies are kept inside that inset span.
 */
export const ARENA_BRIDGE_RAIL_INSET = 0.25;

const RIVER_CHANNEL_ARTWORK = [
  { id: 'redSide', waterTopPixelY: 858, waterBottomPixelY: 897, deckPixelColumns: [[522, 580], [664, 721]] },
  { id: 'blueSide', waterTopPixelY: 1242, waterBottomPixelY: 1286, deckPixelColumns: [[508, 572], [669, 732]] },
] as const;

export const ARENA_RIVERS: readonly ArenaRiverChannel[] = RIVER_CHANNEL_ARTWORK.map((channel) => {
  const minZ = artworkPixelToWorldZ(channel.waterBottomPixelY);
  const maxZ = artworkPixelToWorldZ(channel.waterTopPixelY);
  return {
    id: channel.id,
    minZ,
    maxZ,
    centerZ: (minZ + maxZ) / 2,
    bridges: channel.deckPixelColumns.map(([firstColumn, lastColumn]) => {
      const deckMinX = artworkPixelToWorldX(firstColumn);
      const deckMaxX = artworkPixelToWorldX(lastColumn);
      return {
        minX: deckMinX,
        maxX: deckMaxX,
        walkMinX: deckMinX + ARENA_BRIDGE_RAIL_INSET,
        walkMaxX: deckMaxX - ARENA_BRIDGE_RAIL_INSET,
        centerX: (deckMinX + deckMaxX) / 2,
      };
    }),
  };
});


/**
 * Each castle root sits behind its painted wall line by the castle's real front-face extent, so the
 * visible front face — not the pivot — lands on the painting. Measured from the assembled castle in
 * src/render/castle.ts: the drum-tower plinth (diameter 5.7 at local z 1.3 * facing) reaches 4.15
 * units ahead of the root and is the closest geometry to the battlefield; the gate hood only reaches
 * 3.3 and the wall line 2.42. 4.2 therefore lands the tower caps on the wall and keeps the whole
 * silhouette behind it. Red faces -Z, blue faces +Z.
 */
export const RED_CASTLE_FRONT_FACE_OFFSET_Z = -4.2;
export const BLUE_CASTLE_FRONT_FACE_OFFSET_Z = 4.2;

// Both gates are painted on the image's vertical center column (pixel x 624 -> world x 0).
export const RED_CASTLE_ROOT_X = 0;
export const RED_CASTLE_ROOT_Z = RED_BOUNDARY_Z - RED_CASTLE_FRONT_FACE_OFFSET_Z;
export const BLUE_CASTLE_ROOT_X = 0;
export const BLUE_CASTLE_ROOT_Z = BLUE_BOUNDARY_Z - BLUE_CASTLE_FRONT_FACE_OFFSET_Z;
export const CENTRAL_TOWER_ROOT_X = 0;

/**
 * Exact geometric center of the playable battlefield, derived instead of eyeballed.
 *
 * X — the middle vertical lane. laneX('center') is 0 (src/core/math.ts) and both castle gates sit on
 * x 0, so the central axis of play is x = 0. The tower base, not just the flagpole, is authored around
 * this root (src/render/centralTower.ts), so the whole structure is centered on that axis and its two
 * ladder faces stay square to the side lanes.
 *
 * Z — halfway between the two castle endpoints:
 *   (RED_CASTLE_ROOT_Z + BLUE_CASTLE_ROOT_Z) / 2 = (70.405698 + -24.954158) / 2 = 22.725770
 * Three independent readings of "halfway" agree exactly, because both castles use the same ±4.2
 * front-face offset:
 *   painted wall lines:   (RED_BOUNDARY_Z + BLUE_BOUNDARY_Z) / 2 = (66.205698 + -20.754158) / 2
 *   castle front faces:   ((RED_CASTLE_ROOT_Z - 4.2) + (BLUE_CASTLE_ROOT_Z + 4.2)) / 2
 *   castle roots:         the expression below
 * Neutral-island check against the painted rivers: the water channels occupy z 41.46..38.47 (red side)
 * and z 12.04..8.67 (blue side). The tower footprint is baseDepth 6.6 -> z 19.43..26.03, which clears
 * the near channel by 7.39 and the far channel by 12.44, and x 0 sits on the central road rather than
 * on either river crossing (bridges are painted around x -6.5..-5.6 and 5.3..5.8).
 */
export const CENTRAL_TOWER_ROOT_Z = (RED_CASTLE_ROOT_Z + BLUE_CASTLE_ROOT_Z) / 2;

const ARENA_FOUNDATION_LENGTH = 76.6;
// The tower caps are the castle geometry nearest the battlefield. Positioning the roots by this
// exact extent leaves only that front edge on the foundation boundary and every other part behind it.
const CASTLE_FRONT_EDGE_FROM_ROOT = 4.2;
const CASTLE_CENTER_Z = ARENA_FOUNDATION_LENGTH / 2 + CASTLE_FRONT_EDGE_FROM_ROOT;

// Authoritative portrait framing bias, applied to the aim point inside the aspect-aware fit solve
// (src/render/arena.ts). Because the solve then re-derives distance, pitch and the resting pose
// from the corrected center, every downstream system (first frame, reset, resize, shake, emphasis
// dolly) inherits the same framing. These replace the previous post-solve position/target pan,
// which translated the already-solved camera and left the red castle clipped at the top.
export const CAMERA_FRAMING_CENTER_Z_OFFSET = 10.0;
export const CAMERA_FRAMING_HEIGHT_OFFSET = 1.0;

export const PORTRAIT_LAYOUT = {
  viewport: {
    desktopMaxWidth: 520,
    desktopMaxAspect: 0.625,
    resizeDebounceMs: 90,
  },
  arena: {
    // Gameplay coordinates retain their authored spacing. The visual stage envelope grows farther
    // in both axes (especially Z), filling the portrait frame without changing traversal or combat.
    halfWidth: 13.4,
    halfLength: 31.5,
    groundWidth: 35.6,
    groundLength: 75.2,
    foundationWidth: 37,
    foundationLength: ARENA_FOUNDATION_LENGTH,
    laneOffset: 6.25,
    laneBoundary: 2.7,
    sideRoadWidth: 3.55,
    centerRoadWidth: 4.15,
    roadLength: 61.2,
    // Legacy symmetric river block from before the arena was painted. Only bridgeShoulder is still
    // read (as the bank stand-off in src/game/riverCrossing.ts); the traversal bounds live in
    // ARENA_RIVERS above, measured on the artwork the units actually walk on.
    riverZ: 9.75,
    riverWidth: 33.8,
    riverDepth: 2.8,
    bridgeDepth: 4.55,
    bridgeShoulder: 0.75,
    deploymentCenterZ: 17,
    deploymentDepth: 7.4,
    deploymentWidth: 22.4,
    castleZ: CASTLE_CENTER_Z,
    castleWidthScale: 0.74,
    gateOffset: 4.8,
    deliveryOffset: 5.7,
    interiorOffset: 1.3,
    unitBoundsX: 12.15,
    unitBoundsZ: RED_BOUNDARY_Z,
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
    // Aim point stays on the arena centre line. The Z bias is aspect-dependent so the
    // two castle silhouettes share the available portrait height evenly.
    targetX: 0,
    targetY: 1.4,
    // Narrow phones need a more overhead angle to fit the long arena without shrinking
    // units unnecessarily. Wider portrait shells retain more of the angled 3D view.
    narrowAspect: 0.45,
    wideAspect: 0.625,
    narrowFov: 0.9,
    wideFov: 0.86,
    narrowPitchDegrees: 57.5,
    widePitchDegrees: 45,
    narrowTargetZ: -7.05,
    wideTargetZ: -9.95,
    minFov: 0.84,
    maxFov: 0.94,
    minPitchDegrees: 43,
    maxPitchDegrees: 65,
    minTargetZ: -10.5,
    maxTargetZ: -5,
    // The enlarged near edge may crop naturally behind the HUD instead of forcing the camera back.
    // These limits keep the existing aim, pitch and FOV while leaving only a narrow outer border.
    horizontalScreenCoverage: 1.21,
    topScreenLimit: 0.8,
    bottomScreenLimit: 0.84,
    minDistance: 60,
    // Conservative visual extrema used only for camera framing. They include both
    // castle silhouettes, a fully raised gate, and the flag at the tower top.
    castleFrameHalfWidth: 10.2,
    castleFrameOuterZ: 33.5,
    castleFrameTopY: 9,
    raisedGateFrameHalfWidth: 3,
    raisedGateFrameZ: 24.35,
    raisedGateFrameTopY: 10.8,
    flagFrameHalfWidth: 2.8,
    flagFrameTopY: 15,
    // A short move along the existing view ray raises the camera while preserving the aim point,
    // pitch and FOV. The wider stage absorbs this small distance increase in the final framing.
    elevationDistance: 2.2,
    // Brief, subtle dolly-in used for flag capture / gate opening / breach (world units).
    emphasisPush: 1.5,
  },
} as const;

const centralObjectivePoint = (x: number, y: number, z: number) => ({
  x: x + CENTRAL_TOWER_ROOT_X,
  y,
  z: z + CENTRAL_TOWER_ROOT_Z,
});

// All tower gameplay coordinates live here so the procedural art and deterministic
// traversal remain in sync without collision queries or runtime pathfinding.
export const CENTRAL_TOWER = {
  centerX: CENTRAL_TOWER_ROOT_X,
  centerZ: CENTRAL_TOWER_ROOT_Z,
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
      groundEntry: centralObjectivePoint(-4.15, 0.16, -2.65),
      groundAlign: centralObjectivePoint(-3.4, 0.16, -1.4),
      climbTop: centralObjectivePoint(-2.65, 9.32, -1.1),
      topExit: centralObjectivePoint(-2.02, 9.32, -0.78),
      groundQueueOrigin: centralObjectivePoint(-4.15, 0.16, -3.25),
      groundQueueStep: { x: 0, y: 0, z: -0.95 },
      topQueuePositions: [
        centralObjectivePoint(-1.9, 9.32, -0.72),
        centralObjectivePoint(-0.85, 9.32, -1.35),
        centralObjectivePoint(-0.75, 9.32, 0.2),
      ],
    },
    enemy: {
      id: 'enemy',
      side: 'right',
      facingYaw: -1.96,
      groundEntry: centralObjectivePoint(4.15, 0.16, 2.65),
      groundAlign: centralObjectivePoint(3.4, 0.16, 1.4),
      climbTop: centralObjectivePoint(2.65, 9.32, 1.1),
      topExit: centralObjectivePoint(2.02, 9.32, 0.78),
      groundQueueOrigin: centralObjectivePoint(4.15, 0.16, 3.25),
      groundQueueStep: { x: 0, y: 0, z: 0.95 },
      topQueuePositions: [
        centralObjectivePoint(1.9, 9.32, 0.72),
        centralObjectivePoint(0.85, 9.32, 1.35),
        centralObjectivePoint(0.75, 9.32, -0.2),
      ],
    },
  },
  safeFlagDrops: {
    towerTop: centralObjectivePoint(0, 9.19, 0),
    playerBase: centralObjectivePoint(-4.15, 0.12, -2.65),
    enemyBase: centralObjectivePoint(4.15, 0.12, 2.65),
  },
} as const;

/**
 * Authoritative world-space XZ gameplay regions.
 *
 * The painted-landmark anchors above define the field: the blue castle (painted) wall line is
 * Z = -20.754, the lower (blue side) river water spans 8.590..12.114, and the upper (red side)
 * channel runs 38.470..41.459. Every validator — deployment, ground-step legality, decoration
 * clearance — reads these constants instead of any mirrored deployment center, so no stale red-side
 * mirror can reject the blue flank again. Widths use the authored lane span (deploymentWidth).
 */
export const RED_RIVER_CHANNEL = {
  minZ: ARENA_RIVERS[0].minZ,
  maxZ: ARENA_RIVERS[0].maxZ,
} as const;

/**
 * Authoritative lower (blue side) river channel. The task-mandated water span of the blue river is
 * Z 8.590..12.114 (south edge 8.590). Kept distinct from ARENA_RIVERS[1] so the painted-edge tables
 * that drive bridge traffic keep their measured spans while the shipped blockage guarantees the full
 * mandated channel.
 */
export const BLUE_RIVER_CHANNEL = {
  minZ: 8.590,
  maxZ: 12.114,
} as const;

/**
 * Back edge of the blue fortress: the blue keep sits at local z -2.7 with depth 7.8 (see
 * src/render/castle.ts), so its rear wall is BLUE_CASTLE_ROOT_Z - 6.6. Ground movement may walk up
 * to this line — the gate breach requires entering the interior (interiorPoint z -26.254) — and the
 * forest exterior beyond it is blocked.
 */
export const BLUE_CASTLE_BACK_Z = BLUE_CASTLE_ROOT_Z - 6.6;

/** The blue field floor: from the blue fortress back wall up to the south bank of the lower (blue) river. */
export const BLUE_BATTLEFIELD = {
  minX: -PORTRAIT_LAYOUT.arena.deploymentWidth / 2,
  maxX: PORTRAIT_LAYOUT.arena.deploymentWidth / 2,
  minZ: BLUE_CASTLE_BACK_Z,
  maxZ: BLUE_RIVER_CHANNEL.minZ,
} as const;

/** The player deployment zone: the field front in front of the blue wall line, clear of water. */
export const BLUE_DEPLOYMENT = {
  minX: -PORTRAIT_LAYOUT.arena.deploymentWidth / 2,
  maxX: PORTRAIT_LAYOUT.arena.deploymentWidth / 2,
  minZ: BLUE_BOUNDARY_Z,
  maxZ: BLUE_RIVER_CHANNEL.minZ - PORTRAIT_LAYOUT.arena.bridgeShoulder,
} as const;

/**
 * The enemy (red) deployment zone: the field front in front of the red wall line, clear of water.
 * Mirrors BLUE_DEPLOYMENT against the upper (red side) river channel. The red castle faces -Z, so
 * its wall line (RED_BOUNDARY_Z) is the high-Z bound and the river's castle-side bank
 * (RED_RIVER_CHANNEL.maxZ) is the low-Z bound, inset by bridgeShoulder so spawns never touch water.
 * Derived from the same world-space red castle boundary and upper-river bank the rest of the field
 * reads — not from any mirrored deployment center.
 */
export const RED_DEPLOYMENT = {
  minX: -PORTRAIT_LAYOUT.arena.deploymentWidth / 2,
  maxX: PORTRAIT_LAYOUT.arena.deploymentWidth / 2,
  minZ: RED_RIVER_CHANNEL.maxZ + PORTRAIT_LAYOUT.arena.bridgeShoulder,
  maxZ: RED_BOUNDARY_Z,
} as const;

const ENEMY_CASTLE_X = RED_CASTLE_ROOT_X;
const ENEMY_CASTLE_Z = RED_CASTLE_ROOT_Z;
const enemyCastlePoint = (x: number, y: number, z: number) => ({
  x: x + ENEMY_CASTLE_X,
  y,
  z,
});

// The red castle is the portrait-facing enemy objective. Its assault routes retain their authored
// offsets from the castle root so its queues, access points and collision bounds move as one group.
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
    minX: ENEMY_CASTLE_X - 6.65,
    maxX: ENEMY_CASTLE_X + 6.65,
    minZ: ENEMY_CASTLE_Z - 2.3,
    maxZ: ENEMY_CASTLE_Z - 0.85,
  },
  rangerSupport: {
    left: enemyCastlePoint(-5.25, 0.16, ENEMY_CASTLE_Z - 5.15),
    right: enemyCastlePoint(5.25, 0.16, ENEMY_CASTLE_Z - 5.15),
  },
  ladders: {
    left: {
      id: 'left',
      groundEntry: enemyCastlePoint(-5.3, 0.16, ENEMY_CASTLE_Z - 3.9),
      groundAlign: enemyCastlePoint(-5.3, 0.16, ENEMY_CASTLE_Z - 2.93),
      climbTop: enemyCastlePoint(-5.3, 4.78, ENEMY_CASTLE_Z - 2.39),
      topExit: enemyCastlePoint(-5.3, 4.78, ENEMY_CASTLE_Z - 1.65),
      groundQueueOrigin: enemyCastlePoint(-5.3, 0.16, ENEMY_CASTLE_Z - 4.45),
      groundQueueStep: { x: -0.08, y: 0, z: -1.08 },
      defenderGroundEntry: enemyCastlePoint(-5.3, 0.16, ENEMY_CASTLE_Z + 0.8),
      defenderTopEntry: enemyCastlePoint(-5.3, 4.78, ENEMY_CASTLE_Z - 1.01),
      defenderGuard: enemyCastlePoint(-5.3, 4.78, ENEMY_CASTLE_Z - 1.53),
      breachGroundExit: enemyCastlePoint(-5.3, 0.16, ENEMY_CASTLE_Z + 0.4),
    },
    right: {
      id: 'right',
      groundEntry: enemyCastlePoint(5.3, 0.16, ENEMY_CASTLE_Z - 3.9),
      groundAlign: enemyCastlePoint(5.3, 0.16, ENEMY_CASTLE_Z - 2.93),
      climbTop: enemyCastlePoint(5.3, 4.78, ENEMY_CASTLE_Z - 2.39),
      topExit: enemyCastlePoint(5.3, 4.78, ENEMY_CASTLE_Z - 1.65),
      groundQueueOrigin: enemyCastlePoint(5.3, 0.16, ENEMY_CASTLE_Z - 4.45),
      groundQueueStep: { x: 0.08, y: 0, z: -1.08 },
      defenderGroundEntry: enemyCastlePoint(5.3, 0.16, ENEMY_CASTLE_Z + 0.8),
      defenderTopEntry: enemyCastlePoint(5.3, 4.78, ENEMY_CASTLE_Z - 1.01),
      defenderGuard: enemyCastlePoint(5.3, 4.78, ENEMY_CASTLE_Z - 1.53),
      breachGroundExit: enemyCastlePoint(5.3, 0.16, ENEMY_CASTLE_Z + 0.4),
    },
  },
} as const;

export const CONFIG = {
  arena: {
    halfWidth: PORTRAIT_LAYOUT.arena.halfWidth,
    halfLength: PORTRAIT_LAYOUT.arena.halfLength,
    blueDeployMinZ: BLUE_DEPLOYMENT.minZ,
    blueDeployMaxZ: BLUE_DEPLOYMENT.maxZ,
    redDeployMinZ: RED_DEPLOYMENT.minZ,
    redDeployMaxZ: RED_DEPLOYMENT.maxZ,
    flagPickupRadius: 1.05,
    flagDeliveryZ: ENEMY_CASTLE_Z - PORTRAIT_LAYOUT.arena.deliveryOffset,
    castleInteriorZ: ENEMY_CASTLE_Z + PORTRAIT_LAYOUT.arena.interiorOffset,
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
