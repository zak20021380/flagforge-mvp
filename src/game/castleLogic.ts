import { Vector3 } from '@babylonjs/core';
import { CONFIG } from '../core/config';
import { oppositeTeam } from '../core/math';
import type { Team } from '../core/types';
import type { CastleVisual } from '../render/castle';
import { CastleHealthModel } from './castleHealth';
import type { FlagController } from './flag';
import { GateHealthModel } from './gateHealth';
import type { MatchFlow } from './matchFlow';
import type { UnitEntity } from './unit';

type GatePhase = 'idle' | 'opening' | 'open' | 'carrierEntering' | 'flagPlacement' | 'closing';

interface GateReturnState {
  phase: GatePhase;
  closeTimer: number;
  openRemaining: number;
  prevApproachDistance: number;
  placementTimer: number;
}

export class CastleLogic {
  private breachedTeam: Team | null = null;
  private breachTimer = 0;
  private winner: Team | null = null;
  private readonly gateReturn: Record<Team, GateReturnState> = {
    blue: { phase: 'idle', closeTimer: -1, openRemaining: 0, prevApproachDistance: -1, placementTimer: 0 },
    red: { phase: 'idle', closeTimer: -1, openRemaining: 0, prevApproachDistance: -1, placementTimer: 0 },
  };
  readonly blueHealth: CastleHealthModel;
  readonly redHealth: CastleHealthModel;
  readonly blueGate: GateHealthModel;
  readonly redGate: GateHealthModel;
  private destructionPending: Team | null = null;
  private destructionComplete = false;

  constructor(
    private readonly blueCastle: CastleVisual,
    private readonly redCastle: CastleVisual,
    private readonly flag: FlagController,
    private readonly matchFlow: MatchFlow,
    private readonly onGateOpened: (castleTeam: Team) => void,
    private readonly onGateClosed: (castleTeam: Team) => void,
    private readonly onBreach: (attacker: Team, defender: Team) => void,
    private readonly onVictory: (winner: Team) => void,
  ) {
    this.blueHealth = new CastleHealthModel();
    this.redHealth = new CastleHealthModel();
    this.blueGate = new GateHealthModel();
    this.redGate = new GateHealthModel();
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

  getHealth(team: Team): CastleHealthModel {
    return team === 'blue' ? this.blueHealth : this.redHealth;
  }

  getGateHealth(team: Team): GateHealthModel {
    return team === 'blue' ? this.blueGate : this.redGate;
  }

  /** True while stage 1 is still running for this castle: only its gate may take damage. */
  isGateStage(team: Team): boolean {
    return !this.getGateHealth(team).destroyed;
  }

  /**
   * The single structure-damage entry point, and the only place the two authoritative HP pools are
   * ever spent. It is a strict router, never a splitter: while the defender's gate stands the hit is
   * spent entirely on `gateHp` and the castle is immune; once the gate is destroyed every subsequent
   * hit is spent entirely on `castleHp`. A hit can never touch both pools. `amount` is already scaled
   * for the current stage by the caller (see UnitManager.tryAttackCastle).
   */
  applyStructureDamage(defender: Team, amount: number, hitPoint: Vector3, strong: boolean): void {
    if (this.winner || this.destructionComplete) return;
    const gate = this.getGateHealth(defender);
    if (!gate.destroyed) {
      // STAGE 1 — the gate absorbs the whole hit. Castle HP is untouched.
      gate.applyDamage(amount, hitPoint.x, hitPoint.y, hitPoint.z, strong);
      return;
    }
    // STAGE 2 — the gate is breached and permanently out of the loop.
    this.applyCastleDamage(defender, amount, hitPoint, strong);
  }

  private applyCastleDamage(defender: Team, amount: number, hitPoint: Vector3, strong: boolean): void {
    const health = this.getHealth(defender);
    if (health.destroyed) return;
    health.applyDamage(amount, hitPoint.x, hitPoint.y, hitPoint.z, strong);
    if (health.hp <= 0 && !health.destroyed) {
      health.triggerDestruction();
      this.destructionPending = defender;
    }
  }

  /**
   * Where an attacker stands to hit the enemy structure. Stage 1 funnels everyone onto the three
   * gate-front slots so the assault visibly concentrates on the gate; once that gate is breached the
   * full slot ring (gate + flanking wall slots) opens up for the castle assault. Mirrored for both
   * teams by the same facing multiplier the castles are built with.
   */
  getAssaultSlot(unit: UnitEntity): Vector3 {
    const enemy = unit.team === 'blue' ? 'red' : 'blue';
    const castle = this.getCastle(enemy);
    const slots = CONFIG.castle.assaultSlots;
    const usable = this.isGateStage(enemy)
      ? Math.min(CONFIG.gate.assaultSlotCount, slots.length)
      : slots.length;
    const slotIndex = unit.id % usable;
    const slot = slots[slotIndex];
    return new Vector3(
      castle.root.position.x + slot.x,
      0.16,
      castle.gatePoint.z + slot.z * (unit.team === 'blue' ? -1 : 1),
    );
  }

  /** True while THIS castle's gate is physically open (flag-return, or its breach state). */
  isGateOpen(team: Team): boolean {
    const phase = this.gateReturn[team].phase;
    return (
      phase === 'open'
      || phase === 'opening'
      || phase === 'carrierEntering'
      || phase === 'flagPlacement'
    ) || this.breachedTeam === team;
  }

  getGatePhase(team: Team): GatePhase {
    return this.gateReturn[team].phase;
  }

  isCarrierEnteringOrPlacing(team: Team): boolean {
    const p = this.gateReturn[team].phase;
    return p === 'carrierEntering' || p === 'flagPlacement';
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
    if (unit.navigationArea !== 'ground' || this.breachedTeam || this.winner || !this.matchFlow.isAssaulting(unit.team)) return false;
    const defender = oppositeTeam(unit.team);
    const interior = this.getCastle(defender).interiorPoint;
    const insideX = Math.abs(unit.position.x - interior.x) <= 3.1;
    const insideZ = unit.team === 'blue'
      ? unit.position.z >= interior.z
      : unit.position.z <= interior.z;
    if (!insideX || !insideZ) return false;

    this.breachedTeam = defender;
    this.breachTimer = CONFIG.match.breachCountdownSeconds;
    const castle = this.getCastle(defender);
    // Breach state is permanent and wins over the return-gate logic: the castle stays open so the
    // countdown reads as a broken fortress, and updateGateReturn never closes it.
    castle.beginOpenGate();
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
      const shouldOpen = this.shouldOpenGateForReturn(team);
      const carrier = this.flag.currentCarrier;
      const carrierValid = carrier?.active && carrier.state !== 'dead' && carrier.team === team && carrier.carryingFlag;
      const carrierInside = carrierValid && this.isCarrierInsideGate(carrier, castle);

      switch (state.phase) {
        case 'idle':
          if (shouldOpen) {
            state.phase = 'opening';
            castle.beginOpenGate();
            this.onGateOpened(team);
            state.closeTimer = -1;
            state.placementTimer = 0;
            state.openRemaining = CONFIG.match.flagReturnGateCloseDelaySeconds;
          }
          break;

        case 'opening':
          if (!shouldOpen && !carrierValid) {
            state.phase = 'closing';
            castle.beginCloseGate();
            state.closeTimer = -1;
            state.openRemaining = 0;
          } else {
            state.openRemaining = CONFIG.match.flagReturnGateCloseDelaySeconds;
            if (castle.getGateState() === 'open') {
              state.phase = carrierValid ? 'carrierEntering' : 'open';
            }
          }
          break;

        case 'open':
          if (shouldOpen && carrierValid) {
            state.phase = 'carrierEntering';
          } else if (!shouldOpen) {
            if (this.flag.currentStatus === 'consumed' && this.flag.lastDeliveredTeam === team) {
              if (state.closeTimer < 0) state.closeTimer = CONFIG.match.flagReturnGateCloseDelaySeconds;
              state.closeTimer -= deltaSeconds;
              state.openRemaining = Math.max(0, state.closeTimer);
              if (state.closeTimer <= 0) {
                state.phase = 'closing';
                castle.beginCloseGate();
                state.closeTimer = -1;
                state.openRemaining = 0;
              }
            } else {
              state.phase = 'closing';
              castle.beginCloseGate();
              state.closeTimer = -1;
              state.openRemaining = 0;
            }
          } else {
            state.openRemaining = CONFIG.match.flagReturnGateCloseDelaySeconds;
          }
          break;

        case 'carrierEntering':
          if (!carrierValid) {
            state.phase = 'closing';
            castle.beginCloseGate();
            state.closeTimer = -1;
            state.openRemaining = 0;
          } else if (carrierInside) {
            state.phase = 'flagPlacement';
            state.placementTimer = 0;
          } else {
            state.openRemaining = CONFIG.match.flagReturnGateCloseDelaySeconds;
          }
          break;

        case 'flagPlacement':
          state.placementTimer += deltaSeconds;
          state.openRemaining = CONFIG.match.flagReturnGateCloseDelaySeconds;
          if (this.flag.currentStatus === 'consumed' || state.placementTimer >= CONFIG.match.flagPlacementDurationSeconds) {
            if (state.closeTimer < 0) state.closeTimer = CONFIG.match.flagReturnGateCloseDelaySeconds;
            state.closeTimer -= deltaSeconds;
            state.openRemaining = Math.max(0, state.closeTimer);
            if (state.closeTimer <= 0) {
              state.phase = 'closing';
              castle.beginCloseGate();
              state.closeTimer = -1;
              state.openRemaining = 0;
            }
          }
          break;

        case 'closing':
          if (shouldOpen && carrierValid && !carrierInside) {
            state.phase = 'opening';
            castle.beginOpenGate();
            this.onGateOpened(team);
            state.closeTimer = -1;
            state.placementTimer = 0;
            state.openRemaining = CONFIG.match.flagReturnGateCloseDelaySeconds;
          } else if (castle.getGateState() === 'closed') {
            state.phase = 'idle';
            state.closeTimer = -1;
            state.placementTimer = 0;
            state.openRemaining = 0;
            this.onGateClosed(team);
          }
          break;
      }
    }
  }

  private isCarrierInsideGate(carrier: UnitEntity, castle: CastleVisual): boolean {
    const gateZ = castle.gatePoint.z;
    const facing = castle.team === 'blue' ? 1 : -1;
    const pastGate = facing > 0
      ? carrier.position.z < gateZ - 0.5
      : carrier.position.z > gateZ + 0.5;
    const distX = Math.abs(carrier.position.x - castle.root.position.x);
    return pastGate && distX < 4.0;
  }

  update(deltaSeconds: number, elapsed: number): void {
    this.updateGateReturn(deltaSeconds);

    this.blueGate.update(deltaSeconds);
    this.redGate.update(deltaSeconds);
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
