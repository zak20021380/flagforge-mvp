import { Vector3 } from '@babylonjs/core';
import { ARENA_RIVERS, PORTRAIT_LAYOUT } from '../core/config';
import type { ArenaRiverChannel, BridgeState } from '../core/types';

/**
 * River crossing rules for ground movement.
 *
 * ARENA_RIVERS (src/core/config.ts) describes the two painted channels as impassable Z bands. The
 * only legal way from one bank to the other is inside a painted bridge deck, with the unit's whole
 * body inside that deck's walkable span. Every query here is interval arithmetic over that
 * four-rectangle table, so a unit costs a handful of comparisons per frame: no navigation mesh, no
 * physics, no raycasts and no per-frame path search.
 */

/** Approach and exit waypoints stand this far back from the water (authored bridge shoulder). */
const BANK_MARGIN = PORTRAIT_LAYOUT.arena.bridgeShoulder;
/** Distance at which a unit counts as lined up with a bridge entrance. */
const APPROACH_ARRIVAL = 0.42;
/** Gains smaller than this do not count as progress, so jostling in a queue still reads as stalled. */
const PROGRESS_EPSILON = 0.02;
/** How long a unit may fail to progress toward a bridge before it tries the other one. */
const STUCK_SECONDS = 1.5;
/** Exit run-out: after leaving the deck a unit keeps walking this many body radii past the far edge. */
export const EXIT_CLEAR_RADII = 3.5;

/** Shared with the bridge traffic system so queue slots line up with the same entrance geometry. */
export const BRIDGE_BANK_MARGIN = BANK_MARGIN;
/** Shared with the bridge traffic system; also the queue arrival radius at the entrance. */
export const BRIDGE_QUEUE_ARRIVAL = APPROACH_ARRIVAL;

const goalScratch = Vector3.Zero();

/** Cached crossing plan. Rebuilt only when the target side changes, the plan ends, or it stalls. */
export interface RiverRoute {
  channelIndex: number;
  bridgeIndex: number;
  /** Bank the crossing started from: -1 = low Z side, 1 = high Z side. */
  fromSide: number;
  /** 0 = walk to the entrance, 1 = walk the deck, 2 = step clear of the far bank. */
  stage: number;
  /** The goal itself stands over the water, so reaching the deck completes the route. */
  boardOnly: boolean;
  stuckClock: number;
  bestDistanceSquared: number;
}

/** The part of a unit these rules touch; UnitEntity satisfies it structurally. */
export interface RiverTraveller {
  readonly position: Vector3;
  readonly bodyRadius: number;
  readonly bridgeState: BridgeState;
  riverRoute: RiverRoute | null;
}

const sideOf = (channel: ArenaRiverChannel, z: number): number => (z < channel.centerZ ? -1 : 1);

/** True when a body of this radius at z would touch the channel water. */
const touchesWater = (channel: ArenaRiverChannel, z: number, radius: number): boolean =>
  z > channel.minZ - radius && z < channel.maxZ + radius;

const standsOverWater = (channel: ArenaRiverChannel, z: number): boolean =>
  z > channel.minZ && z < channel.maxZ;

/** Index of the deck a body of this radius fits completely inside at x, or -1. */
const deckAt = (channel: ArenaRiverChannel, x: number, radius: number): number => {
  for (let index = 0; index < channel.bridges.length; index += 1) {
    const bridge = channel.bridges[index];
    if (x - radius >= bridge.walkMinX && x + radius <= bridge.walkMaxX) return index;
  }
  return -1;
};

/** True when the whole swept X span (plus body radius) stays inside one deck. */
const spanFitsDeck = (
  channel: ArenaRiverChannel,
  fromX: number,
  toX: number,
  radius: number,
): boolean => {
  const low = Math.min(fromX, toX) - radius;
  const high = Math.max(fromX, toX) + radius;
  for (const bridge of channel.bridges) {
    if (low >= bridge.walkMinX && high <= bridge.walkMaxX) return true;
  }
  return false;
};

/** Bridge with the least total walking for this unit and this goal. */
const pickBridge = (channel: ArenaRiverChannel, fromX: number, goalX: number): number => {
  let best = 0;
  let bestCost = Number.POSITIVE_INFINITY;
  for (let index = 0; index < channel.bridges.length; index += 1) {
    const bridge = channel.bridges[index];
    const cost = Math.abs(fromX - bridge.centerX) + Math.abs(goalX - bridge.centerX);
    if (cost < bestCost) {
      bestCost = cost;
      best = index;
    }
  }
  return best;
};

/**
 * True when stepping from (fromX, fromZ) to (toX, toZ) would put any part of the body in water. The
 * swept Z range is compared against every channel, so an oversized step cannot tunnel through one.
 */
const blocksGroundStep = (
  fromX: number,
  fromZ: number,
  toX: number,
  toZ: number,
  radius: number,
): boolean => {
  for (const channel of ARENA_RIVERS) {
    const low = Math.min(fromZ, toZ);
    const high = Math.max(fromZ, toZ);
    if (low >= channel.maxZ + radius || high <= channel.minZ - radius) continue;
    if (!spanFitsDeck(channel, fromX, toX, radius)) return true;
  }
  return false;
};

/**
 * Move a unit that is already overlapping a channel back onto legal ground: sideways onto the nearest
 * deck when that is the shortest way out, otherwise straight to the nearer bank. Idempotent, so it can
 * run every frame and only does work on the first frame a unit is out of place.
 */
export const keepOnLand = (traveller: RiverTraveller): boolean => {
  const position = traveller.position;
  const radius = traveller.bodyRadius;
  for (const channel of ARENA_RIVERS) {
    if (!touchesWater(channel, position.z, radius)) continue;
    if (deckAt(channel, position.x, radius) >= 0) continue;
    const bridge = channel.bridges[pickBridge(channel, position.x, position.x)];
    const deckX = Math.min(Math.max(position.x, bridge.walkMinX + radius), bridge.walkMaxX - radius);
    const sideways = Math.abs(deckX - position.x);
    const toLowBank = position.z - (channel.minZ - radius);
    const toHighBank = channel.maxZ + radius - position.z;
    if (sideways <= toLowBank && sideways <= toHighBank) position.x = deckX;
    else if (toLowBank <= toHighBank) position.z = channel.minZ - radius;
    else position.z = channel.maxZ + radius;
    return true;
  }
  return false;
};

/**
 * Commit one ground movement step. A step that would touch water is rejected and retried on each axis
 * alone, so a unit pushed at the bank slides along it (and a unit on a deck keeps walking the deck)
 * instead of sticking. Returns whether the unit actually moved.
 */
export const applyGroundStep = (traveller: RiverTraveller, nextX: number, nextZ: number): boolean => {
  const position = traveller.position;
  const radius = traveller.bodyRadius;
  const fromX = position.x;
  const fromZ = position.z;
  if (!blocksGroundStep(fromX, fromZ, nextX, nextZ, radius)) {
    position.x = nextX;
    position.z = nextZ;
    return nextX !== fromX || nextZ !== fromZ;
  }
  if (!blocksGroundStep(fromX, fromZ, nextX, fromZ, radius)) {
    position.x = nextX;
    return nextX !== fromX;
  }
  if (!blocksGroundStep(fromX, fromZ, fromX, nextZ, radius)) {
    position.z = nextZ;
    return nextZ !== fromZ;
  }
  keepOnLand(traveller);
  return false;
};

/**
 * True when a channel still separates the traveller from a destination Z, or when the traveller is
 * mid-crossing. Scripted straight-line walks (the tower and castle ladder queues) use this to hold off
 * until the unit is on the right bank and clear of the water, since their paths ignore the barrier.
 */
export const blocksApproach = (traveller: RiverTraveller, destinationZ: number): boolean => {
  for (const channel of ARENA_RIVERS) {
    if (touchesWater(channel, traveller.position.z, traveller.bodyRadius)) return true;
    if (sideOf(channel, traveller.position.z) !== sideOf(channel, destinationZ)) return true;
  }
  return false;
};

/** The channel a unit must cross to reach its goal, or -1 when it can already walk straight there. */
const separatingChannel = (traveller: RiverTraveller, goal: Vector3): number => {
  const position = traveller.position;
  const radius = traveller.bodyRadius;
  let selected = -1;
  let nearest = Number.POSITIVE_INFINITY;
  for (let index = 0; index < ARENA_RIVERS.length; index += 1) {
    const channel = ARENA_RIVERS[index];
    if (standsOverWater(channel, goal.z)) {
      // A fight on a deck: stop routing once the unit is standing on that crossing itself.
      if (touchesWater(channel, position.z, radius) && deckAt(channel, position.x, radius) >= 0) continue;
    } else if (sideOf(channel, position.z) === sideOf(channel, goal.z)) continue;
    const distance = Math.abs(channel.centerZ - position.z);
    if (distance < nearest) {
      nearest = distance;
      selected = index;
    }
  }
  return selected;
};

const createRoute = (traveller: RiverTraveller, channelIndex: number, goal: Vector3): RiverRoute => {
  const channel = ARENA_RIVERS[channelIndex];
  const position = traveller.position;
  const radius = traveller.bodyRadius;
  const boarded = touchesWater(channel, position.z, radius) ? deckAt(channel, position.x, radius) : -1;
  // A goal over the water is standing on a deck, so head for that deck rather than the cheapest one.
  const goalDeck = standsOverWater(channel, goal.z) ? deckAt(channel, goal.x, 0) : -1;
  const chosen = boarded >= 0 ? boarded : goalDeck >= 0 ? goalDeck : pickBridge(channel, position.x, goal.x);
  return {
    channelIndex,
    bridgeIndex: chosen,
    fromSide: sideOf(channel, position.z),
    // A unit already on a deck starts mid-crossing so the route never walks it back off the bridge.
    stage: boarded >= 0 ? 1 : 0,
    boardOnly: standsOverWater(channel, goal.z),
    stuckClock: 0,
    bestDistanceSquared: Number.POSITIVE_INFINITY,
  };
};

const restartStage = (route: RiverRoute, stage: number): void => {
  route.stage = stage;
  route.stuckClock = 0;
  route.bestDistanceSquared = Number.POSITIVE_INFINITY;
};

/**
 * Waypoint the traveller should steer at, or null once the crossing is done. Stages advance on the
 * unit's own progress and never step backwards, so both directions use the same three waypoints.
 */
const followRoute = (
  traveller: RiverTraveller,
  route: RiverRoute,
  deltaSeconds: number,
): Vector3 | null => {
  const channel = ARENA_RIVERS[route.channelIndex];
  const position = traveller.position;
  const radius = traveller.bodyRadius;
  const entranceZ = route.fromSide < 0
    ? channel.minZ - BANK_MARGIN - radius
    : channel.maxZ + BANK_MARGIN + radius;
  // The exit stands several body radii past the far bank edge so a crossing unit keeps moving
  // clear of the bridge mouth before it may stop, retarget or spread sideways.
  const exitZ = route.fromSide < 0
    ? channel.maxZ + BANK_MARGIN + radius + EXIT_CLEAR_RADII * radius
    : channel.minZ - BANK_MARGIN - radius - EXIT_CLEAR_RADII * radius;
  const onDeck = touchesWater(channel, position.z, radius)
    && deckAt(channel, position.x, radius) === route.bridgeIndex;
  // A unit registered with the bridge traffic system may not advance into the deck on its own:
  // the traffic system hands it the queue slot and only lets the queue head step in when the
  // bridge has capacity. A unit already standing on the deck still advances, never reversing.
  const gated = traveller.bridgeState === 'approaching' || traveller.bridgeState === 'queued';

  if (route.stage === 0) {
    const offsetX = channel.bridges[route.bridgeIndex].centerX - position.x;
    const offsetZ = entranceZ - position.z;
    const distanceSquared = offsetX * offsetX + offsetZ * offsetZ;
    if (onDeck || (!gated && distanceSquared <= APPROACH_ARRIVAL * APPROACH_ARRIVAL)) {
      restartStage(route, 1);
    } else {
      if (gated) {
        goalScratch.set(channel.bridges[route.bridgeIndex].centerX, position.y, entranceZ);
        return goalScratch;
      }
      if (distanceSquared < route.bestDistanceSquared - PROGRESS_EPSILON) {
        route.bestDistanceSquared = distanceSquared;
        route.stuckClock = 0;
      } else {
        route.stuckClock += deltaSeconds;
        // Jammed on the bank: try the other deck. A unit already on a deck stays committed, and a
        // boardOnly route has nowhere else to go — its goal is standing on this deck.
        if (!route.boardOnly && route.stuckClock >= STUCK_SECONDS && channel.bridges.length > 1) {
          route.bridgeIndex = (route.bridgeIndex + 1) % channel.bridges.length;
          restartStage(route, 0);
        }
      }
      goalScratch.set(channel.bridges[route.bridgeIndex].centerX, position.y, entranceZ);
      return goalScratch;
    }
  }

  if (route.stage === 1) {
    if (route.boardOnly && onDeck) return null;
    // Stages hand over slightly before the waypoint itself: the mover stops chasing a goal it is
    // already standing on, so an exact-arrival test could leave a unit parked on the deck.
    const reachedMiddle = route.fromSide < 0
      ? position.z >= channel.centerZ - APPROACH_ARRIVAL
      : position.z <= channel.centerZ + APPROACH_ARRIVAL;
    if (reachedMiddle) restartStage(route, 2);
  }

  if (route.stage === 2) {
    const cleared = route.fromSide < 0
      ? position.z >= exitZ - APPROACH_ARRIVAL
      : position.z <= exitZ + APPROACH_ARRIVAL;
    if (cleared) return null;
  }

  goalScratch.set(
    channel.bridges[route.bridgeIndex].centerX,
    position.y,
    route.stage === 1 ? channel.centerZ : exitZ,
  );
  return goalScratch;
};

/**
 * Swap a ground goal for the current bridge waypoint whenever a channel separates the unit from it, so
 * direct target seeking can never pull a unit diagonally into the water. The cached route survives
 * until the target side changes, the crossing finishes, or the unit stalls at an entrance; everything
 * in between is a few comparisons per frame.
 */
export const resolveCrossingGoal = (
  traveller: RiverTraveller,
  goal: Vector3,
  deltaSeconds: number,
): Vector3 => {
  let route = traveller.riverRoute;
  if (route) {
    const channel = ARENA_RIVERS[route.channelIndex];
    const stillWanted = route.boardOnly
      ? standsOverWater(channel, goal.z)
      : sideOf(channel, goal.z) === -route.fromSide;
    if (!stillWanted) route = null;
  }

  if (!route) {
    const channelIndex = separatingChannel(traveller, goal);
    if (channelIndex < 0) {
      traveller.riverRoute = null;
      return goal;
    }
    route = createRoute(traveller, channelIndex, goal);
  }

  traveller.riverRoute = route;
  const waypoint = followRoute(traveller, route, deltaSeconds);
  if (waypoint) return waypoint;
  traveller.riverRoute = null;
  return goal;
};
