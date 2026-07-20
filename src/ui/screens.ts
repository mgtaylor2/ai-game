export type Screen = 'menu' | 'countdown' | 'racing' | 'paused' | 'results';

/**
 * Owns full-screen overlay DOM for the various game screens.
 * Dumb by design: it renders overlays, toggles their visibility, and reports
 * button clicks. All game logic (resetting the race, moving the camera, etc.)
 * lives in main.ts.
 */
export class ScreenManager {
  private current: Screen = 'menu';
  private readonly menuEl: HTMLDivElement;
  private readonly countdownEl: HTMLDivElement;
  private lastCountdownText = '';
  private readonly startCallbacks: Array<() => void> = [];

  constructor(root: HTMLElement) {
    this.menuEl = document.createElement('div');
    this.menuEl.id = 'menu-screen';
    this.menuEl.className = 'screen-overlay';
    this.menuEl.innerHTML = `
      <h1 class="screen-title">KART RACER</h1>
      <button id="start-race-button" class="screen-button" type="button">Start Race</button>
    `;
    root.appendChild(this.menuEl);

    // Countdown number floats over the visible game — no dark backdrop.
    this.countdownEl = document.createElement('div');
    this.countdownEl.id = 'countdown-overlay';
    this.countdownEl.className = 'hidden';
    root.appendChild(this.countdownEl);

    const startButton = this.menuEl.querySelector<HTMLButtonElement>('#start-race-button');
    startButton?.addEventListener('click', () => {
      for (const cb of this.startCallbacks) cb();
    });

    this.show('menu');
  }

  /** Register a callback fired when the "Start Race" button is clicked. */
  onStart(cb: () => void): void {
    this.startCallbacks.push(cb);
  }

  /** Update the big countdown text ("3", "2", "1", "GO!"); no-op if unchanged. */
  setCountdownText(text: string): void {
    if (text === this.lastCountdownText) return;
    this.lastCountdownText = text;
    this.countdownEl.textContent = text;
  }

  /** Hide the countdown overlay (used when "GO!" finishes fading during racing). */
  hideCountdown(): void {
    this.countdownEl.classList.add('hidden');
  }

  show(screen: Screen): void {
    this.current = screen;
    // Paused/results overlays will be added here in later tasks.
    this.menuEl.classList.toggle('hidden', screen !== 'menu');
    if (screen === 'countdown') {
      this.countdownEl.classList.remove('hidden');
    } else if (screen !== 'racing') {
      // Leave it alone on 'racing' so "GO!" can linger briefly after the race
      // starts; main.ts hides it via hideCountdown(). Any other screen kills it.
      this.hideCountdown();
    }
  }

  getCurrent(): Screen {
    return this.current;
  }
}
