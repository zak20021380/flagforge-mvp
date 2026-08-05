import { Vector3 } from '@babylonjs/core';
import { CENTRAL_TOWER } from '../core/config';
import { squaredDistanceXZ } from '../core/math';
import { blocksGroundStep } from './riverCrossing';
import type { UnitEntity } from './unit';

/**
 * Lightweight open-ground coordination around the central objective and other crowded points.
 *
 * The central tower gets a fixed ring of reserved standoff positions (staggered radii so the ring
 * never reads as an unbreakable wall). A unit whose strategic goal is the flag on the tower holds a
 * reserved slot while it waits for a ladder slot. Every reservation is released the moment the unit
 * is claimed by another system, moves away, dies, deactivates, leaves the ground, or its goal stops
 * being the tower, and a stale holder that can no longer reach its slot simply re-keys to the next
 * free slot, so a reservation can never block a valid position permanently.
 *
 * Around any other crowded point (an enemy target, the dropped flag, the enemy gate) melee units
 * receive a stable per-unit engagement offset instead of all seeking the exact same spot. The offset
 * is a pure function of the unit id (golden-angle fan plus an id-staggered radius), so it never
 * changes frame to frame; only the throttled crowd probe that gates it is cached, and there is no
 * per-frame allocation anywhere in this module.
 */

/** Units farther than this from the tower center do not reserve a standoff slot yet. */
const TOWER_RESERVE_RADIUS = 13;
/** Units closer than this to the tower centre simply hold position: they are at the ladder base. */
const NEAR_BASE_RADIUS = 4.2;
/** Ring slot radii, alternated so adjacent holders never form a contiguous wall. */
const SLOT_RADII = [5.6, 6.5];
/** World-space slot angles around the tower, compass order. */
const SLOT_ANGLES = [0, 45, 90, 135, 180, 225, 270, 315];
/** A unit farther than this from its own slot no longer owns it. */
const SLOT_OWNERSHIP_RADIUS = 14;
/** How close another same-team unit must be to a point before it counts as converging on it. */
const CROWD_RADIUS = 4.5;
/** A point is only treated as a crowd when at least this many units are converging on it. */
const CROWD_MIN_UNITS = 3;
/** Golden-angle fan: spreads any number of units around a point without stacking. */
const GOLDEN_ANGLE = 137.50776405003785;
/** The engagement radius is this fraction of the unit's melee reach. */
const OFFSET_RADIUS_FRACTION = 0.8;
/** Stagger between two consecutive units on the same radius band. */
const OFFSET_RADIUS_STEP = 0.14;
/** A unit closer than this to the goal keeps the raw goal: it is arriving or already there. */
const ARRIVED_DISTANCE_SQUARED = 2 * 2;

const DEG2RAD = Math.PI / 180;
const slotScratch = Vector3.Zero();
const offsetScratch = Vector3.Zero();
const towerCenter = new Vector3(CENTRAL_TOWER.centerX, 0.16, CENTRAL_TOWER.centerZ);

interface TowerSlot {
  readonly x: number;
  readonly z: number;
  holder: UnitEntity | null;
}

export class CrowdSystem {
  private readonly slots: TowerSlot[];

  constructor() {
    this.slots = SLOT_ANGLES.map((angle, index) => {
      const radius = SLOT_RADII[index % SLOT_RADII.length];
      const radians = angle * DEG2RAD;
      return {
        x: CENTRAL_TOWER.centerX + Math.sin(radians) * radius,
        z: CENTRAL_TOWER.centerZ + Math.cos(radians) * radius,
        holder: null,
      };
    });
  }

  /** Drop reservations held by dead, deactivated or off-ground units. Idempotent. */
  beginFrame(): void {
    for (const slot of this.slots) {
      const unit = slot.holder;
      if (!unit) continue;
      if (!unit.active || unit.state === 'dead' || unit.navigationArea !== 'ground') {
        slot.holder = null;
        unit.reservedSlot = -1;
      }
    }
  }

  /** Release whatever reservation the unit holds. Idempotent. */
  release(unit: UnitEntity): void {
    if (unit.reservedSlot < 0) return;
    const slot = this.slots[unit.reservedSlot];
    if (slot.holder === unit) slot.holder = null;
    unit.reservedSlot = -1;
  }

  /** Stuck-recovery variant: drop the current slot and prefer a different one next acquisition. */
  reacquire(unit: UnitEntity): void {
    this.release(unit);
    unit.acquireBias += 1;
  }

  /**
   * Reserved standoff position for a unit whose strategic goal is the tower-top flag, or null when
   * it should keep normal movement. Re-evaluated every frame, so reservations never outlive the
   * goal, the reachability or the unit itself.
   */
  slotGoal(unit: UnitEntity, goal: Vector3): Vector3 | null {
    const towerIntent = goal.y >= CENTRAL_TOWER.topSurfaceY - 0.6;
    if (!towerIntent || unit.navigationArea !== 'ground' || unit.carryingFlag) {
      this.release(unit);
      return null;
    }
    if (unit.reservedSlot >= 0) {
      const slot = this.slots[unit.reservedSlot];
      if (slot.holder !== unit) {
        unit.reservedSlot = -1;
        return null;
      }
      // The unit left the area: its slot belongs to someone else now.
      if (squaredDistanceXZ(unit.position, towerCenter) > SLOT_OWNERSHIP_RADIUS * SLOT_OWNERSHIP_RADIUS) {
        this.release(unit);
        return null;
      }
      return slotScratch.set(slot.x, unit.position.y, slot.z);
    }
    // Only units close enough to actually hold the approach reserve take a slot. Units already at
    // the ladder base hold position quietly; the ladder queue drains and claims them in turn.
    const distanceToCenterSquared = squaredDistanceXZ(unit.position, towerCenter);
    if (distanceToCenterSquared <= NEAR_BASE_RADIUS * NEAR_BASE_RADIUS) {
      return slotScratch.set(unit.position.x, unit.position.y, unit.position.z);
    }
    if (distanceToCenterSquared > TOWER_RESERVE_RADIUS * TOWER_RESERVE_RADIUS) return null;
    for (let probe = 0; probe < this.slots.length; probe += 1) {
      const index = (unit.id + probe + unit.acquireBias) % this.slots.length;
      const slot = this.slots[index];
      if (slot.holder) continue;
      // A slot the unit could only reach through water is not a valid reservation.
      if (blocksGroundStep(unit.position.x, unit.position.z, slot.x, slot.z, unit.bodyRadius)) continue;
      slot.holder = unit;
      unit.reservedSlot = index;
      return slotScratch.set(slot.x, unit.position.y, slot.z);
    }
    return null;
  }

  /**
   * Stable engagement offset around a crowded point for melee units, or null when the point is not
   * crowded, the unit should keep the raw goal, or every offset around it is unreachable. The
   * offset is a pure function of the unit id; the crowd probe is throttled and cached on the unit.
   */
  offsetGoal(
    unit: UnitEntity,
    goal: Vector3,
    units: readonly UnitEntity[],
    crowdPoint: boolean,
    deltaSeconds: number,
  ): Vector3 | null {
    if (
      !crowdPoint
      || unit.kind === 'nyx'
      || unit.carryingFlag
      || unit.navigationArea !== 'ground'
      || unit.bridgeState === 'entering'
      || unit.bridgeState === 'crossing'
      || unit.bridgeState === 'exiting'
    ) return null;
    if (squaredDistanceXZ(unit.position, goal) <= ARRIVED_DISTANCE_SQUARED) return null;
    unit.crowdClock -= deltaSeconds;
    if (unit.crowdClock <= 0) {
      unit.crowdClock = 0.24 + (unit.id % 5) * 0.03;
      let converging = 0;
      let nearest: UnitEntity | null = null;
      let nearestDistance = Number.POSITIVE_INFINITY;
      for (const other of units) {
        if (!other.active || other.state === 'dead' || other.team !== unit.team || other.navigationArea !== 'ground') continue;
        const distance = squaredDistanceXZ(goal, other.position);
        if (distance <= CROWD_RADIUS * CROWD_RADIUS) converging += 1;
        if (distance < nearestDistance) {
          nearestDistance = distance;
          nearest = other;
        }
      }
      // The nearest unit keeps the raw goal so the point is actually reached; everyone else fans out.
      unit.crowdEngaged = converging >= CROWD_MIN_UNITS && nearest !== unit;
    }
    if (!unit.crowdEngaged) return null;
    const angle = ((unit.id * GOLDEN_ANGLE) % 360) * DEG2RAD;
    const radius = unit.stats.attackRange * OFFSET_RADIUS_FRACTION + (unit.id % 3) * OFFSET_RADIUS_STEP;
    const dx = Math.sin(angle) * radius;
    const dz = Math.cos(angle) * radius;
    for (const mirror of [1, -1]) {
      const x = goal.x + dx * mirror;
      const z = goal.z + dz * mirror;
      if (!blocksGroundStep(unit.position.x, unit.position.z, x, z, unit.bodyRadius)) {
        return offsetScratch.set(x, unit.position.y, z);
      }
    }
    return null;
  }
}
