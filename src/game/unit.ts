import { Vector3 } from '@babylonjs/core';
import { CONFIG, UNIT_STATS } from '../core/config';
import type { BridgeState, Lane, NavigationArea, Team, UnitKind, UnitState } from '../core/types';
import { UnitRig } from '../render/unitRig';
import type { RiverRoute } from './riverCrossing';
import type { BridgeQueue } from './bridgeTraffic';

export class UnitEntity {
  readonly stats;
  /** Half the space this body claims in the separation pass; also its footprint against the water. */
  readonly bodyRadius: number;
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

  constructor(
    readonly id: number,
    readonly team: Team,
    readonly kind: UnitKind,
    readonly rig: UnitRig,
  ) {
    this.stats = UNIT_STATS[kind];
    this.bodyRadius = CONFIG.unit.separationRadius * 0.5 * this.stats.scale;
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
    this.rig.setEnabled(false);
  }
}
