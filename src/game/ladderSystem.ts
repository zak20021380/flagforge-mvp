import { Vector3 } from '@babylonjs/core';
import { CENTRAL_TOWER, CENTRAL_TOWER_LADDER_MOUNT } from '../core/config';
import type { Team } from '../core/types';
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
}

interface LadderRuntime {
  readonly id: LadderId;
  readonly facingYaw: number;
  readonly ascentPath: readonly Vector3[];
  readonly descentPath: readonly Vector3[];
  readonly groundQueue: readonly Vector3[];
  readonly topQueue: readonly Vector3[];
  readonly queue: QueueEntry[];
  active: ActiveClimb | null;
  activeDirection: ClimbDirection | null;
}

const point = (value: { readonly x: number; readonly y: number; readonly z: number }): Vector3 => (
  new Vector3(value.x, value.y, value.z)
);

const EXIT_CLEARANCE_SECONDS = 0.35;

export class LadderSystem {
  private readonly ladders: Record<LadderId, LadderRuntime>;
  private readonly ladderList: readonly LadderRuntime[];
  private readonly towerTopUnits = new Set<UnitEntity>();
  private readonly unitLadderAssignment = new Map<UnitEntity, LadderId>();

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
        ladder.active = { ...entry, pathIndex: 0, climbDistance: 0, dismountProgress: 0, exitClearance: 0, mountProgress: 0, speedRamp: 0 };
        ladder.activeDirection = entry.direction;
        if (entry.direction === 'descending') this.towerTopUnits.delete(entry.unit);
        unit.navigationArea = ladder.id === 'player' ? 'playerLadder' : 'enemyLadder';
        unit.state = 'climbing';
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
    return {
      id,
      facingYaw: config.facingYaw,
      ascentPath: [groundEntry, groundAlign, climbTop, topExit],
      descentPath: [topExit, climbTop, groundAlign, groundEntry],
      groundQueue,
      topQueue,
      queue: [],
      active: null,
      activeDirection: null,
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
    const reached = this.moveToward(unit, path[active.pathIndex], moveStep, false);

    const isOnMountSegment = active.pathIndex === 0;
    const isOnClimbSegment = active.pathIndex >= 1 && active.pathIndex <= 2;

    if (active.direction === 'ascending') {
      if (isOnMountSegment) {
        const segStart = path[0];
        const segEnd = path[1];
        const totalLen = Math.hypot(segEnd.x - segStart.x, segEnd.y - segStart.y, segEnd.z - segStart.z);
        const dx = unit.position.x - segStart.x;
        const dy = unit.position.y - segStart.y;
        const dz = unit.position.z - segStart.z;
        const dist = Math.hypot(dx, dy, dz);
        active.mountProgress = Math.min(1, dist / Math.max(0.01, totalLen));
        unit.rig.applyMountPose(active.mountProgress, lean, unit.age);
      } else if (isOnClimbSegment) {
        const segStart = path[1];
        const dx = unit.position.x - segStart.x;
        const dy = unit.position.y - segStart.y;
        const dz = unit.position.z - segStart.z;
        const distAlongClimb = Math.hypot(dx, dy, dz);
        const phase = (distAlongClimb / mountData.rungSpacing) % 1;
        unit.rig.applyClimbCycle(phase, lean, unit.age);
      }
    } else {
      if (isOnClimbSegment) {
        const segStart = path[1];
        const segEnd = path[2];
        const dx = unit.position.x - segStart.x;
        const dy = unit.position.y - segStart.y;
        const dz = unit.position.z - segStart.z;
        const totalLen = Math.hypot(segEnd.x - segStart.x, segEnd.y - segStart.y, segEnd.z - segStart.z);
        const distFromTop = Math.hypot(dx, dy, dz);
        const remaining = Math.max(0, totalLen - distFromTop);
        const phase = (remaining / mountData.rungSpacing) % 1;
        unit.rig.applyClimbCycle(phase, lean, unit.age);
      } else if (active.pathIndex >= 2) {
        const segStart = path[2];
        const segEnd = path[3];
        const totalLen = Math.hypot(segEnd.x - segStart.x, segEnd.y - segStart.y, segEnd.z - segStart.z);
        const dx = unit.position.x - segStart.x;
        const dy = unit.position.y - segStart.y;
        const dz = unit.position.z - segStart.z;
        const dist = Math.hypot(dx, dy, dz);
        const dismountP = Math.min(1, dist / Math.max(0.01, totalLen));
        unit.rig.applyTopDismount(dismountP, unit.age);
      }
    }

    if (!reached) return;
    active.pathIndex += 1;
    if (active.pathIndex < path.length) return;

    if (active.direction === 'ascending') {
      active.dismountProgress += deltaSeconds * 1.4;
      if (active.dismountProgress < 1) {
        unit.rig.applyTopDismount(active.dismountProgress, unit.age);
        active.pathIndex = path.length - 1;
        return;
      }
      unit.rig.clearInteractionPose();
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
      unit.navigationArea = 'ground';
      unit.state = 'idle';
      unit.target = null;
      unit.targetRefreshClock = 0.04;
      this.unitLadderAssignment.delete(unit);
      ladder.active = null;
      ladder.activeDirection = null;
    }
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

  private cancelActive(ladder: LadderRuntime, unit: UnitEntity, snapToSafety: boolean): void {
    if (snapToSafety) unit.position.copyFrom(ladder.ascentPath[0]);
    unit.navigationArea = 'ground';
    ladder.active = null;
    ladder.activeDirection = null;
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
