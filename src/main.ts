import { Engine } from '@babylonjs/core';
import { PORTRAIT_LAYOUT, QUALITY_SETTINGS } from './core/config';
import type { QualityTier } from './core/types';
import { GameUI } from './ui/gameUI';
import './styles.css';

const canvas = document.querySelector<HTMLCanvasElement>('#game-canvas')!;
const uiRoot = document.querySelector<HTMLElement>('#app-ui')!;
const gameShell = document.querySelector<HTMLElement>('#game-shell')!;
if (!canvas || !uiRoot || !gameShell) throw new Error('Missing game canvas, shell, or UI root');


type TelegramWebApp = {
  ready?: () => void;
  expand?: () => void;
  requestFullscreen?: () => void;
  viewportHeight?: number;
  viewportStableHeight?: number;
  onEvent?: (event: string, callback: (event?: { isStateStable?: boolean }) => void) => void;
};

const telegram = (window as typeof window & { Telegram?: { WebApp?: TelegramWebApp } }).Telegram?.WebApp;
telegram?.ready?.();
telegram?.expand?.();
document.documentElement.style.setProperty('--portrait-max-width', `${PORTRAIT_LAYOUT.viewport.desktopMaxWidth}px`);

const defaultQuality = detectQuality();
const ui = new GameUI(uiRoot, defaultQuality);
let engine: Engine | null = null;
let game: import('./game/gameController').GameController | null = null;
let arena: import('./render/arena').ArenaScene | null = null;
let prepared = false;
let hidden = document.hidden;
let telegramViewportIsStable = false;
let resizeTimer = 0;

const applyViewportMetrics = (): void => {
  const visualViewport = window.visualViewport;
  const fallbackHeight = visualViewport?.height ?? window.innerHeight;
  const fallbackWidth = visualViewport?.width ?? window.innerWidth;
  const telegramHeight = telegramViewportIsStable
    ? positiveNumber(telegram?.viewportStableHeight) ?? positiveNumber(telegram?.viewportHeight)
    : positiveNumber(telegram?.viewportHeight);
  const viewportHeight = Math.max(1, Math.round(telegramHeight ?? fallbackHeight));
  const viewportWidth = Math.max(1, Math.round(fallbackWidth));
  const portraitWidth = Math.min(
    viewportWidth,
    PORTRAIT_LAYOUT.viewport.desktopMaxWidth,
    viewportHeight * PORTRAIT_LAYOUT.viewport.desktopMaxAspect,
  );

  document.documentElement.style.setProperty('--app-height', `${viewportHeight}px`);
  document.documentElement.style.setProperty('--portrait-width', `${Math.round(portraitWidth)}px`);
  engine?.resize();
  arena?.resizeCamera();
};

const scheduleViewportRefresh = (event?: { isStateStable?: boolean }): void => {
  if (typeof event?.isStateStable === 'boolean') telegramViewportIsStable = event.isStateStable;
  window.clearTimeout(resizeTimer);
  resizeTimer = window.setTimeout(() => requestAnimationFrame(applyViewportMetrics), PORTRAIT_LAYOUT.viewport.resizeDebounceMs);
};

applyViewportMetrics();
window.addEventListener('resize', () => scheduleViewportRefresh(), { passive: true });
window.addEventListener('orientationchange', () => scheduleViewportRefresh(), { passive: true });
window.visualViewport?.addEventListener('resize', () => scheduleViewportRefresh(), { passive: true });
document.addEventListener('fullscreenchange', () => scheduleViewportRefresh(), { passive: true });
screen.orientation?.addEventListener('change', () => scheduleViewportRefresh());
telegram?.onEvent?.('viewportChanged', scheduleViewportRefresh);

ui.onPrepare = (quality) => {
  if (prepared) return;
  prepared = true;
  void prepareGame(quality);
};

ui.onStart = () => {
  try { telegram?.requestFullscreen?.(); } catch { /* Optional Telegram capability. */ }
  game?.start();
};
ui.onRestart = () => window.location.reload();

async function prepareGame(quality: QualityTier): Promise<void> {
  try {
    ui.setLoading(0.08, 'Starting WebGL renderer');
    await nextFrame();
    const settings = QUALITY_SETTINGS[quality];
    engine = new Engine(canvas, settings.antialias, {
      powerPreference: 'high-performance',
      preserveDrawingBuffer: false,
      stencil: false,
      premultipliedAlpha: false,
    }, false);
    engine.setHardwareScalingLevel(settings.hardwareScaling);

    ui.setLoading(0.26, 'Building battlefield and castles');
    const [{ createArenaScene }, { GameController }, { AudioManager }] = await Promise.all([
      import('./render/arena'),
      import('./game/gameController'),
      import('./audio/audioManager'),
    ]);
    await nextFrame();
    arena = createArenaScene(engine, canvas, quality);
    applyViewportMetrics();

    ui.setLoading(0.57, 'Creating four animated unit squads');
    await nextFrame();
    const audio = new AudioManager();
    game = new GameController(arena, canvas, ui, audio);

    ui.setLoading(0.83, 'Linking flag, AI, combat and castle breach');
    await nextFrame();
    arena.scene.render();

    const renderLoop = (): void => {
      if (!engine || !arena) return;
      if (!hidden) game?.update(engine.getDeltaTime() / 1000);
      arena.scene.render();
    };
    engine.runRenderLoop(renderLoop);

    document.addEventListener('visibilitychange', () => {
      hidden = document.hidden;
      if (!engine) return;
      if (hidden) engine.stopRenderLoop(renderLoop);
      else engine.runRenderLoop(renderLoop);
    });

    ui.setLoading(1, 'Arena ready');
    ui.showStartButton();
  } catch (error) {
    console.error(error);
    ui.setLoading(0, `Failed to prepare arena: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

function detectQuality(): QualityTier {
  const nav = navigator as Navigator & { deviceMemory?: number };
  const memory = nav.deviceMemory ?? 4;
  const cores = navigator.hardwareConcurrency ?? 4;
  const isMobile = matchMedia('(pointer: coarse)').matches || /Android|iPhone|iPad/i.test(navigator.userAgent);
  if (isMobile && (memory <= 3 || cores <= 4)) return 'low';
  if (!isMobile && memory >= 8 && cores >= 8) return 'high';
  return 'standard';
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

function positiveNumber(value: number | undefined): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined;
}

window.addEventListener('beforeunload', () => {
  window.clearTimeout(resizeTimer);
  game?.dispose();
  arena?.scene.dispose();
  engine?.dispose();
});
