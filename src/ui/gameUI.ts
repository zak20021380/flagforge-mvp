import { CONFIG, UNIT_LABELS, UNIT_STATS } from '../core/config';
import type { QualityTier, Team, UnitKind } from '../core/types';
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
  private readonly flagStatus: HTMLElement;
  private readonly gateStatus: HTMLElement;
  private readonly alertBanner: HTMLElement;
  private readonly energyFill: HTMLElement;
  private readonly energyText: HTMLElement;
  private readonly enemyEnergyFill: HTMLElement;
  private readonly cardButtons = new Map<UnitKind, HTMLButtonElement>();
  private readonly endOverlay: HTMLElement;
  private readonly endTitle: HTMLElement;
  private readonly endSubtitle: HTMLElement;
  private hideBannerTimer = 0;

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
    this.flagStatus = this.query('#flag-status');
    this.gateStatus = this.query('#gate-status');
    this.alertBanner = this.query('#alert-banner');
    this.energyFill = this.query('#energy-fill');
    this.energyText = this.query('#energy-text');
    this.enemyEnergyFill = this.query('#enemy-energy-fill');
    this.endOverlay = this.query('#end-overlay');
    this.endTitle = this.query('#end-title');
    this.endSubtitle = this.query('#end-subtitle');

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

    if (state.flagStatus === 'carried') {
      this.flagStatus.textContent = state.flagCarrier === 'blue' ? 'BLUE CARRYING FLAG' : 'RED CARRYING FLAG';
      this.flagStatus.dataset.team = state.flagCarrier ?? '';
    } else if (state.flagStatus === 'dropped') {
      this.flagStatus.textContent = 'FLAG DROPPED';
      this.flagStatus.dataset.team = '';
    } else if (state.flagStatus === 'resetting') {
      this.flagStatus.textContent = 'FLAG RESETTING';
      this.flagStatus.dataset.team = '';
    } else {
      this.flagStatus.textContent = 'FLAG AT CENTER';
      this.flagStatus.dataset.team = '';
    }

    if (state.blueGateTime > 0) {
      this.gateStatus.textContent = `RED GATE OPEN • ${Math.ceil(state.blueGateTime)}s`;
      this.gateStatus.dataset.team = 'blue';
    } else if (state.redGateTime > 0) {
      this.gateStatus.textContent = `BLUE GATE OPEN • ${Math.ceil(state.redGateTime)}s`;
      this.gateStatus.dataset.team = 'red';
    } else {
      this.gateStatus.textContent = 'CAPTURE FLAG TO OPEN ENEMY GATE';
      this.gateStatus.dataset.team = '';
    }

    if (state.breachedTeam) {
      const enemyBreached = state.breachedTeam === 'red';
      this.alertBanner.textContent = `${enemyBreached ? 'ENEMY' : 'YOUR'} CASTLE BREACHED • ${Math.ceil(state.breachCountdown)}`;
      this.alertBanner.classList.add('persistent', enemyBreached ? 'success' : 'danger');
      this.alertBanner.classList.remove(enemyBreached ? 'danger' : 'success');
    }

    this.gateStatus.textContent = normalizeDisplayText(this.gateStatus.textContent ?? '');
    this.alertBanner.textContent = normalizeDisplayText(this.alertBanner.textContent ?? '');

    for (const [kind, button] of this.cardButtons) {
      const unaffordable = state.playerEnergy + 0.001 < UNIT_STATS[kind].cost;
      button.classList.toggle('selected', state.selectedKind === kind);
      button.classList.toggle('disabled', unaffordable || state.playerLocked);
      button.disabled = state.playerLocked;
      button.setAttribute('aria-pressed', String(state.selectedKind === kind));
      button.setAttribute('aria-disabled', String(unaffordable || state.playerLocked));
    }
  }

  showBanner(message: string, tone: 'neutral' | 'success' | 'danger' = 'neutral', seconds = 1.8): void {
    if (this.alertBanner.classList.contains('persistent')) return;
    this.alertBanner.textContent = normalizeDisplayText(message);
    this.alertBanner.className = `alert-banner visible ${tone}`;
    window.clearTimeout(this.hideBannerTimer);
    this.hideBannerTimer = window.setTimeout(() => {
      if (!this.alertBanner.classList.contains('persistent')) this.alertBanner.className = 'alert-banner';
    }, seconds * 1000);
  }

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

      <header class="top-hud">
        <div class="identity identity-blue"><b>YOU</b><span>BLUE CITADEL</span></div>
        <div class="match-center">
          <div id="match-timer" class="match-timer">3:00</div>
        </div>
        <div class="identity identity-red"><b>RIVAL</b><span>RED CITADEL</span><i><em id="enemy-energy-fill"></em></i></div>
        <div class="objective-status">
          <div id="flag-status" class="flag-status">FLAG AT CENTER</div>
          <div id="gate-status" class="gate-status">CAPTURE FLAG TO OPEN ENEMY GATE</div>
        </div>
      </header>

      <div id="alert-banner" class="alert-banner"></div>

      <footer class="bottom-hud">
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
