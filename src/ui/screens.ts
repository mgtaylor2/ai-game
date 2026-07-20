export type Screen = 'menu' | 'cup' | 'track' | 'preview' | 'character' | 'vehicle' | 'countdown' | 'racing' | 'paused' | 'results';
export type Vehicle = 'kart' | 'bike';
export type Character = 'star' | 'dash' | 'bloom';

/** Presents the race flow and leaves game-state decisions to main.ts. */
export class ScreenManager {
  private current: Screen = 'menu';
  private readonly panels = new Map<Screen, HTMLDivElement>();
  private readonly countdownEl: HTMLDivElement;
  private readonly wrongWayEl: HTMLDivElement;
  private lastCountdownText = '';
  private readonly startCallbacks: Array<() => void> = [];
  private readonly resumeCallbacks: Array<() => void> = [];
  private readonly restartCallbacks: Array<() => void> = [];
  private readonly menuCallbacks: Array<() => void> = [];
  private readonly vehicleCallbacks: Array<(vehicle: Vehicle) => void> = [];
  private readonly trackCallbacks: Array<(trackId: string) => void> = [];
  private readonly goldCupCallbacks: Array<() => void> = [];
  private readonly characterCallbacks: Array<(character: Character) => void> = [];

  constructor(root: HTMLElement) {
    this.createPanel(root, 'menu', `
      <div class="game-logo"><span>WII-STYLE</span>KART RACER</div>
      <p class="screen-subtitle">A sunny sprint around Seaside Circuit</p>
      <button data-next="cup" class="screen-button screen-button--primary" type="button">Grand Prix</button>
    `);
    this.createPanel(root, 'cup', `
      <h1 class="screen-title">Choose a Cup</h1>
      <div class="cup-grid"><button id="gold-cup-button" class="cup-card cup-card--gold" type="button"><span>🏆</span><strong>Gold Cup</strong><small>4 tracks</small></button>${Array.from({ length: 7 }, (_, index) => `<div class="cup-card cup-card--locked"><span>🔒</span><strong>Future Cup ${index + 1}</strong><small>Coming soon</small></div>`).join('')}</div>
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
    this.createPanel(root, 'character', `
      <h1 class="screen-title">Choose a Driver</h1>
      <div class="selection-grid" role="list">
        <button class="selection-card selected" data-character="star" type="button"><span class="driver-icon">★</span><strong>Star</strong><small>All-rounder</small></button>
        <button class="selection-card" data-character="dash" type="button"><span class="driver-icon">⚡</span><strong>Dash</strong><small>Speedster</small></button>
        <button class="selection-card" data-character="bloom" type="button"><span class="driver-icon">✿</span><strong>Bloom</strong><small>Drifter</small></button>
      </div>
      <button data-next="vehicle" class="screen-button screen-button--primary" type="button">Next</button>
    `);
    this.createPanel(root, 'vehicle', `
      <h1 class="screen-title">Choose Your Ride</h1>
      <div class="selection-grid selection-grid--vehicles">
        <button class="selection-card vehicle-card selected" data-vehicle="kart" type="button"><span class="vehicle-icon">🏎</span><strong>Turbo Kart</strong><small>Balanced handling</small></button>
        <button class="selection-card vehicle-card" data-vehicle="bike" type="button"><span class="vehicle-icon">🏍</span><strong>Comet Bike</strong><small>Sharp turns</small></button>
        <div class="selection-card vehicle-card selection-card--locked"><span class="vehicle-icon">🔒</span><strong>Star Speeder</strong><small>Unlock later</small></div>
        <div class="selection-card vehicle-card selection-card--locked"><span class="vehicle-icon">🔒</span><strong>Cloud Cruiser</strong><small>Unlock later</small></div>
        <div class="selection-card vehicle-card selection-card--locked"><span class="vehicle-icon">🔒</span><strong>Rocket Bike</strong><small>Unlock later</small></div>
        <div class="selection-card vehicle-card selection-card--locked"><span class="vehicle-icon">🔒</span><strong>Comet Cycle</strong><small>Unlock later</small></div>
      </div>
      <button id="begin-race-button" class="screen-button screen-button--primary" type="button">Let's Race!</button>
    `);
    this.createPanel(root, 'paused', `
      <h1 class="screen-title screen-title--pause">Paused</h1>
      <div class="screen-actions"><button id="resume-race-button" class="screen-button" type="button">Resume</button><button data-menu class="screen-button" type="button">Quit to Menu</button></div>
    `);
    this.createPanel(root, 'results', `
      <div class="finish-burst">★ ★ ★</div>
      <h1 class="screen-title results-title">Finished!</h1>
      <p class="screen-subtitle results-copy">You crossed the line in <strong>1st place</strong></p>
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
    root.querySelectorAll<HTMLButtonElement>('[data-vehicle]').forEach((button) => button.addEventListener('click', () => this.selectCard(button, '[data-vehicle]')));
    root.querySelector('#gold-cup-button')?.addEventListener('click', () => { this.goldCupCallbacks.forEach((cb) => cb()); this.show('track'); });
    root.querySelectorAll<HTMLButtonElement>('[data-track]').forEach((button) => button.addEventListener('click', () => {
      this.trackCallbacks.forEach((cb) => cb(button.dataset.track || 'seaside'));
      this.show('preview');
    }));
    root.querySelector('#begin-race-button')?.addEventListener('click', () => {
      const vehicle = root.querySelector<HTMLButtonElement>('[data-vehicle].selected')?.dataset.vehicle as Vehicle;
      this.vehicleCallbacks.forEach((cb) => cb(vehicle || 'kart'));
      this.startCallbacks.forEach((cb) => cb());
    });
    root.querySelector('#resume-race-button')?.addEventListener('click', () => this.resumeCallbacks.forEach((cb) => cb()));
    root.querySelector('#restart-race-button')?.addEventListener('click', () => this.restartCallbacks.forEach((cb) => cb()));
    root.querySelectorAll('[data-menu]').forEach((button) => button.addEventListener('click', () => this.menuCallbacks.forEach((cb) => cb())));
    this.show('menu');
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
  onStart(cb: () => void): void { this.startCallbacks.push(cb); }
  onResume(cb: () => void): void { this.resumeCallbacks.push(cb); }
  onRestart(cb: () => void): void { this.restartCallbacks.push(cb); }
  onMenu(cb: () => void): void { this.menuCallbacks.push(cb); }
  onVehicleSelected(cb: (vehicle: Vehicle) => void): void { this.vehicleCallbacks.push(cb); }
  onTrackSelected(cb: (trackId: string) => void): void { this.trackCallbacks.push(cb); }
  onGoldCupSelected(cb: () => void): void { this.goldCupCallbacks.push(cb); }
  onCharacterSelected(cb: (character: Character) => void): void { this.characterCallbacks.push(cb); }
  setCountdownText(text: string): void { if (text !== this.lastCountdownText) { this.lastCountdownText = text; this.countdownEl.textContent = text; } }
  hideCountdown(): void { this.countdownEl.classList.add('hidden'); }
  setWrongWayVisible(visible: boolean): void { this.wrongWayEl.classList.toggle('visible', visible); }
  showResults(): void { this.show('results'); }
  show(screen: Screen): void {
    this.current = screen;
    this.panels.forEach((panel, key) => panel.classList.toggle('hidden', key !== screen));
    if (screen === 'countdown') this.countdownEl.classList.remove('hidden');
    else if (screen !== 'racing') this.hideCountdown();
    if (screen !== 'racing') this.setWrongWayVisible(false);
  }
  getCurrent(): Screen { return this.current; }
}
