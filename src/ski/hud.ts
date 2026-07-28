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

/** All DOM overlay: HUD readouts, trick/gate popups, start/end menus, mobile hint, fps toggle, error box. */
export class SkiHud {
  private readonly root: HTMLDivElement;
  private readonly speedEl: HTMLDivElement;
  private readonly scoreEl: HTMLDivElement;
  private readonly comboEl: HTMLDivElement;
  private readonly distanceEl: HTMLDivElement;
  private readonly boostArc: SVGCircleElement;
  private readonly shieldBadge: HTMLDivElement;
  private readonly popupContainer: HTMLDivElement;
  private readonly fpsEl: HTMLDivElement;
  private readonly errorBox: HTMLDivElement;
  private readonly startOverlay: HTMLDivElement;
  private readonly endOverlay: HTMLDivElement;
  private readonly endScoreEl: HTMLDivElement;
  private readonly portraitHint: HTMLDivElement;
  private fpsVisible = false;

  private startCallback: (() => void) | null = null;
  private restartCallback: (() => void) | null = null;

  constructor(container: HTMLElement, isTouch: boolean) {
    this.root = document.createElement('div');
    this.root.className = 'ski-root';
    this.root.innerHTML = `
      <div class="ski-hud">
        <div class="ski-hud-speed"><span class="ski-speed-value">0</span><span class="ski-speed-unit">KM/H</span></div>
        <div class="ski-hud-score">
          <div class="ski-score-value">0</div>
          <div class="ski-combo-value hidden">x1 COMBO</div>
        </div>
        <div class="ski-hud-distance">0 m</div>
        <div class="ski-hud-boost">
          <div class="ski-shield-badge hidden">🛡</div>
          <svg viewBox="0 0 60 60" class="ski-boost-ring">
            <circle cx="30" cy="30" r="26" class="ski-boost-track"></circle>
            <circle cx="30" cy="30" r="26" class="ski-boost-arc" stroke-dasharray="163.4" stroke-dashoffset="163.4"></circle>
          </svg>
        </div>
      </div>
      <div class="ski-popups"></div>
      <div class="ski-fps hidden"></div>
      <div class="ski-error hidden"></div>
      <div class="ski-portrait-hint hidden">Rotate your phone for the best ride 📱↻</div>
      <div class="ski-overlay ski-overlay--start">
        <div class="ski-overlay-panel">
          <h1 class="ski-title">ALPINE<span class="ski-title-rush"> RUSH</span></h1>
          <p class="ski-subtitle">An endless downhill run through deliberate chaos.</p>
          <div class="ski-hints">
            <span class="ski-hint-chip">A/D steer</span>
            <span class="ski-hint-chip">SPACE jump</span>
            <span class="ski-hint-chip">Q/E spin</span>
            <span class="ski-hint-chip">S grab</span>
            <span class="ski-hint-chip">W tuck</span>
          </div>
          <button type="button" class="ski-start-button">CLICK TO RIDE</button>
        </div>
      </div>
      <div class="ski-overlay ski-overlay--end hidden">
        <div class="ski-overlay-panel">
          <h1 class="ski-title ski-title--small">WIPEOUT</h1>
          <div class="ski-end-score"></div>
          <button type="button" class="ski-start-button ski-restart-button">CLICK TO RIDE AGAIN</button>
        </div>
      </div>
    `;
    container.appendChild(this.root);

    this.speedEl = this.root.querySelector('.ski-speed-value')!;
    this.scoreEl = this.root.querySelector('.ski-score-value')!;
    this.comboEl = this.root.querySelector('.ski-combo-value')!;
    this.distanceEl = this.root.querySelector('.ski-hud-distance')!;
    this.boostArc = this.root.querySelector('.ski-boost-arc')!;
    this.shieldBadge = this.root.querySelector('.ski-shield-badge')!;
    this.popupContainer = this.root.querySelector('.ski-popups')!;
    this.fpsEl = this.root.querySelector('.ski-fps')!;
    this.errorBox = this.root.querySelector('.ski-error')!;
    this.startOverlay = this.root.querySelector('.ski-overlay--start')!;
    this.endOverlay = this.root.querySelector('.ski-overlay--end')!;
    this.endScoreEl = this.root.querySelector('.ski-end-score')!;
    this.portraitHint = this.root.querySelector('.ski-portrait-hint')!;

    this.root.querySelector('.ski-start-button:not(.ski-restart-button)')!.addEventListener('click', () => this.startCallback?.());
    this.root.querySelector('.ski-restart-button')!.addEventListener('click', () => this.restartCallback?.());

    window.addEventListener('keydown', (event) => {
      if (event.code === 'KeyF') this.setFpsVisible(!this.fpsVisible);
    });

    if (isTouch) {
      const updateHint = () => this.portraitHint.classList.toggle('hidden', window.innerWidth > window.innerHeight);
      window.addEventListener('resize', updateHint);
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
    this.root.querySelector('.ski-hud')!.classList.toggle('hidden', !visible);
  }

  showStartOverlay(): void {
    this.startOverlay.classList.remove('hidden');
    this.endOverlay.classList.add('hidden');
    this.setHudVisible(false);
  }

  hideOverlays(): void {
    this.startOverlay.classList.add('hidden');
    this.endOverlay.classList.add('hidden');
    this.setHudVisible(true);
  }

  showEndOverlay(score: number, best: number, distanceM: number): void {
    this.endScoreEl.innerHTML = `SCORE <strong>${Math.round(score)}</strong> &nbsp; BEST <strong>${Math.round(best)}</strong> &nbsp; ${formatDistance(distanceM)}`;
    this.endOverlay.classList.remove('hidden');
    this.setHudVisible(false);
  }

  update(frame: HudFrame): void {
    this.speedEl.textContent = Math.round(frame.speedKmh).toString();
    this.scoreEl.textContent = Math.round(frame.score).toString();
    this.comboEl.classList.toggle('hidden', !frame.comboActive);
    if (frame.comboActive) {
      this.comboEl.textContent = `x${frame.comboMultiplier.toFixed(1)} COMBO`;
      const heat = Math.min(1, (frame.comboMultiplier - 1) / 3);
      this.comboEl.style.color = mixColor(heat);
      this.comboEl.style.transform = `scale(${1 + heat * 0.25})`;
    }
    this.distanceEl.textContent = formatDistance(frame.distanceM);

    const circumference = 163.4;
    const fraction = frame.boostFraction ?? 0;
    this.boostArc.style.strokeDashoffset = (circumference * (1 - fraction)).toString();
    this.boostArc.parentElement!.classList.toggle('hidden', frame.boostFraction === null);
    this.shieldBadge.classList.toggle('hidden', !frame.shielded);

    if (frame.fps !== null) this.fpsEl.textContent = `${frame.fps.toFixed(0)} fps`;
  }

  private setFpsVisible(visible: boolean): void {
    this.fpsVisible = visible;
    this.fpsEl.classList.toggle('hidden', !visible);
  }

  showPopup(text: string, variant: 'trick' | 'gate' | 'miss' | 'shield' = 'trick'): void {
    const el = document.createElement('div');
    el.className = `ski-popup ski-popup--${variant}`;
    el.textContent = text;
    this.popupContainer.appendChild(el);
    requestAnimationFrame(() => el.classList.add('ski-popup--rise'));
    setTimeout(() => el.remove(), 1400);
  }

  showError(message: string): void {
    this.errorBox.textContent = `Error: ${message}`;
    this.errorBox.classList.remove('hidden');
  }
}

function formatDistance(meters: number): string {
  return meters >= 1000 ? `${(meters / 1000).toFixed(2)} km` : `${Math.round(meters)} m`;
}

function mixColor(t: number): string {
  const r = 255;
  const g = Math.round(255 - t * 140);
  const b = Math.round(255 - t * 255);
  return `rgb(${r}, ${g}, ${b})`;
}
