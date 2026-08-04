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
}

const point = (value: { readonly x: number; readonly y: number; readonly z: number }): Vector3 => (
  new Vector3(value.x, value.y, value.z)
);

export class LadderSystem {
  private readonly ladders: Record<LadderId, LadderRuntime>;
  private readonly ladderList: readonly LadderRuntime[];
  /** Units standing on the tower top, tracked so the shared occupancy cap stays exact. */
  private readonly towerTopUnits = new Set<UnitEntity>();

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
        if (!unit.active || unit.state === 'dead') ladder.queue.splice(index, 1);
      }
      if (ladder.active && (!ladder.active.unit.active || ladder.active.unit.state === 'dead')) {
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
    for (const ladder of this.ladderList) {
      if (ladder.active?.unit === unit) return true;
      for (const entry of ladder.queue) {
        if (entry.unit === unit) return true;
      }
    }
    return false;
  }

  requestIfNeeded(unit: UnitEntity, goal: Vector3): boolean {
    if (this.isRegistered(unit)) return true;
    const goalIsTop = goal.y >= CENTRAL_TOWER.topSurfaceY - 0.6;
    const unitIsTop = unit.navigationArea === 'towerTop';
    if (goalIsTop === unitIsTop) return false;
    if (unit.navigationArea !== 'ground' && unit.navigationArea !== 'towerTop') return true;

    const ladder = this.ladders[this.preferredLadder(unit.team)];
    // Queueing walks a straight line to the tower base, so a unit with a river still in front of it
    // keeps normal movement and queues after it has crossed a bridge. Descents are never held back:
    // the tower top is on no river's bank, and gating it would strand units up there.
    if (!unitIsTop && blocksApproach(unit, ladder.groundQueue[0].z)) return false;

    if (unitIsTop) {
      // A unit already on the tower may always descend: it leaves the tower and frees a slot.
      if (unit.carryingFlag) {
        // The flag carrier owns its ladder while on the tower: every queued or mid-climb ascender
        // falls back to the ground and the carrier takes the head of the queue, so nothing blocks
        // its exit and it starts the return run immediately.
        this.cedeLadderToCarrier(ladder);
        this.insertDescending(ladder, unit, true);
      } else {
        this.insertDescending(ladder, unit, false);
      }
    } else {
      // The tower is reserved for exactly maximumTowerOccupancy units at any time (occupants plus
      // committed ascenders, both teams combined). Everyone else stays on the ground around the
      // tower and holds a reserved standoff position instead of queueing at the ladders.
      if (this.towerOccupancy() + this.pendingAscenders() >= CENTRAL_TOWER.maximumTowerOccupancy) return false;
      if (ladder.queue.length >= CENTRAL_TOWER.maximumQueuePerLadder) return false;
      ladder.queue.push({ unit, direction: 'ascending' });
    }
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
      this.cancelActive(ladder, active.unit, true);
      this.returnToGround(active.unit);
    }
    for (let index = ladder.queue.length - 1; index >= 0; index -= 1) {
      if (ladder.queue[index].direction !== 'ascending') continue;
      const [evicted] = ladder.queue.splice(index, 1);
      this.returnToGround(evicted.unit);
    }
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
      if (evicted) this.returnToGround(evicted.unit);
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
        ladder.active = { ...entry, pathIndex: 0, climbDistance: 0, dismountProgress: 0 };
        if (entry.direction === 'descending') this.towerTopUnits.delete(entry.unit);
        unit.navigationArea = ladder.id === 'player' ? 'playerLadder' : 'enemyLadder';
        unit.state = 'climbing';
        this.updateActive(ladder, deltaSeconds);
      }
      return;
    }
  }

  remove(unit: UnitEntity, snapActiveToSafety: boolean): void {
    for (const ladder of this.ladderList) {
      const queuedIndex = this.findQueuedIndex(ladder, unit);
      if (queuedIndex >= 0) ladder.queue.splice(queuedIndex, 1);
      if (ladder.active?.unit === unit) this.cancelActive(ladder, unit, snapActiveToSafety);
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
    };
  }

  private updateActive(ladder: LadderRuntime, deltaSeconds: number): void {
    const active = ladder.active;
    if (!active) return;
    const unit = active.unit;
    const path = active.direction === 'ascending' ? ladder.ascentPath : ladder.descentPath;
    unit.state = 'climbing';
    unit.rig.root.rotation.y = this.rotateToward(unit.rig.root.rotation.y, ladder.facingYaw, deltaSeconds * 11);

    const mountData = CENTRAL_TOWER_LADDER_MOUNT[ladder.id];
    const moveStep = CENTRAL_TOWER.climbSpeed * deltaSeconds;
    const reached = this.moveToward(unit, path[active.pathIndex], moveStep, false);

    if (active.direction === 'ascending') {
      const climbSegmentStart = path[1];
      const climbSegmentEnd = path[2];
      const dx = unit.position.x - climbSegmentStart.x;
      const dy = unit.position.y - climbSegmentStart.y;
      const dz = unit.position.z - climbSegmentStart.z;
      const distAlongClimb = Math.hypot(dx, dy, dz);
      const totalClimbLen = Math.hypot(
        climbSegmentEnd.x - climbSegmentStart.x,
        climbSegmentEnd.y - climbSegmentStart.y,
        climbSegmentEnd.z - climbSegmentStart.z,
      );
      const phase = (distAlongClimb / mountData.rungSpacing) % 1;
      const isOnClimbSegment = active.pathIndex >= 1 && active.pathIndex <= 2;
      if (isOnClimbSegment) {
        unit.rig.applyClimbCycle(phase, 0.19, unit.age);
      }
    } else {
      unit.rig.clearInteractionPose();
    }

    if (!reached) return;
    active.pathIndex += 1;
    if (active.pathIndex < path.length) return;

    if (active.direction === 'ascending') {
      active.dismountProgress += deltaSeconds * 1.8;
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
      ladder.active = null;
    } else {
      unit.rig.clearInteractionPose();
      unit.navigationArea = 'ground';
      unit.state = 'idle';
      unit.target = null;
      unit.targetRefreshClock = 0.04;
      ladder.active = null;
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
