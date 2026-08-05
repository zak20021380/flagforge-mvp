import { oppositeTeam } from '../core/math';
import type { MatchPhase, Team } from '../core/types';

/**
 * Single authoritative match-phase state, shared by every subsystem.
 *
 * Flow: FLAG_OBJECTIVE -> CASTLE_ASSAULT -> MATCH_FINISHED.
 *
 *  - FLAG_OBJECTIVE: the central flag is the live objective; both teams capture and return it.
 *  - CASTLE_ASSAULT: entered exactly once, on the first flag delivery. The delivering team
 *    (assaultingTeam) attacks the opposite castle (assaultTarget) until it falls or the match ends.
 *    The flag is permanently consumed; flag/tower/respawn logic is inactive.
 *  - MATCH_FINISHED: set when a castle is breached/destroyed and a winner is decided.
 *
 * The transition is atomic and idempotent: enterCastleAssault returns false once the phase has
 * already left FLAG_OBJECTIVE, so repeated delivery callbacks can never restart or double-run it.
 */
export class MatchFlow {
  private phase: MatchPhase = 'FLAG_OBJECTIVE';
  private assaultingTeam: Team | null = null;
  private assaultTarget: Team | null = null;

  get currentPhase(): MatchPhase {
    return this.phase;
  }

  /** True while the flag is still the live field objective. */
  get isFlagObjective(): boolean {
    return this.phase === 'FLAG_OBJECTIVE';
  }

  /** True once a delivery has started the permanent castle assault. */
  get isCastleAssault(): boolean {
    return this.phase === 'CASTLE_ASSAULT';
  }

  /** True once the match has ended. */
  get isFinished(): boolean {
    return this.phase === 'MATCH_FINISHED';
  }

  /** The team that delivered the flag and is now on the attack, or null pre-delivery. */
  get attacker(): Team | null {
    return this.assaultingTeam;
  }

  /** The castle under assault (the delivering team's opponent), or null pre-delivery. */
  get defender(): Team | null {
    return this.assaultTarget;
  }

  /** True only for the team currently entitled to assault the enemy castle. */
  isAssaulting(team: Team): boolean {
    return this.phase === 'CASTLE_ASSAULT' && this.assaultingTeam === team;
  }

  /** True only for the team whose castle is currently under assault. */
  isDefending(team: Team): boolean {
    return this.phase === 'CASTLE_ASSAULT' && this.assaultTarget === team;
  }

  /**
   * Atomically move the match from FLAG_OBJECTIVE into CASTLE_ASSAULT. Succeeds only on the first
   * delivery; afterwards the phase is locked and no callback can re-enter or overwrite it.
   */
  enterCastleAssault(deliveredBy: Team): boolean {
    if (this.phase !== 'FLAG_OBJECTIVE') return false;
    this.assaultingTeam = deliveredBy;
    this.assaultTarget = oppositeTeam(deliveredBy);
    this.phase = 'CASTLE_ASSAULT';
    return true;
  }

  get isFlagObjectivePhase(): boolean {
    return this.phase === 'FLAG_OBJECTIVE';
  }

  /** Permanently close the flow after a winner is decided. */
  finish(): void {
    if (this.phase === 'MATCH_FINISHED') return;
    this.phase = 'MATCH_FINISHED';
  }
}
