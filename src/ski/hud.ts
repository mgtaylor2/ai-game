export interface HudFrame {
  speedKmh: number;
  score: number;
  best: number;
  comboMultiplier: number;
  comboActive: boolean;
  distanceM: number;
  boostFraction: number | null;
  shielded: boolean;
  fps: number | null;
}

export interface EndSummary {
  score: number;
  best: number;
  distanceM: number;
  isNewBest: boolean;
  cause: 'wipeout' | 'crash';
}

/** Circumference of the r=26 boost ring, used to drive its stroke-dashoffset. */
const BOOST_RING_CIRCUMFERENCE = 2 * Math.PI * 26;

const KEY_HINTS: Array<{ key: string; label: string }> = [
  { key: 'A D', label: 'carve' },
  { key: 'SPACE', label: 'jump' },
  { key: 'Q E', label: 'spin' },
  { key: 'S', label: 'grab' },
  { key: 'W', label: 'tuck' },
  { key: 'R', label: 'respawn' },
];

const TOUCH_HINTS: Array<{ key: string; label: string }> = [
  { key: 'HOLD', label: 'either side to carve' },
  { key: 'TAP', label: 'centre to jump' },
  { key: 'SPIN', label: 'button to rotate' },
];

/** All DOM overlay: HUD readouts, trick/gate popups, start/end menus, mobile hint, fps toggle, error box. */
export class SkiHud {
  private readonly root: HTMLDivElement;
  private readonly hudEl: HTMLDivElement;
  private readonly speedEl: HTMLDivElement;
  private readonly scoreEl: HTMLDivElement;
  private readonly comboEl: HTMLDivElement;
  private readonly distanceEl: HTMLDivElement;
  private readonly boostRing: SVGSVGElement;
  private readonly boostArc: SVGCircleElement;
  private readonly shieldBadge: HTMLDivElement;
  private readonly popupContainer: HTMLDivElement;
  private readonly fpsEl: HTMLDivElement;
  private readonly errorBox: HTMLDivElement;
  private readonly startOverlay: HTMLDivElement;
  private readonly endOverlay: HTMLDivElement;
  private readonly menuBestEl: HTMLDivElement;
  private readonly endStatsEl: HTMLDivElement;
  private readonly endTitleEl: HTMLDivElement;
  private readonly newBestBadge: HTMLDivElement;
  private readonly portraitHint: HTMLDivElement;
  private fpsVisible = false;

  private startCallback: (() => void) | null = null;
  private restartCallback: (() => void) | null = null;

  constructor(container: HTMLElement, isTouch: boolean) {
    const hints = isTouch ? TOUCH_HINTS : KEY_HINTS;
    const hintMarkup = hints
      .map((h) => `<span class="ski-chip"><b>${h.key}</b>${h.label}</span>`)
      .join('');

    this.root = document.createElement('div');
    this.root.className = 'ski-root';
    this.root.innerHTML = `
      <div class="ski-hud">
        <div class="ski-corner ski-corner--tl">
          <div class="ski-speed"><span class="ski-speed-value">0</span><span class="ski-speed-unit">km/h</span></div>
        </div>
        <div class="ski-corner ski-corner--tr">
          <div class="ski-score-value">0</div>
          <div class="ski-combo hidden"><span class="ski-combo-x">x1.0</span> COMBO</div>
        </div>
        <div class="ski-corner ski-corner--bl">
          <div class="ski-distance">0 m</div>
        </div>
        <div class="ski-corner ski-corner--br">
          <div class="ski-shield hidden" title="Shield active">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2 4 5.5v6c0 5 3.4 9 8 10.5 4.6-1.5 8-5.5 8-10.5v-6L12 2z"/></svg>
          </div>
          <svg viewBox="0 0 60 60" class="ski-boost hidden" aria-hidden="true">
            <circle cx="30" cy="30" r="26" class="ski-boost-track"></circle>
            <circle cx="30" cy="30" r="26" class="ski-boost-arc"></circle>
          </svg>
        </div>
      </div>

      <div class="ski-popups"></div>
      <div class="ski-fps hidden"></div>
      <div class="ski-error hidden"></div>
      <div class="ski-portrait hidden"><div class="ski-portrait-inner"><span class="ski-portrait-icon">📱</span>Rotate your phone for the full view</div></div>

      <div class="ski-overlay ski-overlay--start">
        <div class="ski-panel">
          <h1 class="ski-title"><span class="ski-title-a">ALPINE</span><span class="ski-title-b">RUSH</span></h1>
          <p class="ski-tagline">Endless downhill. Carve the fall line, chain the gates, stick the landing.</p>
          <div class="ski-chips">${hintMarkup}</div>
          <button type="button" class="ski-cta ski-cta--start">CLICK TO RIDE</button>
          <div class="ski-menu-best hidden"></div>
          <a class="ski-back" href="/index.html">&larr; Kart Racer</a>
        </div>
      </div>

      <div class="ski-overlay ski-overlay--end hidden">
        <div class="ski-panel">
          <div class="ski-badge-newbest hidden">NEW BEST</div>
          <h2 class="ski-end-title">WIPEOUT</h2>
          <div class="ski-stats"></div>
          <button type="button" class="ski-cta ski-cta--restart">RIDE AGAIN</button>
          <a class="ski-back" href="/index.html">&larr; Kart Racer</a>
        </div>
      </div>
    `;
    container.appendChild(this.root);

    const q = <T extends Element>(sel: string): T => {
      const el = this.root.querySelector<T>(sel);
      if (!el) throw new Error(`Missing HUD element: ${sel}`);
      return el;
    };

    this.hudEl = q('.ski-hud');
    this.speedEl = q('.ski-speed-value');
    this.scoreEl = q('.ski-score-value');
    this.comboEl = q('.ski-combo');
    this.distanceEl = q('.ski-distance');
    this.boostRing = q<SVGSVGElement>('.ski-boost');
    this.boostArc = q<SVGCircleElement>('.ski-boost-arc');
    this.shieldBadge = q('.ski-shield');
    this.popupContainer = q('.ski-popups');
    this.fpsEl = q('.ski-fps');
    this.errorBox = q('.ski-error');
    this.startOverlay = q('.ski-overlay--start');
    this.endOverlay = q('.ski-overlay--end');
    this.menuBestEl = q('.ski-menu-best');
    this.endStatsEl = q('.ski-stats');
    this.endTitleEl = q('.ski-end-title');
    this.newBestBadge = q('.ski-badge-newbest');
    this.portraitHint = q('.ski-portrait');

    this.boostArc.style.strokeDasharray = BOOST_RING_CIRCUMFERENCE.toFixed(2);
    this.boostArc.style.strokeDashoffset = BOOST_RING_CIRCUMFERENCE.toFixed(2);

    q('.ski-cta--start').addEventListener('click', () => this.startCallback?.());
    q('.ski-cta--restart').addEventListener('click', () => this.restartCallback?.());

    window.addEventListener('keydown', (event) => {
      if (event.code === 'KeyF') this.setFpsVisible(!this.fpsVisible);
    });

    if (isTouch) {
      const updateHint = () => this.portraitHint.classList.toggle('hidden', window.innerWidth > window.innerHeight);
      window.addEventListener('resize', updateHint);
      window.addEventListener('orientationchange', updateHint);
      updateHint();
    }

    window.addEventListener('error', (event) => this.showError(event.message));

    this.setHudVisible(false);
  }

  onStart(cb: () => void): void {
    this.startCallback = cb;
  }

  onRestart(cb: () => void): void {
    this.restartCallback = cb;
  }

  setHudVisible(visible: boolean): void {
    this.hudEl.classList.toggle('hidden', !visible);
  }

  showStartOverlay(best: number): void {
    this.menuBestEl.classList.toggle('hidden', best <= 0);
    if (best > 0) this.menuBestEl.innerHTML = `BEST <strong>${Math.round(best).toLocaleString()}</strong>`;
    this.startOverlay.classList.remove('hidden');
    this.endOverlay.classList.add('hidden');
    this.setHudVisible(false);
  }

  hideOverlays(): void {
    this.startOverlay.classList.add('hidden');
    this.endOverlay.classList.add('hidden');
    this.setHudVisible(true);
  }

  showEndOverlay(summary: EndSummary): void {
    this.endTitleEl.textContent = summary.cause === 'wipeout' ? 'WIPEOUT' : 'RUN OVER';
    this.newBestBadge.classList.toggle('hidden', !summary.isNewBest);
    this.endStatsEl.innerHTML = `
      <div class="ski-stat"><span class="ski-stat-label">Score</span><span class="ski-stat-value">${Math.round(summary.score).toLocaleString()}</span></div>
      <div class="ski-stat"><span class="ski-stat-label">Best</span><span class="ski-stat-value">${Math.round(summary.best).toLocaleString()}</span></div>
      <div class="ski-stat"><span class="ski-stat-label">Distance</span><span class="ski-stat-value">${formatDistance(summary.distanceM)}</span></div>
    `;
    this.endOverlay.classList.remove('hidden');
    this.setHudVisible(false);
  }

  update(frame: HudFrame): void {
    this.speedEl.textContent = Math.round(frame.speedKmh).toString();
    this.scoreEl.textContent = Math.round(frame.score).toLocaleString();

    this.comboEl.classList.toggle('hidden', !frame.comboActive);
    if (frame.comboActive) {
      const heat = Math.min(1, (frame.comboMultiplier - 1) / 3);
      this.comboEl.firstElementChild!.textContent = `x${frame.comboMultiplier.toFixed(1)}`;
      // Chain heat drives colour and scale together, so a long chain is readable at a glance.
      this.comboEl.style.setProperty('--heat', heat.toFixed(3));
    }

    this.distanceEl.textContent = formatDistance(frame.distanceM);

    const boosting = frame.boostFraction !== null;
    this.boostRing.classList.toggle('hidden', !boosting);
    if (boosting) {
      this.boostArc.style.strokeDashoffset = (BOOST_RING_CIRCUMFERENCE * (1 - frame.boostFraction!)).toFixed(2);
    }
    this.shieldBadge.classList.toggle('hidden', !frame.shielded);

    if (frame.fps !== null && this.fpsVisible) this.fpsEl.textContent = `${frame.fps.toFixed(0)} fps`;
  }

  private setFpsVisible(visible: boolean): void {
    this.fpsVisible = visible;
    this.fpsEl.classList.toggle('hidden', !visible);
  }

  showPopup(text: string, variant: 'trick' | 'gate' | 'miss' | 'shield' | 'boost' = 'trick'): void {
    const el = document.createElement('div');
    el.className = `ski-popup ski-popup--${variant}`;
    el.textContent = text;
    this.popupContainer.appendChild(el);
    // Next frame, so the browser has a layout to transition *from*.
    requestAnimationFrame(() => el.classList.add('ski-popup--rise'));
    setTimeout(() => el.remove(), 1500);
  }

  showError(message: string): void {
    this.errorBox.textContent = `Error: ${message}`;
    this.errorBox.classList.remove('hidden');
  }
}

function formatDistance(meters: number): string {
  return meters >= 1000 ? `${(meters / 1000).toFixed(2)} km` : `${Math.round(meters)} m`;
}
