import { CONFIG, UNIT_LABELS, UNIT_STATS } from '../core/config';
import type { CastleState, QualityTier, Team, UnitKind } from '../core/types';
import type { FlagStatus } from '../game/flag';

const MOJIBAKE_REPLACEMENTS: ReadonlyArray<readonly [string, string]> = [
  [String.fromCharCode(0x00e2, 0x20ac, 0x201d), '\u2014'],
  [String.fromCharCode(0x00e2, 0x20ac, 0x00a2), '\u2022'],
  [String.fromCharCode(0x00e2, 0x0161, 0x2018), '\u2691'],
  [String.fromCharCode(0x00e2, 0x0161, 0x201d), '\u2694'],
];

export interface HudState {
  readonly playerEnergy: number;
  readonly enemyEnergy: number;
  readonly timeRemaining: number;
  readonly overtime: boolean;
  readonly flagStatus: FlagStatus;
  readonly flagCarrier: Team | null;
  readonly blueGateTime: number;
  readonly redGateTime: number;
  readonly breachedTeam: Team | null;
  readonly breachCountdown: number;
  readonly selectedKind: UnitKind | null;
  readonly playerLocked: boolean;
  readonly playerCastleHp: number;
  readonly playerCastleMaxHp: number;
  readonly playerCastleState: CastleState;
  readonly playerCastleCountdown: number;
  readonly playerFlagSecured: boolean;
  readonly enemyCastleHp: number;
  readonly enemyCastleMaxHp: number;
  readonly enemyCastleState: CastleState;
  readonly enemyCastleCountdown: number;
  readonly enemyFlagSecured: boolean;
}

export class GameUI {
  private readonly root: HTMLElement;
  private readonly loadingOverlay: HTMLElement;
  private readonly loadButton: HTMLButtonElement;
  private readonly startButton: HTMLButtonElement;
  private readonly qualitySelect: HTMLSelectElement;
  private readonly progressFill: HTMLElement;
  private readonly loadingLabel: HTMLElement;
  private readonly timer: HTMLElement;
  private readonly energyFill: HTMLElement;
  private readonly energyText: HTMLElement;
  private readonly enemyEnergyFill: HTMLElement;
  private readonly castlePanel: HTMLElement;
  private readonly castleFill: HTMLElement;
  private readonly castleStateLabel: HTMLElement;
  private readonly castleHp: HTMLElement;
  private readonly castleFlag: HTMLElement;
  private readonly enemyCastleStrip: HTMLElement;
  private readonly enemyCastleFill: HTMLElement;
  private readonly enemyCastleStateLabel: HTMLElement;
  private readonly enemyCastleHp: HTMLElement;
  private readonly enemyCastleFlag: HTMLElement;
  private readonly playerDamageFlash: CastleDamageFlash;
  private readonly enemyDamageFlash: CastleDamageFlash;
  private readonly cardButtons = new Map<UnitKind, HTMLButtonElement>();
  private readonly endOverlay: HTMLElement;
  private readonly endTitle: HTMLElement;
  private readonly endSubtitle: HTMLElement;
  private lastCastleHp = Infinity;
  private collapseTimer: number | undefined;
  private hitTimer: number | undefined;
  private readonly castleAttentionMs = 2600;

  onPrepare: (quality: QualityTier) => void = () => undefined;
  onStart: () => void = () => undefined;
  onCardSelect: (kind: UnitKind) => void = () => undefined;
  onRestart: () => void = () => window.location.reload();

  constructor(root: HTMLElement, defaultQuality: QualityTier) {
    this.root = root;
    this.root.innerHTML = normalizeDisplayText(this.template(defaultQuality));
    this.loadingOverlay = this.query('#loading-overlay');
    this.loadButton = this.query<HTMLButtonElement>('#load-arena');
    this.startButton = this.query<HTMLButtonElement>('#start-battle');
    this.qualitySelect = this.query<HTMLSelectElement>('#quality-select');
    this.progressFill = this.query('#loading-progress-fill');
    this.loadingLabel = this.query('#loading-label');
    this.timer = this.query('#match-timer');
    this.energyFill = this.query('#energy-fill');
    this.energyText = this.query('#energy-text');
    this.enemyEnergyFill = this.query('#enemy-energy-fill');
    this.castlePanel = this.query('#player-castle-panel');
    this.castleFill = this.query('#player-castle-fill');
    this.castleStateLabel = this.query('#player-castle-state');
    this.castleHp = this.query('#player-castle-hp');
    this.castleFlag = this.query('#player-castle-flag');
    this.enemyCastleStrip = this.query('#enemy-castle-strip');
    this.enemyCastleFill = this.query('#enemy-castle-fill');
    this.enemyCastleStateLabel = this.query('#enemy-castle-state');
    this.enemyCastleHp = this.query('#enemy-castle-hp');
    this.enemyCastleFlag = this.query('#enemy-castle-flag');
    const reducedMotion = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.playerDamageFlash = new CastleDamageFlash(this.query('#player-castle-flash'), reducedMotion);
    this.enemyDamageFlash = new CastleDamageFlash(this.query('#enemy-castle-flash'), reducedMotion);
    this.endOverlay = this.query('#end-overlay');
    this.endTitle = this.query('#end-title');
    this.endSubtitle = this.query('#end-subtitle');

    this.castlePanel.addEventListener('click', () => this.toggleCastle());
    this.castlePanel.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        this.toggleCastle();
      }
    });

    for (const kind of ['vanguard', 'ranger', 'raider', 'ironGuard'] as const) {
      const button = this.query<HTMLButtonElement>(`[data-card="${kind}"]`);
      button.addEventListener('pointerdown', (event) => {
        event.preventDefault();
        event.stopPropagation();
        this.onCardSelect(kind);
      });
      this.cardButtons.set(kind, button);
    }

    this.loadButton.addEventListener('click', () => {
      this.loadButton.disabled = true;
      this.qualitySelect.disabled = true;
      this.onPrepare(this.qualitySelect.value as QualityTier);
    });
    this.startButton.addEventListener('click', () => this.onStart());
    this.query<HTMLButtonElement>('#restart-button').addEventListener('click', () => this.onRestart());
  }

  setLoading(progress: number, label: string): void {
    const safe = Math.max(0, Math.min(1, progress));
    this.progressFill.style.width = `${Math.round(safe * 100)}%`;
    this.loadingLabel.textContent = label;
  }

  showStartButton(): void {
    this.loadButton.hidden = true;
    this.startButton.hidden = false;
    this.startButton.disabled = false;
    this.loadingLabel.textContent = 'Arena ready';
  }

  hideLoading(): void {
    this.loadingOverlay.classList.add('hidden');
  }

  update(state: HudState): void {
    const seconds = Math.max(0, Math.ceil(state.timeRemaining));
    const minutes = Math.floor(seconds / 60);
    this.timer.textContent = state.overtime ? 'OVERTIME' : `${minutes}:${String(seconds % 60).padStart(2, '0')}`;
    this.timer.classList.toggle('overtime', state.overtime);

    this.energyFill.style.width = `${(state.playerEnergy / CONFIG.energy.maximum) * 100}%`;
    this.energyText.textContent = `${Math.floor(state.playerEnergy)} / ${CONFIG.energy.maximum}`;
    this.enemyEnergyFill.style.width = `${(state.enemyEnergy / CONFIG.energy.maximum) * 100}%`;

    const playerCastleHp = Math.max(0, Math.round(state.playerCastleHp));
    const enemyCastleHp = Math.max(0, Math.round(state.enemyCastleHp));
    const castleDamaged = playerCastleHp < this.lastCastleHp;
    this.lastCastleHp = playerCastleHp;
    this.castleFill.style.width = `${(playerCastleHp / state.playerCastleMaxHp) * 100}%`;
    this.enemyCastleFill.style.width = `${(enemyCastleHp / state.enemyCastleMaxHp) * 100}%`;
    this.castleHp.textContent = `${playerCastleHp} / ${state.playerCastleMaxHp}`;
    this.enemyCastleHp.textContent = `${enemyCastleHp} / ${state.enemyCastleMaxHp}`;
    this.castleStateLabel.textContent = castleStateText(state.playerCastleState, state.playerCastleCountdown, false);
    this.enemyCastleStateLabel.textContent = castleStateText(state.enemyCastleState, state.enemyCastleCountdown, true);
    const castleOpen = state.playerCastleState === 'open';
    const castleBreached = state.playerCastleState === 'breached';
    this.castlePanel.classList.toggle('open', castleOpen);
    this.castlePanel.classList.toggle('breached', castleBreached);
    this.enemyCastleStrip.classList.toggle('open', state.enemyCastleState === 'open');
    this.enemyCastleStrip.classList.toggle('breached', state.enemyCastleState === 'breached');
    if (castleOpen || castleBreached) {
      this.setCastleExpanded(true);
      if (this.collapseTimer !== undefined) {
        window.clearTimeout(this.collapseTimer);
        this.collapseTimer = undefined;
      }
    } else if (castleDamaged) {
      this.setCastleExpanded(true);
      this.scheduleCastleCollapse();
      this.pulseCastleHit();
    }
    this.setFlagSecured(this.castleFlag, state.playerFlagSecured, 'secured in your castle');
    this.setFlagSecured(this.enemyCastleFlag, state.enemyFlagSecured, 'secured in the enemy castle');
    this.playerDamageFlash.pulse(playerCastleHp, state.playerCastleMaxHp, state.playerCastleState === 'breached');
    this.enemyDamageFlash.pulse(enemyCastleHp, state.enemyCastleMaxHp, state.enemyCastleState === 'breached');

    for (const [kind, button] of this.cardButtons) {
      const unaffordable = state.playerEnergy + 0.001 < UNIT_STATS[kind].cost;
      button.classList.toggle('selected', state.selectedKind === kind);
      button.classList.toggle('disabled', unaffordable || state.playerLocked);
      button.disabled = state.playerLocked;
      button.setAttribute('aria-pressed', String(state.selectedKind === kind));
      button.setAttribute('aria-disabled', String(unaffordable || state.playerLocked));
    }
  }

  showBanner(_message: string, _tone: 'neutral' | 'success' | 'danger' = 'neutral', _seconds = 1.8): void {}

  showDeployFeedback(message: string, valid: boolean): void {
    this.showBanner(message, valid ? 'success' : 'danger', 1.15);
  }

  showEnd(winner: Team): void {
    const playerWon = winner === 'blue';
    this.endTitle.textContent = playerWon ? 'VICTORY' : 'DEFEAT';
    this.endTitle.dataset.result = playerWon ? 'victory' : 'defeat';
    this.endSubtitle.textContent = playerWon
      ? 'Enemy deployment is locked. The fortress has fallen.'
      : 'Your castle was infiltrated and the breach became irreversible.';
    this.endOverlay.classList.add('visible');
  }

  private template(defaultQuality: QualityTier): string {
    const cards = (['vanguard', 'ranger', 'raider', 'ironGuard'] as const).map((kind) => `
      <button class="unit-card" data-card="${kind}" type="button" aria-label="Deploy ${UNIT_LABELS[kind]}">
        <span class="card-portrait portrait-${kind}">${this.icon(kind)}</span>
        <span class="card-info">
          <strong>${UNIT_LABELS[kind]}</strong>
          <small>${kind === 'vanguard' ? 'Balanced melee' : kind === 'ranger' ? 'Long range' : kind === 'raider' ? 'Fast objective' : 'Tank & escort'}</small>
        </span>
        <span class="card-cost">${UNIT_STATS[kind].cost}</span>
      </button>
    `).join('');

    return `
      <section id="loading-overlay" class="loading-overlay">
        <div class="loading-card">
          <div class="game-mark"><span>⚑</span></div>
          <p class="eyebrow">MOBILE 3D STRATEGY</p>
          <h1>FLAGFORGE</h1>
          <p class="loading-copy">Capture the banner. Break the gate. Infiltrate the fortress.</p>
          <label class="quality-row">Quality
            <select id="quality-select">
              <option value="low" ${defaultQuality === 'low' ? 'selected' : ''}>Mobile Low</option>
              <option value="standard" ${defaultQuality === 'standard' ? 'selected' : ''}>Mobile Standard</option>
              <option value="high" ${defaultQuality === 'high' ? 'selected' : ''}>Desktop High</option>
            </select>
          </label>
          <div class="loading-progress"><i id="loading-progress-fill"></i></div>
          <p id="loading-label" class="loading-label">Choose quality, then prepare the arena</p>
          <button id="load-arena" class="primary-button" type="button">PREPARE ARENA</button>
          <button id="start-battle" class="primary-button pulse" type="button" hidden disabled>START BATTLE</button>
        </div>
      </section>

      <div id="hud-top-strip"></div>

      <div id="enemy-castle-strip" class="castle-strip">
        <span class="castle-strip-sigil" aria-hidden="true">
          <svg viewBox="0 0 24 24"><path class="castle-body" d="M4 21V3h3v4h4V3h4v4h3V3h4v18H4z"/><path class="castle-door" d="M10.5 21v-4.2a2.5 2.5 0 0 0 5 0v4.2z"/></svg>
        </span>
        <small id="enemy-castle-state" class="castle-state">SECURE</small>
        <span class="castle-track"><i id="enemy-castle-fill"></i><em id="enemy-castle-flash"></em></span>
        <b id="enemy-castle-hp" class="castle-hp">1000 / 1000</b>
        <span id="enemy-castle-flag" class="flag-chip" role="img" aria-label="Flag not secured">
          <svg viewBox="0 0 24 24"><path class="pole" d="M7 22V2h2v20z"/><path class="cloth" d="M9 3l12 5-12 5z"/></svg>
        </span>
      </div>

      <header class="match-hud">
        <div class="match-hud-chrome" aria-hidden="true">
          <span class="match-hud-edge"></span>
          <span class="match-hud-plate"></span>
          <span class="match-hud-accents"></span>
          <span class="match-hud-trim"></span>
        </div>

        <div class="hud-plaque hud-plaque-blue">
          <span class="hud-sigil" aria-hidden="true"></span>
          <span class="hud-ident"><b>YOU</b><span>BLUE CITADEL</span></span>
        </div>

        <div class="hud-core">
          <div id="match-timer" class="hud-timer">3:00</div>
        </div>

        <div class="hud-plaque hud-plaque-red">
          <span class="hud-ident"><b>RIVAL</b><span>RED CITADEL</span><i class="hud-threat"><em id="enemy-energy-fill"></em></i></span>
          <span class="hud-sigil" aria-hidden="true"></span>
        </div>
      </header>

      <footer class="bottom-hud">
        <div id="player-castle-panel" class="castle-panel" role="button" tabindex="0" aria-expanded="false" aria-label="Castle integrity. Activate to expand details.">
          <span class="castle-sigil" aria-hidden="true">
            <svg viewBox="0 0 24 24">
              <path class="castle-body" d="M4 21V3h3v4h4V3h4v4h3V3h4v18H4z"/>
              <path class="castle-door" d="M10.5 21v-5a3 3 0 0 0 6 0v5z"/>
              <path class="castle-grate" d="M11.6 17h3.8M11.3 18.8h4.4"/>
            </svg>
          </span>
          <span class="castle-folder">
            <span class="castle-bar"><i id="player-castle-fill"></i><em id="player-castle-flash"></em></span>
            <small id="player-castle-state" class="castle-state">GATE SECURE</small>
          </span>
          <span class="castle-side">
            <b id="player-castle-hp" class="castle-hp">1000 / 1000</b>
            <span id="player-castle-flag" class="flag-chip" role="img" aria-label="Flag not secured">
              <svg viewBox="0 0 24 24"><path class="pole" d="M7 22V2h2v20z"/><path class="cloth" d="M9 3l12 5-12 5z"/></svg>
            </span>
          </span>
        </div>
        <div class="energy-panel"><span>ENERGY</span><div class="energy-track"><i id="energy-fill"></i></div><b id="energy-text">5 / 10</b></div>
        <div class="card-row">${cards}</div>
      </footer>

      <section id="end-overlay" class="end-overlay">
        <div class="end-card">
          <p>CASTLE CHECKMATE</p>
          <h2 id="end-title">VICTORY</h2>
          <div class="breach-seal">⚔</div>
          <span id="end-subtitle"></span>
          <button id="restart-button" class="primary-button" type="button">PLAY AGAIN</button>
        </div>
      </section>
    `;
  }

  private setFlagSecured(element: HTMLElement, secured: boolean, securedLabel: string): void {
    element.classList.toggle('secured', secured);
    element.setAttribute('aria-label', secured ? `Flag ${securedLabel}` : 'Flag not secured');
  }

  private setCastleExpanded(expanded: boolean): void {
    this.castlePanel.classList.toggle('expanded', expanded);
    this.castlePanel.setAttribute('aria-expanded', String(expanded));
  }

  private scheduleCastleCollapse(): void {
    if (this.collapseTimer !== undefined) window.clearTimeout(this.collapseTimer);
    this.collapseTimer = window.setTimeout(() => {
      this.collapseTimer = undefined;
      if (this.castlePanel.classList.contains('open') || this.castlePanel.classList.contains('breached')) return;
      this.setCastleExpanded(false);
    }, this.castleAttentionMs);
  }

  private toggleCastle(): void {
    if (this.castlePanel.classList.contains('expanded')) {
      this.setCastleExpanded(false);
    } else {
      this.setCastleExpanded(true);
      this.scheduleCastleCollapse();
    }
  }

  private pulseCastleHit(): void {
    this.castlePanel.classList.remove('hit');
    void this.castlePanel.offsetWidth;
    this.castlePanel.classList.add('hit');
    if (this.hitTimer !== undefined) window.clearTimeout(this.hitTimer);
    this.hitTimer = window.setTimeout(() => this.castlePanel.classList.remove('hit'), 360);
  }

  private icon(kind: UnitKind): string {
    if (kind === 'vanguard') return '<svg viewBox="0 0 80 80"><path d="M18 62l10-34 12-9 12 9 10 34-22 9z"/><path class="accent" d="M40 10l9 11-9 8-9-8z"/><path class="metal" d="M57 17l5 4-24 39-7-4z"/></svg>';
    if (kind === 'ranger') return '<svg viewBox="0 0 80 80"><path d="M20 64l7-38 13-15 13 15 7 38-20 7z"/><path class="accent" d="M27 27l13-16 13 16-13 8z"/><path class="metal line" d="M62 17c-20 5-20 41 0 47"/></svg>';
    if (kind === 'raider') return '<svg viewBox="0 0 80 80"><path d="M24 66l5-35 11-13 11 13 5 35-16 5z"/><path class="accent" d="M27 25l13-10 13 10-5 10H32z"/><path class="metal" d="M17 18l5-3 20 43-6 3zM63 18l-5-3-20 43 6 3z"/></svg>';
    return '<svg viewBox="0 0 80 80"><path d="M13 64l8-38 19-13 19 13 8 38-27 8z"/><path class="metal" d="M23 21l17-11 17 11-4 22H27z"/><path class="accent" d="M19 39h27v27H19z"/></svg>';
  }

  private query<T extends HTMLElement = HTMLElement>(selector: string): T {
    const element = this.root.querySelector<T>(selector);
    if (!element) throw new Error(`Missing UI element: ${selector}`);
    return element;
  }
}

function normalizeDisplayText(value: string): string {
  let normalized = value;
  for (const [broken, intended] of MOJIBAKE_REPLACEMENTS) normalized = normalized.replaceAll(broken, intended);
  return normalized;
}

function castleStateText(state: CastleState, countdown: number, compact: boolean): string {
  if (state === 'secure') return compact ? 'SECURE' : 'GATE SECURE';
  const seconds = Math.max(1, Math.ceil(countdown));
  if (state === 'breached') {
    return compact ? `BREACHED ${seconds}s` : `BREACHED \u00b7 ${seconds}s`;
  }
  return compact ? `GATE OPEN ${seconds}s` : `GATE OPEN \u00b7 ${seconds}s`;
}

/**
 * Lightweight damage cue for a castle health bar: a one-shot overlay flash over the fill that
 * fades out via the Web Animations API. Throttled so steady assault drain reads as sustained
 * damage rather than a strobe, and disabled entirely for reduced-motion users.
 */
class CastleDamageFlash {
  private lastHp = -1;
  private lastTime = 0;

  constructor(
    private readonly element: HTMLElement,
    private readonly reducedMotion: boolean,
  ) {}

  pulse(hp: number, maxHp: number, breached: boolean): void {
    const step = Math.max(1, maxHp * 0.015);
    if (hp >= this.lastHp - step) {
      this.lastHp = hp;
      return;
    }
    this.lastHp = hp;
    if (this.reducedMotion) return;
    const now = performance.now();
    if (now - this.lastTime < 450) return;
    this.lastTime = now;
    this.element.style.background = breached
      ? 'linear-gradient(90deg, rgba(255, 74, 88, .9), rgba(255, 158, 120, .9))'
      : 'linear-gradient(90deg, rgba(214, 238, 255, .95), rgba(122, 196, 255, .95))';
    this.element.animate([{ opacity: 0.65 }, { opacity: 0 }], { duration: 400, easing: 'ease-out' });
  }
}
