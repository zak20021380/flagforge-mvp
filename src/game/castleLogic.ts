import { Vector3 } from '@babylonjs/core';
import { CONFIG } from '../core/config';
import { oppositeTeam } from '../core/math';
import type { Team } from '../core/types';
import type { CastleVisual } from '../render/castle';
import { CastleHealthModel } from './castleHealth';
import type { FlagController } from './flag';
import type { UnitEntity } from './unit';

interface GateReturnState {
  open: boolean;
  closeTimer: number;
  openRemaining: number;
  prevApproachDistance: number;
}

export class CastleLogic {
  private readonly attackWindow: Record<Team, number> = { blue: 0, red: 0 };
  private breachedTeam: Team | null = null;
  private breachTimer = 0;
  private winner: Team | null = null;
  private assaultActive: Record<Team, boolean> = { blue: false, red: false };
  private readonly gateReturn: Record<Team, GateReturnState> = {
    blue: { open: false, closeTimer: -1, openRemaining: 0, prevApproachDistance: -1 },
    red: { open: false, closeTimer: -1, openRemaining: 0, prevApproachDistance: -1 },
  };
  readonly blueHealth: CastleHealthModel;
  readonly redHealth: CastleHealthModel;
  private destructionPending: Team | null = null;
  private destructionComplete = false;

  constructor(
    private readonly blueCastle: CastleVisual,
    private readonly redCastle: CastleVisual,
    private readonly flag: FlagController,
    private readonly onGateOpened: (castleTeam: Team) => void,
    private readonly onBreach: (attacker: Team, defender: Team) => void,
    private readonly onVictory: (winner: Team) => void,
  ) {
    this.blueHealth = new CastleHealthModel();
    this.redHealth = new CastleHealthModel();
  }

  /**
   * Single shared gate condition, based only on the authoritative flag carrier and flag state. It
   * decides whether THIS castle's gate may open, and it is evaluated fresh every frame so nothing
   * (a timer, a flag phase, a distant carrier, or a nearby enemy) can latch a gate open early.
   *
   * The gate opens only when every condition is true at once:
   *  - the carrier belongs to that castle's team,
   *  - the carrier currently possesses the flag (carried status),
   *  - the carrier is alive and valid,
   *  - the carrier is heading for its own castle (return mode is implied: a carrying unit's only
   *    goal is its own castle's delivery point),
   *  - the carrier has entered the small proximity trigger directly in front of the gate and is
   *    actively approaching it (or is already standing at the door).
   */
  private shouldOpenGateForReturn(team: Team): boolean {
    const carrier = this.flag.currentCarrier;
    const state = this.gateReturn[team];
    if (!carrier || !carrier.active || carrier.state === 'dead') {
      state.prevApproachDistance = -1;
      return false;
    }
    if (carrier.team !== team) {
      state.prevApproachDistance = -1;
      return false;
    }
    // "Returning toward its own castle": a carrying unit's only strategic goal is its own castle's
    // delivery point, so possession plus the owned-team check means the return is in progress.
    if (!carrier.carryingFlag || this.flag.currentStatus !== 'carried') {
      state.prevApproachDistance = -1;
      return false;
    }

    const gate = this.getCastle(team).gatePoint;
    const distance = Math.hypot(carrier.position.x - gate.x, carrier.position.z - gate.z);
    const insideTrigger = distance <= CONFIG.match.flagReturnGateTriggerRadius;
    if (!insideTrigger) {
      // Record where the carrier currently is so the first frame that enters the trigger can tell
      // whether it is genuinely approaching.
      state.prevApproachDistance = distance;
      return false;
    }
    const atTheDoor = distance <= CONFIG.match.flagReturnGateDoorReach;
    const approaching = state.prevApproachDistance < 0
      || distance <= state.prevApproachDistance + 0.12;
    state.prevApproachDistance = distance;
    return atTheDoor || approaching;
  }

  /**
   * Grants the post-delivery assault window used by unit routing and infiltration. Purely
   * behavioural: it never opens a gate. Castle gates are driven exclusively by the shared
   * carrier-return condition in updateGateReturn.
   */
  grantAssaultWindow(attacker: Team): void {
    if (this.winner || this.destructionComplete) return;
    this.attackWindow[attacker] = CONFIG.match.gateOpenSeconds;
    this.assaultActive[attacker] = true;
  }

  isAssaultActive(team: Team): boolean {
    return this.assaultActive[team];
  }

  getHealth(team: Team): CastleHealthModel {
    return team === 'blue' ? this.blueHealth : this.redHealth;
  }

  applyCastleDamage(defender: Team, amount: number, hitPoint: Vector3, strong: boolean): void {
    if (this.winner || this.destructionComplete) return;
    const health = this.getHealth(defender);
    if (health.destroyed) return;
    health.applyDamage(amount, hitPoint.x, hitPoint.y, hitPoint.z, strong);
    if (health.hp <= 0 && !health.destroyed) {
      health.triggerDestruction();
      this.destructionPending = defender;
    }
  }

  getAssaultSlot(unit: UnitEntity): Vector3 {
    const enemy = unit.team === 'blue' ? 'red' : 'blue';
    const castle = this.getCastle(enemy);
    const slots = CONFIG.castle.assaultSlots;
    const slotIndex = unit.id % slots.length;
    const slot = slots[slotIndex];
    return new Vector3(
      castle.root.position.x + slot.x,
      0.16,
      castle.gatePoint.z + slot.z * (unit.team === 'blue' ? -1 : 1),
    );
  }

  isAttackWindow(team: Team): boolean {
    return this.attackWindow[team] > 0 || this.breachedTeam === oppositeTeam(team);
  }

  getAttackWindowRemaining(team: Team): number {
    return this.attackWindow[team];
  }

  /** True while THIS castle's gate is physically open (flag-return, or its breach state). */
  isGateOpen(team: Team): boolean {
    return this.gateReturn[team].open || this.breachedTeam === team;
  }

  /** Seconds the HUD should show while a gate is open: breach countdown, else the return hold. */
  getGateOpenRemaining(team: Team): number {
    if (this.breachedTeam === team) return this.breachTimer;
    return this.gateReturn[team].openRemaining;
  }

  isDeploymentLocked(team: Team): boolean {
    return this.breachedTeam === team;
  }

  getBreachedTeam(): Team | null {
    return this.breachedTeam;
  }

  getBreachCountdown(): number {
    return this.breachedTeam ? Math.max(0, this.breachTimer) : 0;
  }

  getWinner(): Team | null {
    return this.winner;
  }

  getCastle(team: Team): CastleVisual {
    return team === 'blue' ? this.blueCastle : this.redCastle;
  }

  tryInfiltrate(unit: UnitEntity): boolean {
    if (unit.navigationArea !== 'ground' || this.breachedTeam || this.winner || !this.isAttackWindow(unit.team)) return false;
    const defender = oppositeTeam(unit.team);
    const interior = this.getCastle(defender).interiorPoint;
    const insideX = Math.abs(unit.position.x - interior.x) <= 3.1;
    const insideZ = unit.team === 'blue'
      ? unit.position.z >= interior.z
      : unit.position.z <= interior.z;
    if (!insideX || !insideZ) return false;

    this.breachedTeam = defender;
    this.breachTimer = CONFIG.match.breachCountdownSeconds;
    this.attackWindow[unit.team] = Math.max(this.attackWindow[unit.team], this.breachTimer + 1);
    const castle = this.getCastle(defender);
    // Breach state is permanent and wins over the return-gate logic: the castle stays open so the
    // countdown reads as a broken fortress, and updateGateReturn never closes it.
    castle.setGateOpen(true);
    castle.setBreached(true);
    this.onBreach(unit.team, defender);
    return true;
  }

  /**
   * Flags each castle's gate every frame straight from the shared carrier/flag condition. A gate
   * stays shut while no valid return is happening; it opens only as the own carrier arrives at the
   * trigger in front of it, and closes again shortly after the flag is delivered (or immediately if
   * the carrier dies, drops the flag, or leaves the approach zone before delivering).
   */
  private updateGateReturn(deltaSeconds: number): void {
    for (const team of ['blue', 'red'] as const) {
      if (this.breachedTeam === team) continue;
      const state = this.gateReturn[team];
      const castle = this.getCastle(team);

      if (this.shouldOpenGateForReturn(team)) {
        if (!state.open) {
          state.open = true;
          castle.setGateOpen(true);
          this.onGateOpened(team);
        }
        state.closeTimer = -1;
        state.openRemaining = CONFIG.match.flagReturnGateCloseDelaySeconds;
        continue;
      }

      if (!state.open) continue;
      // The return ended. Delivering the flag closes the gate after a short controlled delay; any
      // other end (death, drop, lost ownership, or leaving the approach zone) closes it at once.
      if (this.flag.currentStatus === 'resetting' && this.flag.lastDeliveredTeam === team) {
        if (state.closeTimer < 0) state.closeTimer = CONFIG.match.flagReturnGateCloseDelaySeconds;
        state.closeTimer -= deltaSeconds;
        state.openRemaining = Math.max(0, state.closeTimer);
        if (state.closeTimer <= 0) {
          state.open = false;
          state.closeTimer = -1;
          state.openRemaining = 0;
          castle.setGateOpen(false);
        }
      } else {
        state.open = false;
        state.closeTimer = -1;
        state.openRemaining = 0;
        castle.setGateOpen(false);
      }
    }
  }

  update(deltaSeconds: number, elapsed: number): void {
    for (const team of ['blue', 'red'] as const) {
      if (this.attackWindow[team] > 0) {
        this.attackWindow[team] = Math.max(0, this.attackWindow[team] - deltaSeconds);
      }
    }

    this.updateGateReturn(deltaSeconds);

    this.blueHealth.update(deltaSeconds);
    this.redHealth.update(deltaSeconds);

    if (this.destructionPending && !this.destructionComplete) {
      const health = this.getHealth(this.destructionPending);
      if (health.destructionProgress >= 1) {
        this.destructionComplete = true;
        this.winner = oppositeTeam(this.destructionPending);
        this.onVictory(this.winner);
      }
    }

    if (this.breachedTeam && !this.winner && !this.destructionPending) {
      this.breachTimer -= deltaSeconds;
      if (this.breachTimer <= 0) {
        this.winner = oppositeTeam(this.breachedTeam);
        this.onVictory(this.winner);
      }
    }

    this.blueCastle.update(deltaSeconds, elapsed);
    this.redCastle.update(deltaSeconds, elapsed);
  }
}
