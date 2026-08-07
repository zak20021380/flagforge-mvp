import { Vector3 } from '@babylonjs/core';
import { CENTRAL_TOWER, CENTRAL_TOWER_LADDER_MOUNT } from '../core/config';
import type { Team } from '../core/types';
import type { ClimbGripPair } from '../render/unitRig';
import { blocksApproach } from './riverCrossing';
import type { UnitEntity } from './unit';

type LadderId = keyof typeof CENTRAL_TOWER.ladders;
type ClimbDirection = 'ascending' | 'descending';

interface QueueEntry {
  readonly unit: UnitEntity;
  readonly direction: ClimbDirection;
}

interface ActiveClimb extends QueueEntry {
  pathIndex: number;
  climbDistance: number;
  dismountProgress: number;
  exitClearance: number;
  mountProgress: number;
  speedRamp: number;
  /** Position along the authored route; the visible body is attached to the ladder frame from this. */
  routePosition: Vector3;
}

type LadderMountData = typeof CENTRAL_TOWER_LADDER_MOUNT[LadderId];

interface LadderRuntime {
  readonly id: LadderId;
  readonly facingYaw: number;
  readonly mount: LadderMountData;
  readonly ascentPath: readonly Vector3[];
  readonly descentPath: readonly Vector3[];
  readonly groundQueue: readonly Vector3[];
  readonly topQueue: readonly Vector3[];
  readonly queue: QueueEntry[];
  active: ActiveClimb | null;
  activeDirection: ClimbDirection | null;
  // Ladder frame geometry derived from the SAME authored endpoints the mesh uses, so every hand
  // target lands on a real visible rung or rail.
  readonly shaftDir: Vector3;
  readonly rungDir: Vector3;
  readonly outward: Vector3;
  readonly climbLength: number;
  readonly rungCount: number;
  readonly footPoint: Vector3;
  /** World-space front-face point of every visible rung (index 0 at the foot). */
  readonly rungFronts: readonly Vector3[];
  /** World-space front point of the top rail head (the upper-hand grip at the ladder head). */
  readonly railGripPoint: Vector3;
  /** +1 when the unit's right hand faces +rungDir, -1 when mirrored (both ladders resolve it). */
  readonly handSign: number;
}

/** Scratch targets for the current frame's grips; the rig copies them immediately. */
interface GripScratch {
  readonly left: { readonly position: Vector3; readonly normal: Vector3; readonly lateral: Vector3 };
  readonly right: { readonly position: Vector3; readonly normal: Vector3; readonly lateral: Vector3 };
}

// ---- Hand-grip tuning. All distances are world units and match the ladder mesh blueprint in
// src/render/centralTower.ts (railHalfSpan 0.9, railDepth 0.5, headTrim 0.12, topStandoff 0.44).
// Hand laterals stay inside the rails (±0.9) so the fists never cross the stiles. ----
const CLIMB_HAND_LATERAL = 0.55;
const LADDER_RAIL_HALF_SPAN = 0.9;
const LADDER_RAIL_DEPTH = 0.5;
const LADDER_HEAD_TRIM = 0.12;
/** The lower hand grips this many rungs above the body's current rung cell (hands at chest height). */
const CLIMB_HAND_RUNG_OFFSET = 3;
/** Outward lift of the reaching hand mid-transit so the reach reads from the gameplay camera. */
const CLIMB_HAND_REACH_BOOST = 0.34;
/** Transit windows inside one rung cell: first hand 0.10..0.40, second 0.55..0.85, holds outside. */
const CLIMB_FIRST_MOVE_START = 0.1;
const CLIMB_FIRST_MOVE_SPAN = 0.3;
const CLIMB_SECOND_MOVE_START = 0.55;
const CLIMB_SECOND_MOVE_SPAN = 0.3;

const point = (value: { readonly x: number; readonly y: number; readonly z: number }): Vector3 => (
  new Vector3(value.x, value.y, value.z)
);

const EXIT_CLEARANCE_SECONDS = 0.35;

export class LadderSystem {
  private readonly ladders: Record<LadderId, LadderRuntime>;
  private readonly ladderList: readonly LadderRuntime[];
  private readonly towerTopUnits = new Set<UnitEntity>();
  private readonly unitLadderAssignment = new Map<UnitEntity, LadderId>();
  private readonly gripScratch: GripScratch = {
    left: { position: Vector3.Zero(), normal: Vector3.Zero(), lateral: Vector3.Zero() },
    right: { position: Vector3.Zero(), normal: Vector3.Zero(), lateral: Vector3.Zero() },
  };

  constructor() {
    this.ladders = {
      player: this.createRuntime('player'),
      enemy: this.createRuntime('enemy'),
    };
    this.ladderList = [this.ladders.player, this.ladders.enemy];
  }

  beginFrame(): void {
    for (const ladder of this.ladderList) {
      for (let index = ladder.queue.length - 1; index >= 0; index -= 1) {
        const unit = ladder.queue[index].unit;
        if (!unit.active || unit.state === 'dead') {
          this.unitLadderAssignment.delete(unit);
          ladder.queue.splice(index, 1);
        }
      }
      if (ladder.active && (!ladder.active.unit.active || ladder.active.unit.state === 'dead')) {
        this.unitLadderAssignment.delete(ladder.active.unit);
        this.cancelActive(ladder, ladder.active.unit, true);
      }
    }
    for (const unit of this.towerTopUnits) {
      if (!unit.active || unit.state === 'dead' || unit.navigationArea !== 'towerTop') {
        this.towerTopUnits.delete(unit);
      }
    }
  }

  isRegistered(unit: UnitEntity): boolean {
    return this.unitLadderAssignment.has(unit);
  }

  requestIfNeeded(unit: UnitEntity, goal: Vector3): boolean {
    if (this.isRegistered(unit)) return true;
    const goalIsTop = goal.y >= CENTRAL_TOWER.topSurfaceY - 0.6;
    const unitIsTop = unit.navigationArea === 'towerTop';
    if (goalIsTop === unitIsTop) return false;
    if (unit.navigationArea !== 'ground' && unit.navigationArea !== 'towerTop') return true;

    const ladderId = this.preferredLadder(unit.team);
    const ladder = this.ladders[ladderId];
    if (!unitIsTop && blocksApproach(unit, ladder.groundQueue[0].z)) return false;

    if (unitIsTop) {
      if (unit.carryingFlag) {
        this.cedeLadderToCarrier(ladder);
        this.insertDescending(ladder, unit, true);
      } else {
        if (ladder.activeDirection === 'ascending') return false;
        this.insertDescending(ladder, unit, false);
      }
    } else {
      if (ladder.activeDirection === 'descending') return false;
      if (this.towerOccupancy() + this.pendingAscenders() >= CENTRAL_TOWER.maximumTowerOccupancy) return false;
      if (ladder.queue.length >= CENTRAL_TOWER.maximumQueuePerLadder) return false;
      ladder.queue.push({ unit, direction: 'ascending' });
    }
    this.unitLadderAssignment.set(unit, ladderId);
    unit.target = null;
    unit.attackClock = 0;
    unit.attackHitApplied = false;
    unit.state = 'queued';
    return true;
  }

  /** Units physically on the tower right now: standing on the top or climbing either direction. */
  private towerOccupancy(): number {
    let count = this.towerTopUnits.size;
    for (const ladder of this.ladderList) {
      if (ladder.active) count += 1;
    }
    return count;
  }

  /** Units committed to climbing up the tower from the ground queues. */
  private pendingAscenders(): number {
    let count = 0;
    for (const ladder of this.ladderList) {
      for (const entry of ladder.queue) {
        if (entry.direction === 'ascending') count += 1;
      }
    }
    return count;
  }

  /**
   * Give the flag carrier its whole ladder: queued and mid-climb ascenders fall back to ground
   * movement so the carrier never waits on a blocked exit.
   */
  private cedeLadderToCarrier(ladder: LadderRuntime): void {
    const active = ladder.active;
    if (active && active.direction === 'ascending') {
      this.unitLadderAssignment.delete(active.unit);
      this.cancelActive(ladder, active.unit, true);
      this.returnToGround(active.unit);
    }
    for (let index = ladder.queue.length - 1; index >= 0; index -= 1) {
      if (ladder.queue[index].direction !== 'ascending') continue;
      const [evicted] = ladder.queue.splice(index, 1);
      this.unitLadderAssignment.delete(evicted.unit);
      this.returnToGround(evicted.unit);
    }
    ladder.activeDirection = null;
  }

  /** Stop ladder involvement for a unit so normal ground movement resumes next frame. */
  private returnToGround(unit: UnitEntity): void {
    unit.target = null;
    unit.attackClock = 0;
    unit.attackHitApplied = false;
    unit.state = 'idle';
  }

  /**
   * Queue a descending unit ahead of every ascender so the tower drains before it refills. The
   * flag carrier goes to the head of the queue; overflow (always ascending tail) falls back to the
   * ground instead of ever holding a descending unit back.
   */
  private insertDescending(ladder: LadderRuntime, unit: UnitEntity, carrier: boolean): void {
    let insertAt = carrier ? 0 : ladder.queue.length;
    if (!carrier) {
      for (let index = 0; index < ladder.queue.length; index += 1) {
        if (ladder.queue[index].direction === 'ascending') {
          insertAt = index;
          break;
        }
      }
    }
    ladder.queue.splice(insertAt, 0, { unit, direction: 'descending' });
    while (ladder.queue.length > CENTRAL_TOWER.maximumQueuePerLadder) {
      const evicted = ladder.queue.pop();
      if (evicted) {
        this.unitLadderAssignment.delete(evicted.unit);
        this.returnToGround(evicted.unit);
      }
    }
  }

  updateUnit(unit: UnitEntity, deltaSeconds: number): void {
    for (const ladder of this.ladderList) {
      if (ladder.active?.unit === unit) {
        this.updateActive(ladder, deltaSeconds);
        return;
      }

      const queueIndex = this.findQueuedIndex(ladder, unit);
      if (queueIndex < 0) continue;
      const entry = ladder.queue[queueIndex];
      const directionIndex = this.directionIndex(ladder.queue, queueIndex, entry.direction);
      const queueGoal = entry.direction === 'ascending'
        ? ladder.groundQueue[Math.min(directionIndex, ladder.groundQueue.length - 1)]
        : ladder.topQueue[Math.min(directionIndex, ladder.topQueue.length - 1)];
      const reached = this.moveToward(unit, queueGoal, unit.stats.speed * CENTRAL_TOWER.queueMoveScale * deltaSeconds, true);
      unit.state = 'queued';

      if (queueIndex === 0 && !ladder.active && reached) {
        ladder.queue.shift();
        ladder.active = {
          ...entry,
          pathIndex: 0,
          climbDistance: 0,
          dismountProgress: 0,
          exitClearance: 0,
          mountProgress: 0,
          speedRamp: 0,
          routePosition: unit.position.clone(),
        };
        ladder.activeDirection = entry.direction;
        if (entry.direction === 'descending') this.towerTopUnits.delete(entry.unit);
        unit.navigationArea = ladder.id === 'player' ? 'playerLadder' : 'enemyLadder';
        unit.state = 'climbing';
        unit.rig.setWeaponCarryOnBack(true);
        this.updateActive(ladder, deltaSeconds);
      }
      return;
    }
  }

  remove(unit: UnitEntity, snapActiveToSafety: boolean): void {
    const assignedId = this.unitLadderAssignment.get(unit);
    if (assignedId !== undefined) {
      const ladder = this.ladders[assignedId];
      const queuedIndex = this.findQueuedIndex(ladder, unit);
      if (queuedIndex >= 0) ladder.queue.splice(queuedIndex, 1);
      if (ladder.active?.unit === unit) {
        this.cancelActive(ladder, unit, snapActiveToSafety);
      }
      this.unitLadderAssignment.delete(unit);
    } else {
      for (const ladder of this.ladderList) {
        const queuedIndex = this.findQueuedIndex(ladder, unit);
        if (queuedIndex >= 0) ladder.queue.splice(queuedIndex, 1);
        if (ladder.active?.unit === unit) this.cancelActive(ladder, unit, snapActiveToSafety);
      }
    }
    this.towerTopUnits.delete(unit);
  }

  private createRuntime(id: LadderId): LadderRuntime {
    const config = CENTRAL_TOWER.ladders[id];
    const mount = CENTRAL_TOWER_LADDER_MOUNT[id];
    const groundEntry = point(config.groundEntry);
    const groundAlign = point(config.groundAlign);
    const climbTop = point(config.climbTop);
    const topExit = point(config.topExit);
    const groundQueue: Vector3[] = [];
    for (let index = 0; index < CENTRAL_TOWER.maximumQueuePerLadder; index += 1) {
      groundQueue.push(new Vector3(
        config.groundQueueOrigin.x + config.groundQueueStep.x * index,
        config.groundQueueOrigin.y + config.groundQueueStep.y * index,
        config.groundQueueOrigin.z + config.groundQueueStep.z * index,
      ));
    }
    const topQueue = config.topQueuePositions.map(point);

    // Hand-target geometry: identical math to createSideLadder in src/render/centralTower.ts
    // (same endpoints, same rung count formula, same standoff/rungProud/rungDepth table), so the
    // grip points land exactly on the visible wood.
    const climbX = climbTop.x - groundAlign.x;
    const climbY = climbTop.y - groundAlign.y;
    const climbZ = climbTop.z - groundAlign.z;
    const climbLength = Math.hypot(climbX, climbY, climbZ);
    const shaftDir = new Vector3(climbX / climbLength, climbY / climbLength, climbZ / climbLength);
    const midLocalX = (config.groundAlign.x + config.climbTop.x) / 2 - CENTRAL_TOWER.centerX;
    const midLocalZ = (config.groundAlign.z + config.climbTop.z) / 2 - CENTRAL_TOWER.centerZ;
    const rungDirLen = Math.hypot(midLocalX, midLocalZ);
    const rungDir = new Vector3(-midLocalZ / rungDirLen, 0, midLocalX / rungDirLen);
    const outward = new Vector3(mount.panelOutward.x, 0, mount.panelOutward.z);
    const frame = mount.ladderFrame;
    const rungCount = Math.round(climbLength / mount.rungSpacing);
    const rungFronts: Vector3[] = [];
    for (let index = 0; index < rungCount; index += 1) {
      const t = (index + 0.5) / rungCount;
      const standoff = frame.bottomStandoff + (frame.topStandoff - frame.bottomStandoff) * t;
      const frontDist = standoff + frame.rungProud + frame.rungDepth / 2;
      rungFronts.push(new Vector3(
        groundAlign.x + shaftDir.x * t * climbLength + outward.x * frontDist,
        groundAlign.y + shaftDir.y * t * climbLength,
        groundAlign.z + shaftDir.z * t * climbLength + outward.z * frontDist,
      ));
    }
    // The head rail: climbTop pushed out by the top standoff + half the rail depth, pulled down
    // the shaft by the head trim, exactly like railTops in createSideLadder.
    const railGripPoint = new Vector3(
      climbTop.x - shaftDir.x * LADDER_HEAD_TRIM + outward.x * (frame.topStandoff + LADDER_RAIL_DEPTH / 2),
      climbTop.y - shaftDir.y * LADDER_HEAD_TRIM,
      climbTop.z - shaftDir.z * LADDER_HEAD_TRIM + outward.z * (frame.topStandoff + LADDER_RAIL_DEPTH / 2),
    );
    // The unit's local +X in world XZ is (outward.z, outward.x); dot it with the rail-to-rail
    // axis so the right hand always grips the +rungDir side on BOTH mirrored ladders.
    const handSign = outward.z * rungDir.x + outward.x * rungDir.z >= 0 ? 1 : -1;

    return {
      id,
      facingYaw: mount.facingYaw,
      mount,
      ascentPath: [groundEntry, groundAlign, climbTop, topExit],
      descentPath: [topExit, climbTop, groundAlign, groundEntry],
      groundQueue,
      topQueue,
      queue: [],
      active: null,
      activeDirection: null,
      shaftDir,
      rungDir,
      outward,
      climbLength,
      rungCount,
      footPoint: groundAlign,
      rungFronts,
      railGripPoint,
      handSign,
    };
  }

  private updateActive(ladder: LadderRuntime, deltaSeconds: number): void {
    const active = ladder.active;
    if (!active) return;
    const unit = active.unit;
    const path = active.direction === 'ascending' ? ladder.ascentPath : ladder.descentPath;
    unit.state = 'climbing';
    unit.rig.root.rotation.y = this.rotateToward(unit.rig.root.rotation.y, ladder.facingYaw, deltaSeconds * 8);

    const mountData = CENTRAL_TOWER_LADDER_MOUNT[ladder.id];
    const lean = CENTRAL_TOWER.climbTorsoLean;

    let targetSpeed: number;
    if (active.direction === 'ascending') {
      if (active.pathIndex <= 0) {
        targetSpeed = CENTRAL_TOWER.mountTransitionSpeed;
      } else if (active.pathIndex === 1) {
        targetSpeed = CENTRAL_TOWER.climbUpSpeed;
      } else {
        targetSpeed = CENTRAL_TOWER.dismountTransitionSpeed;
      }
    } else {
      if (active.pathIndex <= 0) {
        targetSpeed = CENTRAL_TOWER.dismountTransitionSpeed;
      } else if (active.pathIndex === 1) {
        targetSpeed = CENTRAL_TOWER.climbDownSpeed;
      } else {
        targetSpeed = CENTRAL_TOWER.mountTransitionSpeed;
      }
    }

    const rampRate = 4.5 * deltaSeconds;
    active.speedRamp += (targetSpeed - active.speedRamp) * Math.min(1, rampRate);
    const moveStep = active.speedRamp * deltaSeconds;
    const route = active.routePosition;
    const reached = this.stepAlong(route, path[active.pathIndex], moveStep);
    this.applyLadderPlacement(ladder, active);

    const isOnMountSegment = active.pathIndex === 0;
    const isOnClimbSegment = active.pathIndex >= 1 && active.pathIndex <= 2;

    if (active.direction === 'ascending') {
      if (isOnMountSegment) {
        const segStart = path[0];
        const segEnd = path[1];
        const totalLen = Math.hypot(segEnd.x - segStart.x, segEnd.y - segStart.y, segEnd.z - segStart.z);
        const dx = route.x - segStart.x;
        const dy = route.y - segStart.y;
        const dz = route.z - segStart.z;
        const dist = Math.hypot(dx, dy, dz);
        active.mountProgress = Math.min(1, dist / Math.max(0.01, totalLen));
        unit.rig.applyMountPose(active.mountProgress, lean, unit.age, this.computeHandGrips(ladder, active), active.mountProgress);
      } else if (isOnClimbSegment) {
        const segStart = path[1];
        const dx = route.x - segStart.x;
        const dy = route.y - segStart.y;
        const dz = route.z - segStart.z;
        const distAlongClimb = Math.hypot(dx, dy, dz);
        const phase = (distAlongClimb / mountData.rungSpacing) % 1;
        unit.rig.applyClimbCycle(phase, lean, unit.age, false, this.computeHandGrips(ladder, active), 1);
      }
    } else {
      if (isOnMountSegment) {
        // Top mount: walking from the platform onto the shaft, hands blend onto the head rungs/rail.
        const segStart = path[0];
        const segEnd = path[1];
        const totalLen = Math.hypot(segEnd.x - segStart.x, segEnd.y - segStart.y, segEnd.z - segStart.z);
        const dx = route.x - segStart.x;
        const dy = route.y - segStart.y;
        const dz = route.z - segStart.z;
        const dist = Math.hypot(dx, dy, dz);
        const mountP = Math.min(1, dist / Math.max(0.01, totalLen));
        unit.rig.applyMountPose(mountP, lean, unit.age, this.computeHandGrips(ladder, active), mountP, true);
      } else if (isOnClimbSegment) {
        const segStart = path[1];
        const segEnd = path[2];
        const dx = route.x - segStart.x;
        const dy = route.y - segStart.y;
        const dz = route.z - segStart.z;
        const totalLen = Math.hypot(segEnd.x - segStart.x, segEnd.y - segStart.y, segEnd.z - segStart.z);
        const distFromTop = Math.hypot(dx, dy, dz);
        const remaining = Math.max(0, totalLen - distFromTop);
        const phase = (remaining / mountData.rungSpacing) % 1;
        unit.rig.applyClimbCycle(phase, lean, unit.age, true, this.computeHandGrips(ladder, active), 1);
      } else if (active.pathIndex >= 2) {
        const segStart = path[2];
        const segEnd = path[3];
        const totalLen = Math.hypot(segEnd.x - segStart.x, segEnd.y - segStart.y, segEnd.z - segStart.z);
        const dx = route.x - segStart.x;
        const dy = route.y - segStart.y;
        const dz = route.z - segStart.z;
        const dist = Math.hypot(dx, dy, dz);
        const dismountP = Math.min(1, dist / Math.max(0.01, totalLen));
        unit.rig.applyTopDismount(dismountP, unit.age, this.computeHandGrips(ladder, active), 1 - dismountP, true);
      }
    }

    if (!reached) return;
    active.pathIndex += 1;
    if (active.pathIndex < path.length) return;

    if (active.direction === 'ascending') {
      active.dismountProgress += deltaSeconds * 1.4;
      if (active.dismountProgress < 1) {
        unit.rig.applyTopDismount(active.dismountProgress, unit.age, this.computeHandGrips(ladder, active), 1 - active.dismountProgress);
        active.pathIndex = path.length - 1;
        return;
      }
      unit.rig.clearInteractionPose();
      unit.rig.setWeaponCarryOnBack(false);
      unit.navigationArea = 'towerTop';
      unit.state = 'idle';
      unit.target = null;
      unit.targetRefreshClock = 0.04;
      this.towerTopUnits.add(unit);
      this.unitLadderAssignment.delete(unit);
      ladder.active = null;
      ladder.activeDirection = null;
    } else {
      active.exitClearance += deltaSeconds;
      if (active.exitClearance < EXIT_CLEARANCE_SECONDS) {
        active.pathIndex = path.length - 1;
        return;
      }
      unit.rig.clearInteractionPose();
      unit.rig.setWeaponCarryOnBack(false);
      unit.navigationArea = 'ground';
      unit.state = 'idle';
      unit.target = null;
      unit.targetRefreshClock = 0.04;
      this.unitLadderAssignment.delete(unit);
      ladder.active = null;
      ladder.activeDirection = null;
    }
  }

  /**
   * Attach the climbing body to the ladder's real front face.
   *
   * The route stays on the authored centreline; the visible body is then offset along the ladder's
   * own horizontal outward normal by the same frame the mesh was built from: the standoff that
   * pushes the whole frame out from the centreline, the rung proud and half-depth that place the
   * rung FRONT face, and the body offset that puts the root (pelvis) just clear of that face with
   * the chest against the rungs. The offset fades in while mounting at the foot, is full over the
   * whole shaft, and fades out while stepping onto the platform at the head, so the root is always
   * ON the ladder plane — never under, behind or beside the mesh. The route position is fully
   * overwritten each frame, so steering, separation or residual ground velocity cannot pull the
   * body off the ladder.
   */
  private applyLadderPlacement(ladder: LadderRuntime, active: ActiveClimb): void {
    const unit = active.unit;
    const route = active.routePosition;
    const path = active.direction === 'ascending' ? ladder.ascentPath : ladder.descentPath;
    const index = active.pathIndex;
    if (index === 0) {
      unit.position.copyFrom(route);
      return;
    }
    const mount = ladder.mount;
    const frame = mount.ladderFrame;
    const segStart = path[index - 1];
    const segEnd = path[index];
    const segX = segEnd.x - segStart.x;
    const segY = segEnd.y - segStart.y;
    const segZ = segEnd.z - segStart.z;
    const progress = Math.min(1, Math.max(0, (
      (route.x - segStart.x) * segX
      + (route.y - segStart.y) * segY
      + (route.z - segStart.z) * segZ
    ) / Math.max(0.0001, segX * segX + segY * segY + segZ * segZ)));
    const rungFrontAt = (t: number): number => (
      frame.bottomStandoff + (frame.topStandoff - frame.bottomStandoff) * t
      + frame.rungProud + frame.rungDepth / 2
      + mount.bodyOffsetFromLadder
    );
    const footOffset = rungFrontAt(0);
    const headOffset = rungFrontAt(1);
    const offset = active.direction === 'ascending'
      ? index === 1 ? footOffset * progress
        : index === 2 ? rungFrontAt(progress)
        : headOffset * (1 - progress)
      : index === 1 ? headOffset * progress
        : index === 2 ? rungFrontAt(1 - progress)
        : footOffset * (1 - progress);
    unit.position.x = route.x + mount.panelOutward.x * offset;
    unit.position.y = route.y;
    unit.position.z = route.z + mount.panelOutward.z * offset;
  }

  /** Move a free route point toward a target along the ladder path (the body is attached later). */
  private stepAlong(route: Vector3, target: Vector3, maxDistance: number): boolean {
    const dx = target.x - route.x;
    const dy = target.y - route.y;
    const dz = target.z - route.z;
    const distance = Math.hypot(dx, dy, dz);
    if (distance <= Math.max(CENTRAL_TOWER.queueArrivalRadius, maxDistance)) {
      route.copyFrom(target);
      return true;
    }
    const scale = maxDistance / Math.max(0.0001, distance);
    route.x += dx * scale;
    route.y += dy * scale;
    route.z += dz * scale;
    return false;
  }

  private moveToward(unit: UnitEntity, target: Vector3, maxDistance: number, faceMovement: boolean): boolean {
    const dx = target.x - unit.position.x;
    const dy = target.y - unit.position.y;
    const dz = target.z - unit.position.z;
    const distance = Math.hypot(dx, dy, dz);
    if (distance <= Math.max(CENTRAL_TOWER.queueArrivalRadius, maxDistance)) {
      unit.position.copyFrom(target);
      return true;
    }
    const scale = maxDistance / Math.max(0.0001, distance);
    unit.position.x += dx * scale;
    unit.position.y += dy * scale;
    unit.position.z += dz * scale;
    if (faceMovement && Math.abs(dx) + Math.abs(dz) > 0.001) {
      const yaw = Math.atan2(dx, dz);
      unit.rig.root.rotation.y = this.rotateToward(unit.rig.root.rotation.y, yaw, maxDistance * 2.8);
    }
    return false;
  }

  /**
   * World-space grips for both hands, derived from the body's progress along the shaft and the
   * REAL rung/rail positions cached on the runtime.
   *
   * The body's distance from the shaft foot maps to a stable rung cell (floor(d / rungSpacing)),
   * the same spacing the mesh used when it laid the rungs. The lower hand always grips rung
   * cell+3, the upper hand cell+4 — chest-height grips that move up one rung per cell. Inside
   * each cell exactly one hand reaches while the other stays planted, then the roles swap; the
   * transit order alternates by cell parity so the hands take turns leading. On descent the LOWER
   * hand always reaches first (down to the next rung), so the upper hand only releases once the
   * lower grip is established. Both hands always hold a rung or the head rail — never float.
   */
  private computeHandGrips(ladder: LadderRuntime, active: ActiveClimb): ClimbGripPair {
    const ascending = active.direction === 'ascending';
    const index = active.pathIndex;
    const climbLength = ladder.climbLength;
    let distance: number;
    if (index === 0) {
      // Mounting: ascent at the foot, descent at the head.
      distance = ascending ? 0 : climbLength;
    } else if (index >= 2) {
      // Dismounting: ascent at the head, descent at the foot.
      distance = ascending ? climbLength : 0;
    } else {
      const route = active.routePosition;
      const along = (route.x - ladder.footPoint.x) * ladder.shaftDir.x
        + (route.y - ladder.footPoint.y) * ladder.shaftDir.y
        + (route.z - ladder.footPoint.z) * ladder.shaftDir.z;
      distance = along < 0 ? 0 : along > climbLength ? climbLength : along;
    }

    const spacing = ladder.mount.rungSpacing;
    const cellFloat = distance / spacing;
    let cell = Math.floor(cellFloat);
    const frac = cellFloat - cell;
    if (cell < 0) cell = 0;
    else if (cell > ladder.rungCount - 1) cell = ladder.rungCount - 1;
    const even = (cell & 1) === 0;

    const first = this.handTransit((frac - CLIMB_FIRST_MOVE_START) / CLIMB_FIRST_MOVE_SPAN);
    const second = this.handTransit((frac - CLIMB_SECOND_MOVE_START) / CLIMB_SECOND_MOVE_SPAN);

    // Ascending: the UPPER hand reaches first on even cells, the lower first on odd cells.
    // Descending: the LOWER hand reaches first on even cells, the upper first on odd cells.
    // Either way the lower hand grips cell+3 and the upper hand cell+4 at every cell start, and
    // both hands advance one rung per cell — hands pass on the same rung like a real climb.
    const rightFirst = ascending === even;
    const rightTransit = rightFirst ? first : second;
    const leftTransit = rightFirst ? second : first;
    const lo = cell + CLIMB_HAND_RUNG_OFFSET;
    const hi = cell + CLIMB_HAND_RUNG_OFFSET + 1;
    const sign = ladder.handSign;
    const rungDir = ladder.rungDir;

    this.fillGripTarget(ladder, leftTransit, lo, ascending ? lo + 1 : lo - 1, -sign, this.gripScratch.left.position);
    this.fillGripTarget(ladder, rightTransit, hi, ascending ? hi + 1 : hi - 1, sign, this.gripScratch.right.position);
    this.gripScratch.left.lateral.set(-rungDir.x * sign, 0, -rungDir.z * sign);
    this.gripScratch.right.lateral.set(rungDir.x * sign, 0, rungDir.z * sign);
    return {
      left: {
        position: this.gripScratch.left.position,
        normal: ladder.outward,
        lateral: this.gripScratch.left.lateral,
      },
      right: {
        position: this.gripScratch.right.position,
        normal: ladder.outward,
        lateral: this.gripScratch.right.lateral,
      },
    };
  }

  /**
   * Interpolate one hand's grip from its current rung to the next over the transit progress. The
   * from/to indices may point past the top rung: that grip becomes the head RAIL (a real visible
   * bar), so the last reach of an ascent lands on the rail instead of thin air. The palm point
   * rides the rung/rail front face, plus a small outward reach hump while the hand is in motion.
   */
  private fillGripTarget(
    ladder: LadderRuntime,
    transit: number,
    from: number,
    to: number,
    lateralSign: number,
    out: Vector3,
  ): void {
    const fromRail = from >= ladder.rungCount;
    const toRail = to >= ladder.rungCount;
    const p0 = fromRail ? ladder.railGripPoint : ladder.rungFronts[from];
    const p1 = toRail ? ladder.railGripPoint : ladder.rungFronts[to];
    const lateral0 = fromRail ? LADDER_RAIL_HALF_SPAN : CLIMB_HAND_LATERAL;
    const lateral1 = toRail ? LADDER_RAIL_HALF_SPAN : CLIMB_HAND_LATERAL;
    const reach = Math.sin(transit * Math.PI) * CLIMB_HAND_REACH_BOOST;
    const lateral = (lateral0 + (lateral1 - lateral0) * transit) * lateralSign;
    out.x = p0.x + (p1.x - p0.x) * transit + ladder.rungDir.x * lateral + ladder.outward.x * reach;
    out.y = p0.y + (p1.y - p0.y) * transit;
    out.z = p0.z + (p1.z - p0.z) * transit + ladder.rungDir.z * lateral + ladder.outward.z * reach;
  }

  private handTransit(progress: number): number {
    const x = progress <= 0 ? 0 : progress >= 1 ? 1 : progress;
    return x <= 0 ? 0 : x >= 1 ? 1 : x < 0.5 ? 2 * x * x : 1 - (-2 * x + 2) ** 2 / 2;
  }

  private cancelActive(ladder: LadderRuntime, unit: UnitEntity, snapToSafety: boolean): void {
    if (snapToSafety) unit.position.copyFrom(ladder.ascentPath[0]);
    unit.navigationArea = 'ground';
    ladder.active = null;
    ladder.activeDirection = null;
    unit.rig.setWeaponCarryOnBack(false);
  }

  private directionIndex(queue: readonly QueueEntry[], targetIndex: number, direction: ClimbDirection): number {
    let result = 0;
    for (let index = 0; index < targetIndex; index += 1) {
      if (queue[index].direction === direction) result += 1;
    }
    return result;
  }

  private preferredLadder(team: Team): LadderId {
    return team === 'blue' ? 'player' : 'enemy';
  }

  private findQueuedIndex(ladder: LadderRuntime, unit: UnitEntity): number {
    for (let index = 0; index < ladder.queue.length; index += 1) {
      if (ladder.queue[index].unit === unit) return index;
    }
    return -1;
  }

  private rotateToward(current: number, desired: number, amount: number): number {
    let difference = desired - current;
    while (difference > Math.PI) difference -= Math.PI * 2;
    while (difference < -Math.PI) difference += Math.PI * 2;
    return current + difference * Math.min(1, amount);
  }
}
