import { Vector3 } from '@babylonjs/core';
import { ARENA_RIVERS, CONFIG, UNIT_STATS } from '../core/config';
import { squaredDistanceXZ } from '../core/math';
import type { ArenaRiverBridge, Team, UnitKind } from '../core/types';
import { BRIDGE_BANK_MARGIN, BRIDGE_QUEUE_ARRIVAL, EXIT_CLEAR_RADII } from './riverCrossing';
import type { RiverRoute } from './riverCrossing';
import type { UnitEntity } from './unit';

/**
 * Shared, lightweight bridge-traffic system for every team and unit type.
 *
 * Each painted bridge deck is treated as a narrow shared corridor with a single-file queue on each
 * bank. Units commit to one bridge and direction when their crossing route starts, walk to a stable
 * slot behind the entrance, and only step onto the deck when they are the queue head and the deck
 * still has room for their body. Everything is cached: the queue, the deck counters and the
 * per-bridge capacity table are persistent objects rebuilt only on state changes, and per-frame
 * work is a handful of comparisons plus one short walk over the (tiny) queue. No navmesh, no
 * physics, no path search and no per-frame allocation.
 *
 * Bridge combat: each deck is further divided into one or two logical lanes (only when the walkable
 * width safely supports them). A unit is assigned to the lane `id % laneCount`, which is stable for
 * its whole life. Lane members on the deck are kept in front-to-back order (front = farthest toward
 * the far bank), and while an enemy is present on the deck the lane becomes a combat queue:
 *
 *  - The leading member of each direction in a lane is the frontline. It advances along the bridge
 *    axis until the nearest enemy ahead is within its own attack range, then holds and fights.
 *  - Members behind the frontline hold a stable slot one body-spacing behind the nearest
 *    same-direction member ahead of them, so waiting units never push the front or overlap.
 *  - Ranged members engage from their slot whenever their own range and line of fire reach; they
 *    never push past the frontline.
 *  - When the frontline dies (or leaves), the next member is already in place and simply advances
 *    into the freed position on the next frame; no references to the dead unit are retained.
 *  - When no enemy is left on the deck, every member reverts to normal crossing and clears the far
 *    exit, so all combat state drains away as the units walk off.
 *
 * State machine (unit.bridgeState):
 *   approaching - route active, walking to its reserved slot behind the entrance
 *   queued      - standing in the line, waiting for the head slot and deck capacity
 *   entering    - queue head, committed to the deck (route stage 1)
 *   crossing    - past the channel centre, still over the water
 *   exiting     - body clear of the water, forced run-out toward the far bank
 *   cleared     - released, finishing the run-out; next frame it is 'none'
 */

const KIND_INDEX: Record<UnitKind, number> = { vanguard: 0, ranger: 1, raider: 2, ironGuard: 3 };
/** Queue slot gap multiplier applied to the sum of the two unit body radii. */
const AXIS_SPACING = 1.35;
/** Fixed gap between queued bodies, on top of the radius-based spacing. */
const AXIS_GAP = 0.12;
/** Deck capacity divisor: one lane per body diameter plus this headroom. */
const CAPACITY_WIDTH_FACTOR = 1.18;
/** Z distance around the entrance where approaching units join the axis-only separation. */
const QUEUE_ZONE = 12;
/** Sideways separation multiplier for units in a queue line. */
const QUEUE_STRIP_X = 0.18;
/** Extra body-diameter slack a deck needs before a second logical lane is allowed. */
const LANE_MIN_GAP = 0.35;
/** Enemies at least this far behind a unit do not count as blocking its advance. */
const AHEAD_TOLERANCE = 0.35;

const queueScratch = Vector3.Zero();

/** One bank-side queue in front of a bridge entrance. Members are ordered from entrance back. */
export interface BridgeQueue {
  readonly deck: BridgeDeck;
  /** -1 = low-Z bank, 1 = high-Z bank; slots extend opposite to fromSide. */
  readonly fromSide: number;
  readonly members: UnitEntity[];
}

/** One logical traffic lane along a deck: a fixed centre X plus per-team member lists. */
export interface CombatLane {
  /** X of the lane centre; every member of the lane forms up on this axis. */
  readonly centerX: number;
  /** Units on the deck in this lane, ordered front-to-back (far bank first). */
  readonly members: [UnitEntity[], UnitEntity[]];
}

/** One bridge deck: the shared occupancy counter plus the two bank-side queues. */
export interface BridgeDeck {
  readonly channelIndex: number;
  readonly bridgeIndex: number;
  readonly low: BridgeQueue;
  readonly high: BridgeQueue;
  /** Logical combat lanes this deck is split into, when its width safely supports them. */
  readonly lanes: readonly CombatLane[];
  /** Deck occupancy limit per unit kind, derived from the usable walkable width. */
  readonly capacityByKind: readonly number[];
  /** Units currently entering, crossing or exiting this deck. */
  onDeck: number;
}

/** Largest body radius across every unit kind, used to size the lanes. */
const MAX_BODY_RADIUS = Math.max(
  ...(['vanguard', 'ranger', 'raider', 'ironGuard'] as const)
    .map((kind) => CONFIG.unit.separationRadius * 0.5 * UNIT_STATS[kind].scale),
);

/** Mutable stand-in used only while the deck and its two queues close over each other. */
type MutableBridgeDeck = Omit<BridgeDeck, 'low' | 'high'> & { low: BridgeQueue; high: BridgeQueue };

const teamIndex = (team: Team): 0 | 1 => (team === 'blue' ? 0 : 1);

const spacingBetween = (radiusA: number, radiusB: number): number =>
  (radiusA + radiusB) * AXIS_SPACING + AXIS_GAP;

export class BridgeTraffic {
  private readonly decks: BridgeDeck[][];
  private readonly registered: UnitEntity[] = [];

  constructor() {
    this.decks = ARENA_RIVERS.map((channel, channelIndex) => channel.bridges.map((bridge, bridgeIndex) => {
      const walkableWidth = bridge.walkMaxX - bridge.walkMinX;
      const capacityByKind: number[] = [];
      for (const kind of ['vanguard', 'ranger', 'raider', 'ironGuard'] as const) {
        const radius = CONFIG.unit.separationRadius * 0.5 * UNIT_STATS[kind].scale;
        capacityByKind.push(Math.max(1, Math.floor(walkableWidth / (radius * 2 * CAPACITY_WIDTH_FACTOR))));
      }
      // A second lane is only created when two bodies plus a separator fit across the deck.
      const laneCount = walkableWidth >= MAX_BODY_RADIUS * 4 + LANE_MIN_GAP ? 2 : 1;
      const lanes: CombatLane[] = [];
      for (let lane = 0; lane < laneCount; lane += 1) {
        lanes.push({ centerX: bridge.walkMinX + walkableWidth * ((lane + 0.5) / laneCount), members: [[], []] });
      }
      // The queues are assembled on a mutable stand-in so they can close over the finished deck.
      const build: MutableBridgeDeck = {
        channelIndex,
        bridgeIndex,
        lanes,
        capacityByKind,
        onDeck: 0,
        low: null as unknown as BridgeQueue,
        high: null as unknown as BridgeQueue,
      };
      build.low = { deck: build as unknown as BridgeDeck, fromSide: -1, members: [] };
      build.high = { deck: build as unknown as BridgeDeck, fromSide: 1, members: [] };
      return build as BridgeDeck;
    }));
  }

  /** Drop stale registrations (dead, deactivated, non-ground, ladder-owned or route-less units). Idempotent. */
  beginFrame(): void {
    for (let index = this.registered.length - 1; index >= 0; index -= 1) {
      const unit = this.registered[index];
      if (
        !unit.active
        || unit.state === 'dead'
        || unit.state === 'queued'
        || unit.navigationArea !== 'ground'
        || (!unit.riverRoute && !this.deckCombatHolds(unit))
      ) {
        this.detach(unit, 'none');
      }
    }
    // Keep the lane member lists in sync with the actual deck states.
    for (const unit of this.registered) {
      const onDeck = unit.bridgeState === 'entering'
        || unit.bridgeState === 'crossing'
        || unit.bridgeState === 'exiting';
      const members = this.laneMembersOf(unit);
      const present = members !== null && members.indexOf(unit) >= 0;
      if (onDeck && !present && members !== null && unit.bridgeQueue) {
        this.addToLane(unit, unit.bridgeQueue.deck);
      } else if (!onDeck && present && members !== null) {
        this.removeFromLane(unit);
      }
    }
  }

  /**
   * Per-frame reconciliation, run before crossing planning: releases stale membership and commits
   * the unit to the bridge and bank direction of its current route. A route that somehow started on
   * the deck (stage 1) without being registered is pulled back into the queue.
   */
  syncRegistration(unit: UnitEntity): void {
    const route = unit.riverRoute;
    if (!route) {
      // A unit mid-fight keeps its deck membership even if its route died (e.g. its strategic goal
      // flipped sides); combat state releases it once the deck clears.
      if (this.deckCombatHolds(unit)) return;
      if (unit.bridgeState === 'cleared') unit.bridgeState = 'none';
      else if (unit.bridgeState !== 'none') this.detach(unit, 'none');
      return;
    }
    const dir = this.queueFor(route);
    if (unit.bridgeQueue === dir) return;
    if (unit.bridgeState !== 'none' && unit.bridgeState !== 'cleared') this.detach(unit, 'none');
    unit.bridgeQueue = dir;
    const channel = ARENA_RIVERS[route.channelIndex];
    const radius = unit.bodyRadius;
    const overWater = unit.position.z > channel.minZ - radius && unit.position.z < channel.maxZ + radius;
    if (route.stage >= 1 && overWater) {
      dir.deck.onDeck += 1;
      this.addToLane(unit, dir.deck);
      unit.bridgeState = 'entering';
    } else {
      if (route.stage >= 1) route.stage = 0;
      unit.bridgeState = 'approaching';
    }
    this.registered.push(unit);
  }

  /**
   * Resolve the movement goal of a unit with an active crossing route: the queue slot or staging
   * point while waiting, the crossing waypoint once on the deck, and state transitions plus
   * occupancy release at the end. Returns the input waypoint when the unit is not waiting.
   */
  applyQueueGoal(unit: UnitEntity, waypoint: Vector3): Vector3 {
    const route = unit.riverRoute;
    if (!route) {
      if (this.deckCombatHolds(unit)) return this.deckCombatGoal(unit, waypoint);
      if (unit.bridgeState === 'entering' || unit.bridgeState === 'crossing' || unit.bridgeState === 'exiting') {
        this.detach(unit, 'cleared');
      } else if (unit.bridgeState === 'queued' || unit.bridgeState === 'approaching') {
        this.detach(unit, 'none');
      }
      return waypoint;
    }

    this.syncRegistration(unit);
    const dir = this.queueFor(route);
    const channel = ARENA_RIVERS[route.channelIndex];
    const bridge = channel.bridges[route.bridgeIndex];
    const position = unit.position;
    const entrance = route.fromSide < 0
      ? channel.minZ - BRIDGE_BANK_MARGIN - unit.bodyRadius
      : channel.maxZ + BRIDGE_BANK_MARGIN + unit.bodyRadius;

    if (unit.bridgeState === 'entering' || unit.bridgeState === 'crossing' || unit.bridgeState === 'exiting') {
      // Stage hand-offs keep running even while a fight holds the unit, so the run-out goal stays
      // consistent once the deck clears.
      if (unit.bridgeState === 'entering' && (route.fromSide < 0 ? position.z >= channel.centerZ : position.z <= channel.centerZ)) {
        unit.bridgeState = 'crossing';
      } else if (
        unit.bridgeState === 'crossing'
        && (route.fromSide < 0 ? position.z >= channel.maxZ + unit.bodyRadius : position.z <= channel.minZ - unit.bodyRadius)
      ) {
        unit.bridgeState = 'exiting';
      }
      return this.deckCombatGoal(unit, waypoint);
    }

    switch (unit.bridgeState) {
      case 'approaching': {
        if (route.stage >= 1) {
          this.promoteToDeck(unit, dir);
          return waypoint;
        }
        const staging = this.queuePosition(dir, unit, entrance);
        if (!this.arrivedAt(unit, bridge.centerX, staging)) {
          queueScratch.set(bridge.centerX, position.y, staging);
          return queueScratch;
        }
        dir.members.push(unit);
        unit.bridgeState = 'queued';
        if (this.tryEnter(unit, dir, bridge, entrance)) return waypoint;
        queueScratch.set(bridge.centerX, position.y, this.queuePositionAt(dir, entrance, dir.members.indexOf(unit)));
        return queueScratch;
      }
      case 'queued': {
        if (route.stage >= 1) {
          this.promoteToDeck(unit, dir);
          return waypoint;
        }
        if (this.tryEnter(unit, dir, bridge, entrance)) return waypoint;
        queueScratch.set(bridge.centerX, position.y, this.queuePositionAt(dir, entrance, dir.members.indexOf(unit)));
        return queueScratch;
      }
      default:
        return waypoint;
    }
  }

  /**
   * Sideways separation multiplier for this unit: zero on the deck, near-zero inside the queue zone
   * (forward/backward spacing preferred), full in the open field.
   */
  separationScaleX(unit: UnitEntity): number {
    const state = unit.bridgeState;
    if (state === 'entering' || state === 'crossing' || state === 'exiting') return 0;
    if (state === 'queued') return QUEUE_STRIP_X;
    if (state === 'approaching') {
      const route = unit.riverRoute;
      if (!route) return 1;
      const channel = ARENA_RIVERS[route.channelIndex];
      const entrance = route.fromSide < 0
        ? channel.minZ - BRIDGE_BANK_MARGIN - unit.bodyRadius
        : channel.maxZ + BRIDGE_BANK_MARGIN + unit.bodyRadius;
      return Math.abs(unit.position.z - entrance) <= QUEUE_ZONE ? QUEUE_STRIP_X : 1;
    }
    return 1;
  }

  /** Deck object for a channel/bridge index pair. */
  deckOf(channelIndex: number, bridgeIndex: number): BridgeDeck {
    return this.decks[channelIndex][bridgeIndex];
  }

  /** Total bodies committed to a deck: deck walkers plus both bank queues. */
  committedCount(deck: BridgeDeck): number {
    return deck.onDeck + deck.low.members.length + deck.high.members.length;
  }

  /**
   * True while an enemy unit is committed to the same deck (deck walkers or either bank queue), so
   * the unit keeps its strategic target and the combat goal rules take over its movement.
   */
  isInCombat(unit: UnitEntity): boolean {
    return this.deckHasEnemy(unit.team, unit.bridgeQueue?.deck);
  }

  /**
   * Nearest reachable enemy on the same bridge (deck or either bank queue), or null when the bridge
   * is clear. Computed fresh every frame so dead or deactivated enemies are never retained.
   */
  contestedTarget(unit: UnitEntity): UnitEntity | null {
    const deck = unit.bridgeQueue?.deck;
    if (!deck) return null;
    let nearest: UnitEntity | null = null;
    let best = Number.POSITIVE_INFINITY;
    for (const candidate of this.registered) {
      if (candidate === unit || candidate.team === unit.team) continue;
      if (!candidate.active || candidate.state === 'dead') continue;
      if (candidate.bridgeQueue?.deck !== deck) continue;
      const distance = squaredDistanceXZ(unit.position, candidate.position);
      if (distance < best) {
        best = distance;
        nearest = candidate;
      }
    }
    return nearest;
  }

  /** True while a deck unit without a live route may still hold the deck in combat. */
  private deckCombatHolds(unit: UnitEntity): boolean {
    const state = unit.bridgeState;
    if (state !== 'entering' && state !== 'crossing' && state !== 'exiting') return false;
    return this.deckHasEnemy(unit.team, unit.bridgeQueue?.deck);
  }

  private deckHasEnemy(team: Team, deck: BridgeDeck | null | undefined): boolean {
    if (!deck) return false;
    for (const unit of this.registered) {
      if (unit.team === team) continue;
      if (!unit.active || unit.state === 'dead') continue;
      if (unit.bridgeQueue?.deck === deck) return true;
    }
    return false;
  }

  /**
   * Movement goal for a unit on the deck while its bridge is contested: the frontline stop once an
   * enemy ahead is within attack range, a stable queue slot behind the nearest same-direction lane
   * member, or the plain crossing waypoint when combat has ended.
   */
  private deckCombatGoal(unit: UnitEntity, waypoint: Vector3): Vector3 {
    const dir = unit.bridgeQueue;
    if (!dir) return waypoint;
    const deck = dir.deck;
    if (!this.deckHasEnemy(unit.team, deck)) return waypoint;
    const lane = deck.lanes[unit.id % deck.lanes.length];
    const members = lane.members[teamIndex(unit.team)];
    const myIndex = members.indexOf(unit);
    if (myIndex < 0) return this.forwardAxisGoal(unit, dir);
    const sign = dir.fromSide < 0 ? 1 : -1;
    // Queue behind the nearest member ahead of me that crosses the same way; opposite-direction
    // members (a returning carrier among attackers) are transient and not part of the line.
    let aheadIndex = -1;
    for (let index = myIndex - 1; index >= 0; index -= 1) {
      const aheadQueue = members[index].bridgeQueue;
      if (aheadQueue && (aheadQueue.fromSide < 0 ? 1 : -1) === sign) {
        aheadIndex = index;
        break;
      }
    }
    if (aheadIndex < 0) {
      // Direction front: hold as soon as the nearest enemy ahead is within this unit's attack range,
      // otherwise keep advancing along the bridge axis.
      const enemy = this.nearestEnemyAhead(unit, deck);
      if (enemy && squaredDistanceXZ(unit.position, enemy.position) <= unit.stats.attackRange * unit.stats.attackRange) {
        queueScratch.set(unit.position.x, unit.position.y, unit.position.z);
        return queueScratch;
      }
      return this.forwardAxisGoal(unit, dir);
    }
    const ahead = members[aheadIndex];
    queueScratch.set(
      lane.centerX,
      unit.position.y,
      ahead.position.z - sign * spacingBetween(ahead.bodyRadius, unit.bodyRadius),
    );
    return queueScratch;
  }

  /** Nearest enemy ahead of the unit along its crossing direction, on the same deck. */
  private nearestEnemyAhead(unit: UnitEntity, deck: BridgeDeck): UnitEntity | null {
    const dir = unit.bridgeQueue;
    if (!dir) return null;
    const sign = dir.fromSide < 0 ? 1 : -1;
    let nearest: UnitEntity | null = null;
    let best = Number.POSITIVE_INFINITY;
    for (const candidate of this.registered) {
      if (candidate === unit || candidate.team === unit.team) continue;
      if (!candidate.active || candidate.state === 'dead') continue;
      if (candidate.bridgeQueue?.deck !== deck) continue;
      const ahead = sign > 0
        ? candidate.position.z >= unit.position.z - AHEAD_TOLERANCE
        : candidate.position.z <= unit.position.z + AHEAD_TOLERANCE;
      if (!ahead) continue;
      const distance = squaredDistanceXZ(unit.position, candidate.position);
      if (distance < best) {
        best = distance;
        nearest = candidate;
      }
    }
    return nearest;
  }

  /** Deck-axis waypoint a fighting unit keeps advancing toward (centre first, then the far run-out). */
  private forwardAxisGoal(unit: UnitEntity, dir: BridgeQueue): Vector3 {
    const channel = ARENA_RIVERS[dir.deck.channelIndex];
    const route = unit.riverRoute;
    const stage = route ? route.stage : unit.bridgeState === 'exiting' ? 2 : 1;
    let goalZ: number;
    if (stage >= 2) {
      goalZ = dir.fromSide < 0
        ? channel.maxZ + BRIDGE_BANK_MARGIN + unit.bodyRadius + EXIT_CLEAR_RADII * unit.bodyRadius
        : channel.minZ - BRIDGE_BANK_MARGIN - unit.bodyRadius - EXIT_CLEAR_RADII * unit.bodyRadius;
    } else {
      goalZ = channel.centerZ;
    }
    // The axis goal never points backward: a unit held past its goal waits in place instead of
    // walking back over the deck while enemies are still around.
    if (dir.fromSide < 0) goalZ = Math.max(goalZ, unit.position.z);
    else goalZ = Math.min(goalZ, unit.position.z);
    const lane = dir.deck.lanes[unit.id % dir.deck.lanes.length];
    queueScratch.set(lane.centerX, unit.position.y, goalZ);
    return queueScratch;
  }

  /** Release a unit from the queue, the deck occupancy and the registration list. Idempotent. */
  release(unit: UnitEntity): void {
    this.detach(unit, 'none');
  }

  private detach(unit: UnitEntity, finalState: 'none' | 'cleared'): void {
    const dir = unit.bridgeQueue;
    if (dir) {
      if (unit.bridgeState === 'queued') {
        this.removeMember(dir, unit);
      } else if (
        unit.bridgeState === 'entering'
        || unit.bridgeState === 'crossing'
        || unit.bridgeState === 'exiting'
      ) {
        dir.deck.onDeck = Math.max(0, dir.deck.onDeck - 1);
        this.removeFromLane(unit);
      }
      unit.bridgeQueue = null;
    }
    unit.bridgeState = finalState;
    const index = this.registered.indexOf(unit);
    if (index >= 0) this.registered.splice(index, 1);
  }

  private queueFor(route: RiverRoute): BridgeQueue {
    const deck = this.decks[route.channelIndex][route.bridgeIndex];
    return route.fromSide < 0 ? deck.low : deck.high;
  }

  /** Z of the slot the approaching unit would occupy once it joins the line (tail + own gap). */
  private queuePosition(dir: BridgeQueue, unit: UnitEntity, entrance: number): number {
    const members = dir.members;
    if (members.length === 0) return entrance;
    let cumulative = 0;
    for (let index = 1; index < members.length; index += 1) {
      cumulative += spacingBetween(members[index - 1].bodyRadius, members[index].bodyRadius);
    }
    cumulative += spacingBetween(members[members.length - 1].bodyRadius, unit.bodyRadius);
    return entrance + dir.fromSide * cumulative;
  }

  /** Z of the queue slot at the given member index, counting gaps from the entrance back. */
  private queuePositionAt(dir: BridgeQueue, entrance: number, index: number): number {
    const members = dir.members;
    let cumulative = 0;
    for (let slot = 1; slot <= index && slot < members.length; slot += 1) {
      cumulative += spacingBetween(members[slot - 1].bodyRadius, members[slot].bodyRadius);
    }
    return entrance + dir.fromSide * cumulative;
  }

  private arrivedAt(unit: UnitEntity, centerX: number, z: number): boolean {
    const dx = unit.position.x - centerX;
    const dz = unit.position.z - z;
    return dx * dx + dz * dz <= BRIDGE_QUEUE_ARRIVAL * BRIDGE_QUEUE_ARRIVAL;
  }

  private promoteToDeck(unit: UnitEntity, dir: BridgeQueue): void {
    this.removeMember(dir, unit);
    dir.deck.onDeck += 1;
    this.addToLane(unit, dir.deck);
    unit.bridgeState = 'entering';
  }

  /** Step the queue head onto the deck when it is at the entrance and the deck has room. */
  private tryEnter(unit: UnitEntity, dir: BridgeQueue, bridge: ArenaRiverBridge, entrance: number): boolean {
    if (dir.members[0] !== unit) return false;
    if (dir.deck.onDeck >= dir.deck.capacityByKind[KIND_INDEX[unit.kind]]) return false;
    if (!this.arrivedAt(unit, bridge.centerX, entrance)) return false;
    dir.members.shift();
    dir.deck.onDeck += 1;
    this.addToLane(unit, dir.deck);
    const route = unit.riverRoute;
    if (route) route.stage = 1;
    unit.bridgeState = 'entering';
    return true;
  }

  private removeMember(dir: BridgeQueue, unit: UnitEntity): void {
    const index = dir.members.indexOf(unit);
    if (index >= 0) dir.members.splice(index, 1);
  }

  /** Lane member list of a registered unit (null when it is not committed to any deck). */
  private laneMembersOf(unit: UnitEntity): UnitEntity[] | null {
    const deck = unit.bridgeQueue?.deck;
    if (!deck) return null;
    return deck.lanes[unit.id % deck.lanes.length].members[teamIndex(unit.team)];
  }

  /** Insert a deck member into its lane in front-to-back order (far bank first). */
  private addToLane(unit: UnitEntity, deck: BridgeDeck): void {
    const members = deck.lanes[unit.id % deck.lanes.length].members[teamIndex(unit.team)];
    let insertAt = members.length;
    for (let index = 0; index < members.length; index += 1) {
      const existing = members[index];
      const existingIsAhead = unit.team === 'blue'
        ? existing.position.z > unit.position.z
        : existing.position.z < unit.position.z;
      if (!existingIsAhead) {
        insertAt = index;
        break;
      }
    }
    members.splice(insertAt, 0, unit);
  }

  private removeFromLane(unit: UnitEntity): void {
    const members = this.laneMembersOf(unit);
    if (!members) return;
    const index = members.indexOf(unit);
    if (index >= 0) members.splice(index, 1);
  }
}
