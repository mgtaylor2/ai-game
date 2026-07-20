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

  show(screen: Screen): void {
    this.current = screen;
    // Only the menu overlay exists so far; countdown/paused/results overlays
    // will be added here in later tasks.
    this.menuEl.classList.toggle('hidden', screen !== 'menu');
  }

  getCurrent(): Screen {
    return this.current;
  }
}
