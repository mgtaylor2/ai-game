import { CHARACTERS, VEHICLES, type StatTriad } from '../game/roster';

export type Screen = 'loading' | 'menu' | 'mode' | 'character' | 'vehicle' | 'track' | 'preview' | 'countdown' | 'racing' | 'paused' | 'results';
export type Vehicle = 'kart' | 'bike';
export type Character = 'star' | 'dash' | 'bloom';

function statBarsHtml(stats: StatTriad): string {
  const row = (label: string, value: number) =>
    `<div class="stat-row"><span class="stat-label">${label}</span><div class="stat-track"><div class="stat-fill" style="width:${Math.round(value * 100)}%"></div></div></div>`;
  return `<div class="stat-bars">${row('Speed', stats.speed)}${row('Accel', stats.accel)}${row('Handling', stats.handling)}</div>`;
}

const RESULTS_COPY: Record<number, { title: string; tag: string }> = {
  1: { title: 'You Won!', tag: '★ ★ ★' },
  2: { title: 'So Close!', tag: '★ ★' },
  3: { title: 'Nice Race!', tag: '★' },
};

/** Formats a 1-based rank as "1st", "2nd", "3rd", "4th", etc. */
export function formatOrdinal(n: number): string {
  if (n % 10 === 1 && n % 100 !== 11) return `${n}st`;
  if (n % 10 === 2 && n % 100 !== 12) return `${n}nd`;
  if (n % 10 === 3 && n % 100 !== 13) return `${n}rd`;
  return `${n}th`;
}

/** Presents the race flow and leaves game-state decisions to main.ts. */
export class ScreenManager {
  private current: Screen = 'loading';
  private readonly panels = new Map<Screen, HTMLDivElement>();
  private readonly countdownEl: HTMLDivElement;
  private readonly wrongWayEl: HTMLDivElement;
  private lastCountdownText = '';
  private readonly resumeCallbacks: Array<() => void> = [];
  private readonly restartCallbacks: Array<() => void> = [];
  private readonly menuCallbacks: Array<() => void> = [];
  private readonly vehicleCallbacks: Array<(vehicle: Vehicle) => void> = [];
  private readonly trackCallbacks: Array<(trackId: string) => void> = [];
  private readonly characterCallbacks: Array<(character: Character) => void> = [];

  constructor(root: HTMLElement) {
    this.createPanel(root, 'loading', `
      <div class="game-logo"><span>WII-STYLE</span>KART RACER</div>
      <p class="screen-subtitle loading-text">Loading track assets…</p>
    `);
    this.createPanel(root, 'menu', `
      <div class="game-logo"><span>WII-STYLE</span>KART RACER</div>
      <p class="screen-subtitle">A sunny sprint around Seaside Circuit</p>
      <button data-next="mode" class="screen-button screen-button--primary" type="button">Grand Prix</button>
    `);
    this.createPanel(root, 'mode', `
      <h1 class="screen-title">Choose a Mode</h1>
      <div class="cup-grid">
        <button id="grand-prix-button" class="cup-card cup-card--gold" type="button"><span>🏆</span><strong>Grand Prix</strong><small>4 tracks, 4 racers</small></button>
        <div class="cup-card cup-card--locked"><span>🔒</span><strong>Multiplayer</strong><small>Coming soon</small></div>
        <div class="cup-card cup-card--locked"><span>🔒</span><strong>Time Trial</strong><small>Coming soon</small></div>
        <div class="cup-card cup-card--locked"><span>🔒</span><strong>VS Race</strong><small>Coming soon</small></div>
      </div>
    `);
    const characterCards = CHARACTERS.map((character, index) => `
      <button class="selection-card${index === 0 ? ' selected' : ''}" data-character="${character.id}" type="button">
        <span class="driver-icon">${character.icon}</span><strong>${character.name}</strong><small>${character.tagline}</small>
        ${statBarsHtml(character.stats)}
      </button>
    `).join('');
    this.createPanel(root, 'character', `
      <h1 class="screen-title">Choose a Driver</h1>
      <div class="selection-grid" role="list">${characterCards}</div>
      <button data-next="vehicle" class="screen-button screen-button--primary" type="button">Next</button>
    `);
    const vehicleCards = VEHICLES.map((vehicle, index) => `
      <button class="selection-card vehicle-card${index === 0 ? ' selected' : ''}" data-vehicle="${vehicle.id}" type="button">
        <span class="vehicle-icon">${vehicle.icon}</span><strong>${vehicle.name}</strong><small>${vehicle.tagline}</small>
        ${statBarsHtml(vehicle.stats)}
      </button>
    `).join('');
    const lockedVehicles = ['Star Speeder', 'Cloud Cruiser', 'Rocket Bike', 'Comet Cycle'].map((name) => `
      <div class="selection-card vehicle-card selection-card--locked"><span class="vehicle-icon">🔒</span><strong>${name}</strong><small>Unlock later</small></div>
    `).join('');
    this.createPanel(root, 'vehicle', `
      <h1 class="screen-title">Choose Your Ride</h1>
      <div class="selection-grid selection-grid--vehicles">${vehicleCards}${lockedVehicles}</div>
      <button data-next="track" class="screen-button screen-button--primary" type="button">Next</button>
    `);
    this.createPanel(root, 'track', `
      <h1 class="screen-title">Gold Cup</h1><p class="screen-subtitle">Choose a track</p>
      <div class="track-grid">
        <button class="track-card" data-track="seaside" type="button"><span>🌊</span><strong>Seaside Circuit</strong><small>Sunny straights</small></button>
        <button class="track-card" data-track="sunset" type="button"><span>🌅</span><strong>Sunset Speedway</strong><small>Orange horizon</small></button>
        <button class="track-card" data-track="forest" type="button"><span>🌲</span><strong>Pinewood Pass</strong><small>Forest run</small></button>
        <button class="track-card" data-track="candy" type="button"><span>🍬</span><strong>Candy Corner</strong><small>Sweet sprint</small></button>
      </div>
    `);
    this.createPanel(root, 'preview', `<div class="track-preview-label"><span>🏆 Gold Cup</span><strong>Touring the track…</strong></div>`);
    this.createPanel(root, 'paused', `
      <h1 class="screen-title screen-title--pause">Paused</h1>
      <div class="screen-actions"><button id="resume-race-button" class="screen-button" type="button">Resume</button><button data-menu class="screen-button" type="button">Quit to Menu</button></div>
    `);
    this.createPanel(root, 'results', `
      <div class="finish-burst" id="results-burst">★ ★ ★</div>
      <h1 class="screen-title results-title" id="results-title">Finished!</h1>
      <p class="screen-subtitle results-copy" id="results-copy">You crossed the line in <strong>1st place</strong></p>
      <div class="screen-actions"><button id="restart-race-button" class="screen-button screen-button--primary" type="button">Race Again</button><button data-menu class="screen-button" type="button">Back to Menu</button></div>
    `);

    this.countdownEl = document.createElement('div');
    this.countdownEl.id = 'countdown-overlay';
    this.countdownEl.className = 'hidden';
    root.appendChild(this.countdownEl);
    this.wrongWayEl = document.createElement('div');
    this.wrongWayEl.id = 'wrong-way-warning';
    this.wrongWayEl.innerHTML = '<span>↻</span> WRONG WAY!';
    root.appendChild(this.wrongWayEl);

    root.querySelectorAll<HTMLElement>('[data-next]').forEach((button) => button.addEventListener('click', () => this.show(button.dataset.next as Screen)));
    root.querySelectorAll<HTMLButtonElement>('[data-character]').forEach((button) => button.addEventListener('click', () => {
      this.selectCard(button, '[data-character]');
      this.characterCallbacks.forEach((cb) => cb(button.dataset.character as Character));
    }));
    root.querySelectorAll<HTMLButtonElement>('[data-vehicle]').forEach((button) => button.addEventListener('click', () => {
      this.selectCard(button, '[data-vehicle]');
      this.vehicleCallbacks.forEach((cb) => cb(button.dataset.vehicle as Vehicle));
    }));
    root.querySelector('#grand-prix-button')?.addEventListener('click', () => this.show('character'));
    root.querySelectorAll<HTMLButtonElement>('[data-track]').forEach((button) => button.addEventListener('click', () => {
      this.trackCallbacks.forEach((cb) => cb(button.dataset.track || 'seaside'));
      this.show('preview');
    }));
    root.querySelector('#resume-race-button')?.addEventListener('click', () => this.resumeCallbacks.forEach((cb) => cb()));
    root.querySelector('#restart-race-button')?.addEventListener('click', () => this.restartCallbacks.forEach((cb) => cb()));
    root.querySelectorAll('[data-menu]').forEach((button) => button.addEventListener('click', () => this.menuCallbacks.forEach((cb) => cb())));

    this.show('loading');
  }

  private createPanel(root: HTMLElement, screen: Screen, html: string): void {
    const panel = document.createElement('div');
    panel.className = `screen-overlay screen-${screen} hidden`;
    panel.innerHTML = `<div class="screen-panel">${html}</div>`;
    root.appendChild(panel);
    this.panels.set(screen, panel);
  }

  private selectCard(selected: HTMLButtonElement, selector: string): void {
    selected.parentElement?.querySelectorAll(selector).forEach((card) => card.classList.toggle('selected', card === selected));
  }
  onResume(cb: () => void): void { this.resumeCallbacks.push(cb); }
  onRestart(cb: () => void): void { this.restartCallbacks.push(cb); }
  onMenu(cb: () => void): void { this.menuCallbacks.push(cb); }
  onVehicleSelected(cb: (vehicle: Vehicle) => void): void { this.vehicleCallbacks.push(cb); }
  onTrackSelected(cb: (trackId: string) => void): void { this.trackCallbacks.push(cb); }
  onCharacterSelected(cb: (character: Character) => void): void { this.characterCallbacks.push(cb); }
  setCountdownText(text: string): void { if (text !== this.lastCountdownText) { this.lastCountdownText = text; this.countdownEl.textContent = text; } }
  hideCountdown(): void { this.countdownEl.classList.add('hidden'); }
  setWrongWayVisible(visible: boolean): void { this.wrongWayEl.classList.toggle('visible', visible); }
  /** Fills in the results screen with the player's actual finishing position. */
  setResults(place: number, totalRacers: number): void {
    const panel = this.panels.get('results');
    if (!panel) return;
    const copy = RESULTS_COPY[place] ?? { title: 'Finished!', tag: '🏁' };
    const titleEl = panel.querySelector('#results-title');
    const copyEl = panel.querySelector('#results-copy');
    const burstEl = panel.querySelector('#results-burst');
    if (titleEl) titleEl.textContent = copy.title;
    if (burstEl) burstEl.textContent = copy.tag;
    if (copyEl) copyEl.innerHTML = `You crossed the line in <strong>${formatOrdinal(place)} place</strong> of ${totalRacers}`;
  }
  show(screen: Screen): void {
    this.current = screen;
    this.panels.forEach((panel, key) => panel.classList.toggle('hidden', key !== screen));
    if (screen === 'countdown') this.countdownEl.classList.remove('hidden');
    else if (screen !== 'racing') this.hideCountdown();
    if (screen !== 'racing') this.setWrongWayVisible(false);
  }
  getCurrent(): Screen { return this.current; }
}
