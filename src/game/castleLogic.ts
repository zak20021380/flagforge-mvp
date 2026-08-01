import { CONFIG } from '../core/config';
import { oppositeTeam } from '../core/math';
import type { Team } from '../core/types';
import type { CastleVisual } from '../render/castle';
import type { UnitEntity } from './unit';

export class CastleLogic {
  private readonly attackWindow: Record<Team, number> = { blue: 0, red: 0 };
  private breachedTeam: Team | null = null;
  private breachTimer = 0;
  private winner: Team | null = null;

  constructor(
    private readonly blueCastle: CastleVisual,
    private readonly redCastle: CastleVisual,
    private readonly onGateOpened: (attacker: Team) => void,
    private readonly onBreach: (attacker: Team, defender: Team) => void,
    private readonly onVictory: (winner: Team) => void,
  ) {}

  openEnemyGateFor(attacker: Team): void {
    if (this.winner || this.breachedTeam === oppositeTeam(attacker)) return;
    this.attackWindow[attacker] = CONFIG.match.gateOpenSeconds;
    this.getCastle(oppositeTeam(attacker)).setGateOpen(true);
    this.onGateOpened(attacker);
  }

  isAttackWindow(team: Team): boolean {
    return this.attackWindow[team] > 0 || this.breachedTeam === oppositeTeam(team);
  }

  getAttackWindowRemaining(team: Team): number {
    return this.attackWindow[team];
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
    if (this.breachedTeam || this.winner || !this.isAttackWindow(unit.team)) return false;
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
    castle.setGateOpen(true);
    castle.setBreached(true);
    this.onBreach(unit.team, defender);
    return true;
  }

  update(deltaSeconds: number, elapsed: number): void {
    for (const team of ['blue', 'red'] as const) {
      if (this.attackWindow[team] > 0) {
        this.attackWindow[team] = Math.max(0, this.attackWindow[team] - deltaSeconds);
        if (this.attackWindow[team] === 0 && this.breachedTeam !== oppositeTeam(team)) {
          this.getCastle(oppositeTeam(team)).setGateOpen(false);
        }
      }
    }

    if (this.breachedTeam && !this.winner) {
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
