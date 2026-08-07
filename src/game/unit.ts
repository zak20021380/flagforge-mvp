import { Vector3 } from '@babylonjs/core';
import { CONFIG, UNIT_STATS } from '../core/config';
import type { BridgeState, Lane, NavigationArea, RecoveryState, Team, UnitKind, UnitState } from '../core/types';
import { UnitRig } from '../render/unitRig';
import type { RiverRoute } from './riverCrossing';
import type { BridgeQueue } from './bridgeTraffic';

export class UnitEntity {
  readonly stats;
  /** Half the space this body claims in the separation pass; also its footprint against the water. */
  readonly bodyRadius: number;
  /** Comfortable personal-space radius used by the separation pass (body radius + slack, scales
   *  with unit size so large units reserve slightly more room than small ones). */
  readonly separationRadius: number;
  active = false;
  health = 1;
  state: UnitState = 'idle';
  navigationArea: NavigationArea = 'ground';
  lane: Lane = 'center';
  target: UnitEntity | null = null;
  lastAttacker: UnitEntity | null = null;
  carryingFlag = false;
  attackClock = 0;
  attackHitApplied = false;
  hitClock = 0;
  deathClock = 0;
  targetRefreshClock = 0;
  age = 0;
  /** Cached bridge crossing plan while a river separates this unit from its goal. */
  riverRoute: RiverRoute | null = null;
  /** Bridge traffic state: none | approaching | queued | entering | crossing | exiting | cleared. */
  bridgeState: BridgeState = 'none';
  /** The bridge queue this unit is committed to, when registered with the traffic system. */
  bridgeQueue: BridgeQueue | null = null;
  /** Seconds without meaningful positional progress toward the current movement goal. */
  noProgressClock = 0;
  /** XZ anchor the last meaningful movement was measured against. */
  progressAnchorX = 0;
  progressAnchorZ = 0;
  /** True once the progress anchor is initialized. */
  hasProgressAnchor = false;
  /** Active one-shot recovery manoeuvre: none | lateral | yield | wait. */
  recoveryState: RecoveryState = 'none';
  /** Remaining seconds of the active recovery manoeuvre. */
  recoveryClock = 0;
  /** Cooldown so a unit cannot oscillate or re-recover every frame. */
  recoveryCooldown = 0;
  /** Rotating index into the deterministic recovery-action list. */
  recoveryPick = 0;
  /** Absolute XZ point the active recovery manoeuvre walks to. */
  recoveryGoalX = 0;
  recoveryGoalZ = 0;
  /** Throttled crowd-probe timer (staggered by unit id). */
  crowdClock = 0;
  /** Cached result of the crowd probe: this unit takes an engagement offset. */
  crowdEngaged = false;
  /** Index of the reserved tower standoff slot this unit holds, or -1. */
  reservedSlot = -1;
  /** Rotation offset for slot reacquisition after a stale-reservation release. */
  acquireBias = 0;
  /** Seconds NYX has spent backing out of a point-blank body contact; caps the kiting budget. */
  pointBlankClock = 0;

  constructor(
    readonly id: number,
    readonly team: Team,
    readonly kind: UnitKind,
    readonly rig: UnitRig,
  ) {
    this.stats = UNIT_STATS[kind];
    this.bodyRadius = CONFIG.unit.separationRadius * 0.5 * this.stats.scale;
    this.separationRadius = this.bodyRadius * CONFIG.unit.separationPadding;
  }

  get position(): Vector3 {
    return this.rig.root.position;
  }

  spawn(position: Vector3, lane: Lane): void {
    this.active = true;
    this.health = this.stats.maxHealth;
    this.state = 'idle';
    this.navigationArea = 'ground';
    this.lane = lane;
    this.target = null;
    this.lastAttacker = null;
    this.carryingFlag = false;
    this.attackClock = 0;
    this.attackHitApplied = false;
    this.hitClock = 0;
    this.deathClock = 0;
    this.targetRefreshClock = Math.random() * 0.16;
    this.age = 0;
    this.riverRoute = null;
    this.bridgeState = 'none';
    this.bridgeQueue = null;
    this.noProgressClock = 0;
    this.progressAnchorX = position.x;
    this.progressAnchorZ = position.z;
    this.hasProgressAnchor = true;
    this.recoveryState = 'none';
    this.recoveryClock = 0;
    this.recoveryCooldown = 0;
    this.recoveryPick = 0;
    this.recoveryGoalX = 0;
    this.recoveryGoalZ = 0;
    this.crowdClock = 0.18 + (this.id % 7) * 0.04;
    this.crowdEngaged = false;
    this.reservedSlot = -1;
    this.acquireBias = 0;
    this.pointBlankClock = 0;
    this.rig.root.position.copyFrom(position);
    this.rig.root.rotation.set(0, this.team === 'blue' ? 0 : Math.PI, 0);
    this.rig.resetVisual();
    this.rig.setEnabled(true);
  }

  deactivate(): void {
    this.active = false;
    this.target = null;
    this.lastAttacker = null;
    this.carryingFlag = false;
    this.navigationArea = 'ground';
    this.riverRoute = null;
    this.bridgeState = 'none';
    this.bridgeQueue = null;
    this.noProgressClock = 0;
    this.hasProgressAnchor = false;
    this.recoveryState = 'none';
    this.recoveryClock = 0;
    this.recoveryCooldown = 0;
    this.recoveryGoalX = 0;
    this.recoveryGoalZ = 0;
    this.crowdEngaged = false;
    this.reservedSlot = -1;
    this.pointBlankClock = 0;
    this.rig.setEnabled(false);
  }
}
