import { CONFIG, UNIT_LABELS, UNIT_STATS } from '../core/config';
import type { CastleState, SiegeStage, Team, UnitKind } from '../core/types';
import type { FlagStatus } from '../game/flag';

const MOJIBAKE_REPLACEMENTS: ReadonlyArray<readonly [string, string]> = [
  [String.fromCharCode(0x00e2, 0x20ac, 0x201d), '\u2014'],
  [String.fromCharCode(0x00e2, 0x20ac, 0x00a2), '\u2022'],
  [String.fromCharCode(0x00e2, 0x0161, 0x2018), '\u2691'],
  [String.fromCharCode(0x00e2, 0x0161, 0x201d), '\u2694'],
];

/**
 * One side's reading of the single shared siege bar. Stage 1 feeds it gate HP, stage 2 feeds it
 * castle HP \u2014 the bar itself is never replaced, only re-labelled and re-filled.
 */
export interface SiegeHudState {
  readonly stage: SiegeStage;
  readonly hp: number;
  readonly maxHp: number;
  readonly ratio: number;
  /** Below CONFIG.gate.warningRatio \u2014 the bar shifts amber. */
  readonly warning: boolean;
  /** Below CONFIG.gate.criticalRatio \u2014 amber becomes red and the warning pulse starts. */
  readonly critical: boolean;
  /** 0..1 HUD-only shake budget. Never sourced from, or routed to, the camera. */
  readonly shake: number;
}

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
  readonly playerSiege: SiegeHudState;
  readonly playerCastleState: CastleState;
  readonly playerCastleCountdown: number;
  readonly playerFlagSecured: boolean;
  readonly enemySiege: SiegeHudState;
  readonly enemyCastleState: CastleState;
  readonly enemyCastleCountdown: number;
  readonly enemyFlagSecured: boolean;
}

export class GameUI {
  private readonly root: HTMLElement;
  private readonly loadingOverlay: HTMLElement;
  private readonly loadButton: HTMLButtonElement;
  private readonly startButton: HTMLButtonElement;
  private readonly progressFill: HTMLElement;
  private readonly loadingLabel: HTMLElement;
  private readonly timer: HTMLElement;
  private readonly energyFill: HTMLElement;
  private readonly energyText: HTMLElement;
  private readonly enemyEnergyFill: HTMLElement;
  private readonly castlePanel: HTMLElement;
  private readonly castleStateLabel: HTMLElement;
  private readonly castleFlag: HTMLElement;
  private readonly enemyCastleStrip: HTMLElement;
  private readonly enemyCastleStateLabel: HTMLElement;
  private readonly enemyCastleFlag: HTMLElement;
  private readonly playerDamageFlash: CastleDamageFlash;
  private readonly enemyDamageFlash: CastleDamageFlash;
  /** The one shared siege meter per side: stage 1 reads gate HP, stage 2 the castle's. */
  private readonly playerSiege: SiegeMeter;
  private readonly enemySiege: SiegeMeter;
  private meterFrame = 0;
  private meterClock = 0;
  private readonly cardButtons = new Map<UnitKind, HTMLButtonElement>();
  private readonly endOverlay: HTMLElement;
  private readonly endTitle: HTMLElement;
  private readonly endSubtitle: HTMLElement;
  private lastPlayerHp = 0;
  private lastEnemyHp = 0;
  private collapseTimer: number | undefined;
  private enemyCollapseTimer: number | undefined;
  private readonly castleAttentionMs = 2600;

  onPrepare: () => void = () => undefined;
  onStart: () => void = () => undefined;
  onCardSelect: (kind: UnitKind) => void = () => undefined;
  onRestart: () => void = () => window.location.reload();

  constructor(root: HTMLElement) {
    this.root = root;
    this.root.innerHTML = normalizeDisplayText(this.template());
    this.loadingOverlay = this.query('#loading-overlay');
    this.loadButton = this.query<HTMLButtonElement>('#load-arena');
    this.startButton = this.query<HTMLButtonElement>('#start-battle');
    this.progressFill = this.query('#loading-progress-fill');
    this.loadingLabel = this.query('#loading-label');
    this.timer = this.query('#match-timer');
    this.energyFill = this.query('#energy-fill');
    this.energyText = this.query('#energy-text');
    this.enemyEnergyFill = this.query('#enemy-energy-fill');
    this.castlePanel = this.query('#player-castle-panel');
    this.castleStateLabel = this.query('#player-castle-state');
    this.castleFlag = this.query('#player-castle-flag');
    this.enemyCastleStrip = this.query('#enemy-castle-strip');
    this.enemyCastleStateLabel = this.query('#enemy-castle-state');
    this.enemyCastleFlag = this.query('#enemy-castle-flag');
    const reducedMotion = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.playerDamageFlash = new CastleDamageFlash(this.query('#player-castle-flash'), reducedMotion);
    this.enemyDamageFlash = new CastleDamageFlash(this.query('#enemy-castle-flash'), reducedMotion);
    this.playerSiege = new SiegeMeter({
      root: this.castlePanel,
      fill: this.query('#player-castle-fill'),
      trail: this.query('#player-castle-trail'),
      hp: this.query('#player-castle-hp'),
      sigil: this.query('#player-castle-sigil'),
      breachTag: this.query('#player-breach-tag'),
      sweep: this.query('#player-castle-sweep'),
      reducedMotion,
    });
    this.enemySiege = new SiegeMeter({
      root: this.enemyCastleStrip,
      fill: this.query('#enemy-castle-fill'),
      trail: this.query('#enemy-castle-trail'),
      hp: this.query('#enemy-castle-hp'),
      sigil: this.query('#enemy-castle-sigil'),
      breachTag: this.query('#enemy-breach-tag'),
      sweep: this.query('#enemy-castle-sweep'),
      reducedMotion,
      compact: true,
    });
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

    for (const kind of ['brax', 'nyx', 'vex', 'fuse'] as const) {
      const button = this.query<HTMLButtonElement>(`[data-card="${kind}"]`);
      button.addEventListener('pointerdown', (event) => {
        event.preventDefault();
        event.stopPropagation();
        this.onCardSelect(kind);
      });
      this.cardButtons.set(kind, button);
    }

    // Portrait assets are loaded once per unit type. If a file is missing (or fails on a slow
    // connection) the img is removed so the card keeps its role-tinted well instead of a broken
    // image icon — the card frame, name and cost stay fully usable either way.
    for (const image of this.root.querySelectorAll<HTMLImageElement>('.card-art')) {
      image.addEventListener('error', () => image.remove(), { once: true });
    }

    this.loadButton.addEventListener('click', () => {
      this.loadButton.disabled = true;
      this.onPrepare();
    });
    this.startButton.addEventListener('click', () => this.onStart());
    this.query<HTMLButtonElement>('#restart-button').addEventListener('click', () => this.onRestart());
    this.startMeterLoop();
  }

  /**
   * The siege meters animate on their own rAF loop rather than on HUD updates: GameController
   * throttles update() to 10 Hz, which is far too coarse for a smooth fill, a delayed damage trail
   * or a decaying shake.
   */
  private startMeterLoop(): void {
    const tick = (now: number): void => {
      const previous = this.meterClock;
      this.meterClock = now;
      const delta = previous === 0 ? 0.016 : Math.min(0.05, (now - previous) / 1000);
      this.playerSiege.tick(delta);
      this.enemySiege.tick(delta);
      this.meterFrame = requestAnimationFrame(tick);
    };
    this.meterFrame = requestAnimationFrame(tick);
  }

  /** Stops the meter loop; called from the controller's dispose path. */
  disposeMeters(): void {
    if (this.meterFrame) cancelAnimationFrame(this.meterFrame);
    this.meterFrame = 0;
  }

  /** One controlled per-hit pulse on the side that was struck. `strong` adds the HUD-only shake. */
  pulseSiegeHit(side: 'player' | 'enemy', strong: boolean): void {
    const meter = side === 'player' ? this.playerSiege : this.enemySiege;
    meter.pulse(strong);
    this.setCastleExpanded(side, true);
    this.scheduleCastleCollapse(side);
  }

  /** Transient "GATE BREACHED" tag above the bar, then the gate → castle transformation sweep. */
  announceGateBreach(side: 'player' | 'enemy'): void {
    const meter = side === 'player' ? this.playerSiege : this.enemySiege;
    meter.announceBreach();
    this.setCastleExpanded(side, true);
    this.scheduleCastleCollapse(side);
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

    const playerCastleHp = Math.max(0, Math.round(state.playerSiege.hp));
    const enemyCastleHp = Math.max(0, Math.round(state.enemySiege.hp));
    const playerDamaged = playerCastleHp < this.lastPlayerHp;
    const enemyDamaged = enemyCastleHp < this.lastEnemyHp;
    this.lastPlayerHp = playerCastleHp;
    this.lastEnemyHp = enemyCastleHp;
    this.playerSiege.setState(state.playerSiege);
    this.enemySiege.setState(state.enemySiege);
    this.castleStateLabel.textContent = siegeStateText(state.playerSiege.stage, state.playerCastleState, state.playerCastleCountdown, false);
    this.enemyCastleStateLabel.textContent = siegeStateText(state.enemySiege.stage, state.enemyCastleState, state.enemyCastleCountdown, true);
    this.castlePanel.classList.toggle('open', state.playerCastleState === 'open');
    this.castlePanel.classList.toggle('breached', state.playerCastleState === 'breached');
    this.enemyCastleStrip.classList.toggle('open', state.enemyCastleState === 'open');
    this.enemyCastleStrip.classList.toggle('breached', state.enemyCastleState === 'breached');
    const playerPinned = state.playerCastleState === 'open' || state.playerCastleState === 'breached';
    const enemyPinned = state.enemyCastleState === 'open' || state.enemyCastleState === 'breached';
    this.updateCastleAttention('player', playerPinned, playerDamaged);
    this.updateCastleAttention('enemy', enemyPinned, enemyDamaged);
    this.setFlagSecured(this.castleFlag, state.playerFlagSecured, 'secured in your castle');
    this.setFlagSecured(this.enemyCastleFlag, state.enemyFlagSecured, 'secured in the enemy castle');
    this.playerDamageFlash.pulse(playerCastleHp, state.playerSiege.maxHp, state.playerCastleState === 'breached');
    this.enemyDamageFlash.pulse(enemyCastleHp, state.enemySiege.maxHp, state.enemyCastleState === 'breached');

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

  private template(): string {
    const cards = (['brax', 'nyx', 'vex', 'fuse'] as const).map((kind) => `
      <button class="unit-card" data-card="${kind}" type="button" aria-label="Deploy ${UNIT_LABELS[kind]}">
        <span class="card-portrait portrait-${kind}"><img class="card-art" src="/assets/ui/units/${kind}-card.webp" alt="" loading="lazy" decoding="async" draggable="false" /></span>
        <span class="card-info">
          <strong>${UNIT_LABELS[kind]}</strong>
          <small>${kind === 'brax' ? 'Frontline bruiser' : kind === 'nyx' ? 'Precision range' : kind === 'vex' ? 'Fast objective' : 'Siege bomber'}</small>
        </span>
        <span class="card-cost">${UNIT_STATS[kind].cost}</span>
      </button>
    `).join('');

    return `
      <section id="loading-overlay" class="loading-overlay">
        <div class="loading-card">
          <div class="brand-lockup">
            ${this.brandCrest()}
            <p class="eyebrow">MOBILE 3D STRATEGY</p>
            <h1 class="brand-title">
              <span class="brand-word brand-word-battle">BATTLE</span>
              <span class="brand-word brand-word-flag">FLAG</span>
            </h1>
            <span class="brand-rule" aria-hidden="true"></span>
          </div>
          <p class="loading-copy">Capture the banner. Break the gate. Infiltrate the fortress.</p>
          <ul class="brand-pillars" aria-hidden="true">
            <li>3D ARENA</li>
            <li>REAL-TIME</li>
            <li>4 SQUADS</li>
          </ul>
          <div class="loading-progress"><i id="loading-progress-fill"></i></div>
          <p id="loading-label" class="loading-label">Forge the arena to begin your campaign</p>
          <button id="load-arena" class="primary-button" type="button">PREPARE ARENA</button>
          <button id="start-battle" class="primary-button pulse" type="button" hidden disabled>START BATTLE</button>
        </div>
      </section>

      <div id="hud-top-strip"></div>

      <div id="enemy-castle-strip" class="castle-strip">
        <div class="castle-strip-inner">
          <span id="enemy-castle-sigil" class="castle-strip-sigil siege-sigil" aria-hidden="true">
            ${this.siegeIcons()}
            <i class="castle-core"></i>
          </span>
          <span class="castle-folder">
            <span id="enemy-breach-tag" class="breach-tag">GATE BREACHED</span>
            <span class="castle-meta">
              <small id="enemy-castle-state" class="castle-state">GATE</small>
              <b id="enemy-castle-hp" class="castle-hp">900/900</b>
            </span>
            <span class="castle-bar">
              <u id="enemy-castle-trail"></u>
              <i id="enemy-castle-fill"></i>
              <em id="enemy-castle-flash"></em>
              <s id="enemy-castle-sweep"></s>
            </span>
          </span>
          <span id="enemy-castle-flag" class="flag-chip" role="img" aria-label="Flag not secured">
            <svg viewBox="0 0 24 24"><path class="pole" d="M7 22V2h2v20z"/><path class="cloth" d="M9 3l12 5-12 5z"/></svg>
          </span>
        </div>
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
        <div id="player-castle-panel" class="castle-panel" role="button" tabindex="0" aria-expanded="false" aria-label="Siege integrity. Activate to expand details.">
          <span id="player-castle-sigil" class="castle-sigil siege-sigil" aria-hidden="true">
            ${this.siegeIcons()}
            <i class="castle-core"></i>
          </span>
          <span class="castle-folder">
            <span id="player-breach-tag" class="breach-tag">GATE BREACHED</span>
            <span class="castle-meta">
              <small id="player-castle-state" class="castle-state">GATE</small>
              <b id="player-castle-hp" class="castle-hp">900 / 900</b>
            </span>
            <span class="castle-bar">
              <u id="player-castle-trail"></u>
              <i id="player-castle-fill"></i>
              <em id="player-castle-flash"></em>
              <s id="player-castle-sweep"></s>
            </span>
          </span>
          <span id="player-castle-flag" class="flag-chip" role="img" aria-label="Flag not secured">
            <svg viewBox="0 0 24 24"><path class="pole" d="M7 22V2h2v20z"/><path class="cloth" d="M9 3l12 5-12 5z"/></svg>
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

  /**
   * Both siege glyphs live in the same sigil: a portcullis for stage 1 and the fortress for stage 2.
   * The stage swap is a CSS crossfade on the sigil's `data-stage`, so no element is created or removed
   * when the bar transforms.
   */
  private siegeIcons(): string {
    return `
      <svg class="siege-glyph siege-glyph-gate" viewBox="0 0 24 24" aria-hidden="true">
        <path class="gate-arch" d="M3 21V9a9 9 0 0 1 18 0v12h-3V9a6 6 0 0 0-12 0v12z"/>
        <path class="gate-grid" d="M8 21V10M12 21V9.4M16 21V10M7.4 13h9.2M7.4 16.4h9.2M7.4 19.4h9.2"/>
      </svg>
      <svg class="siege-glyph siege-glyph-castle" viewBox="0 0 24 24" aria-hidden="true">
        <path class="castle-body" d="M4 21V3h3v4h4V3h4v4h3V3h4v18H4z"/>
        <path class="castle-door" d="M10.5 21v-5a3 3 0 0 1 3-3 3 3 0 0 1 3 3v5z"/>
        <path class="castle-grate" d="M11.6 17h3.8M11.3 18.8h4.4"/>
      </svg>
    `;
  }

  /**
   * Brand mark for "Battle Flag": a gold-crowned heater shield over a fortress silhouette,
   * flanked by two crossed banners. Pure inline SVG (no image request, no filters) so it stays
   * cheap on mobile and inside the Telegram Mini App webview.
   */
  private brandCrest(): string {
    return `
      <span class="brand-crest" role="img" aria-label="Battle Flag emblem">
        <svg viewBox="0 0 120 120" aria-hidden="true">
          <defs>
            <linearGradient id="crest-gold" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stop-color="#fff3c4"/>
              <stop offset=".45" stop-color="#f0c153"/>
              <stop offset="1" stop-color="#b7842a"/>
            </linearGradient>
            <linearGradient id="crest-shield" x1=".2" y1="0" x2=".8" y2="1">
              <stop offset="0" stop-color="#3d7fc4"/>
              <stop offset=".55" stop-color="#1e558f"/>
              <stop offset="1" stop-color="#123a66"/>
            </linearGradient>
            <linearGradient id="crest-banner-left" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stop-color="#2f6fb0"/>
              <stop offset="1" stop-color="#17456f"/>
            </linearGradient>
            <linearGradient id="crest-banner-right" x1="1" y1="0" x2="0" y2="1">
              <stop offset="0" stop-color="#e9b84a"/>
              <stop offset="1" stop-color="#b07f24"/>
            </linearGradient>
          </defs>

          <g class="crest-banners">
            <path class="crest-pole" d="M27 20h4l3 84h-4z"/>
            <path class="crest-pole" d="M89 20h4l-3 84h-4z"/>
            <path fill="url(#crest-banner-left)" d="M31 26l26 9-4 26-25-10z"/>
            <path fill="url(#crest-banner-right)" d="M89 26L63 35l4 26 25-10z"/>
          </g>

          <path class="crest-shield-edge" d="M60 16l38 11v34c0 25-16 40-38 47-22-7-38-22-38-47V27z"/>
          <path fill="url(#crest-shield)" d="M60 21l33 10v30c0 22-14 35-33 41-19-6-33-19-33-41V31z"/>
          <path class="crest-shield-gloss" d="M60 21v81c-19-6-33-19-33-41V31z"/>

          <g class="crest-keep">
            <path d="M41 78V52h6v6h6v-6h6v6h6v-6h6v26z"/>
            <path class="crest-keep-gate" d="M55 78V66a5 5 0 0 1 10 0v12z"/>
            <path class="crest-keep-tower" d="M47 52V44h6v8zM67 52V44h6v8z"/>
          </g>

          <path class="crest-crown" fill="url(#crest-gold)" d="M60 4l7 9 9-6-2 12H46l-2-12 9 6z"/>
          <circle class="crest-crown-jewel" cx="60" cy="9" r="2.6"/>
        </svg>
      </span>
    `;
  }

  private setFlagSecured(element: HTMLElement, secured: boolean, securedLabel: string): void {
    element.classList.toggle('secured', secured);
    element.setAttribute('aria-label', secured ? `Flag ${securedLabel}` : 'Flag not secured');
  }

  private updateCastleAttention(side: 'player' | 'enemy', pinnedOpen: boolean, damaged: boolean): void {
    if (pinnedOpen) {
      this.setCastleExpanded(side, true);
      this.clearCastleCollapse(side);
      return;
    }
    if (damaged) {
      // The per-hit flash itself comes from pulseSiegeHit (driven by the authoritative hit
      // reactions); this only keeps the folder open while damage is landing.
      this.setCastleExpanded(side, true);
      this.scheduleCastleCollapse(side);
    }
  }

  private setCastleExpanded(side: 'player' | 'enemy', expanded: boolean): void {
    const panel = side === 'player' ? this.castlePanel : this.enemyCastleStrip;
    panel.classList.toggle('expanded', expanded);
    if (side === 'player') panel.setAttribute('aria-expanded', String(expanded));
  }

  private clearCastleCollapse(side: 'player' | 'enemy'): void {
    const timer = side === 'player' ? 'collapseTimer' : 'enemyCollapseTimer';
    if (this[timer] !== undefined) {
      window.clearTimeout(this[timer]);
      this[timer] = undefined;
    }
  }

  private scheduleCastleCollapse(side: 'player' | 'enemy'): void {
    const timer = side === 'player' ? 'collapseTimer' : 'enemyCollapseTimer';
    this.clearCastleCollapse(side);
    this[timer] = window.setTimeout(() => {
      this[timer] = undefined;
      const panel = side === 'player' ? this.castlePanel : this.enemyCastleStrip;
      if (panel.classList.contains('open') || panel.classList.contains('breached')) return;
      this.setCastleExpanded(side, false);
    }, this.castleAttentionMs);
  }

  private toggleCastle(): void {
    if (this.castlePanel.classList.contains('expanded')) {
      this.setCastleExpanded('player', false);
    } else {
      this.setCastleExpanded('player', true);
      this.scheduleCastleCollapse('player');
    }
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

/**
 * Label for the shared siege bar. Stage 1 reads GATE (plus the gate's live state); stage 2 reads
 * CASTLE INTEGRITY, and keeps the existing open/breached countdown copy so nothing regresses.
 */
function siegeStateText(stage: SiegeStage, state: CastleState, countdown: number, compact: boolean): string {
  if (stage === 'gate') {
    if (state === 'secure') return 'GATE';
    const gateSeconds = Math.max(1, Math.ceil(countdown));
    if (state === 'breached') return compact ? `BREACHED ${gateSeconds}s` : `BREACHED \u00b7 ${gateSeconds}s`;
    return compact ? `GATE OPEN ${gateSeconds}s` : `GATE OPEN \u00b7 ${gateSeconds}s`;
  }
  if (state === 'secure') return compact ? 'CASTLE' : 'CASTLE INTEGRITY';
  const seconds = Math.max(1, Math.ceil(countdown));
  if (state === 'breached') {
    return compact ? `BREACHED ${seconds}s` : `BREACHED \u00b7 ${seconds}s`;
  }
  return compact ? `OPEN ${seconds}s` : `CASTLE \u00b7 OPEN ${seconds}s`;
}

interface SiegeMeterElements {
  readonly root: HTMLElement;
  readonly fill: HTMLElement;
  readonly trail: HTMLElement;
  readonly hp: HTMLElement;
  readonly sigil: HTMLElement;
  readonly breachTag: HTMLElement;
  readonly sweep: HTMLElement;
  readonly reducedMotion: boolean;
  readonly compact?: boolean;
}

/**
 * The single shared siege meter. It owns one bar for both stages: gate HP first, then castle HP after
 * the breach, with the label, icon and colours transforming in place. Everything animates on the UI
 * layer's own rAF tick (the HUD state itself only refreshes at 10 Hz), and every effect is a CSS class
 * or an inline width/transform — no canvas, no per-frame allocation, nothing that touches the camera.
 */
class SiegeMeter {
  private stage: SiegeStage = 'gate';
  /** Displayed ratio, eased toward the authoritative one so HP loss never snaps. */
  private shown = 1;
  /** Delayed trail ratio: holds behind the fill, then catches up. */
  private trail = 1;
  private trailHold = 0;
  private target = 1;
  private hp = 0;
  private maxHp = 1;
  private shake = 0;
  private lastLabel = '';
  private pulseTimer: number | undefined;
  private breachTagTimer: number | undefined;
  private transitioning = false;

  constructor(private readonly el: SiegeMeterElements) {
    this.el.sigil.dataset.stage = 'gate';
    this.el.root.classList.add('siege-gate');
  }

  /** Pushes the authoritative reading in. Detects the stage change and starts the sweep once. */
  setState(state: SiegeHudState): void {
    if (state.stage !== this.stage) {
      this.stage = state.stage;
      this.beginStageTransition();
    }
    this.hp = Math.max(0, Math.round(state.hp));
    this.maxHp = Math.max(1, Math.round(state.maxHp));
    this.target = Math.max(0, Math.min(1, state.ratio));
    this.shake = Math.max(this.shake, state.shake);
    const label = this.el.compact ? `${this.hp}/${this.maxHp}` : `${this.hp} / ${this.maxHp}`;
    if (label !== this.lastLabel) {
      this.lastLabel = label;
      this.el.hp.textContent = label;
    }
    this.el.root.classList.toggle('siege-warning', state.warning && !state.critical);
    this.el.root.classList.toggle('siege-critical', state.critical);
  }

  /** Per-frame easing for the fill, the delayed trail and the HUD-only shake. */
  tick(deltaSeconds: number): void {
    if (this.el.reducedMotion) {
      this.shown = this.target;
      this.trail = this.target;
      this.el.fill.style.width = `${this.target * 100}%`;
      this.el.trail.style.width = `${this.target * 100}%`;
      return;
    }
    if (Math.abs(this.shown - this.target) > 0.0005) {
      // Exponential approach: fast at first, settling smoothly — no visible step.
      this.shown += (this.target - this.shown) * Math.min(1, deltaSeconds * 7.5);
      this.el.fill.style.width = `${Math.max(0, this.shown) * 100}%`;
    }
    if (this.trail > this.shown) {
      // The trail lingers where the HP used to be, then slides down to meet the fill.
      this.trailHold = Math.max(0, this.trailHold - deltaSeconds);
      if (this.trailHold <= 0) {
        this.trail += (this.shown - this.trail) * Math.min(1, deltaSeconds * 2.6);
        this.el.trail.style.width = `${Math.max(0, this.trail) * 100}%`;
      }
    } else if (this.trail < this.shown) {
      this.trail = this.shown;
      this.el.trail.style.width = `${this.trail * 100}%`;
    }
    if (this.shake > 0.001) {
      this.shake = Math.max(0, this.shake - deltaSeconds * 4.4);
      // HUD-only nudge: a sub-pixel translate on the widget, never on the camera.
      const amount = this.shake * (this.el.compact ? 1.1 : 1.8);
      this.el.root.style.transform = `translate3d(${(Math.random() - 0.5) * amount}px, ${(Math.random() - 0.5) * amount * 0.5}px, 0)`;
      if (this.shake === 0) this.el.root.style.transform = '';
    }
  }

  /** One brief, controlled flash per hit. Sets the trail hold so the delayed trail reads clearly. */
  pulse(strong: boolean): void {
    this.trail = Math.max(this.trail, this.shown);
    this.trailHold = strong ? 0.42 : 0.3;
    if (this.el.reducedMotion) return;
    if (strong) this.shake = Math.min(1, this.shake + 0.55);
    this.el.root.classList.remove('siege-hit');
    void this.el.root.offsetWidth;
    this.el.root.classList.add('siege-hit');
    if (this.pulseTimer !== undefined) window.clearTimeout(this.pulseTimer);
    this.pulseTimer = window.setTimeout(() => this.el.root.classList.remove('siege-hit'), 260);
  }

  /** Shows "GATE BREACHED" above the bar for a beat. The stage swap itself is driven by setState. */
  announceBreach(): void {
    this.el.breachTag.classList.add('visible');
    if (this.breachTagTimer !== undefined) window.clearTimeout(this.breachTagTimer);
    this.breachTagTimer = window.setTimeout(() => this.el.breachTag.classList.remove('visible'), 1750);
  }

  /**
   * The gate → castle transformation: the same bar refills from empty behind a short sweep while the
   * sigil crossfades. Quick enough not to hide gameplay, long enough to mark the new phase.
   */
  private beginStageTransition(): void {
    this.el.sigil.dataset.stage = this.stage;
    this.el.root.classList.toggle('siege-gate', this.stage === 'gate');
    this.el.root.classList.toggle('siege-castle', this.stage === 'castle');
    this.el.root.classList.remove('siege-warning', 'siege-critical');
    // Refill from empty so the new pool visibly takes over the bar.
    this.shown = 0;
    this.trail = 0;
    this.trailHold = 0;
    this.el.fill.style.width = '0%';
    this.el.trail.style.width = '0%';
    if (this.el.reducedMotion || this.transitioning) return;
    this.transitioning = true;
    this.el.sweep.classList.remove('sweeping');
    void this.el.sweep.offsetWidth;
    this.el.sweep.classList.add('sweeping');
    window.setTimeout(() => {
      this.el.sweep.classList.remove('sweeping');
      this.transitioning = false;
    }, 620);
  }
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
