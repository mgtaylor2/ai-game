export interface SkiInputState {
  steer: number; // -1..1
  tuck: boolean;
  grab: boolean;
  spin: number; // -1, 0, or 1 (held)
}

const isTouchDevice = 'ontouchstart' in window || navigator.maxTouchPoints > 0;

/** Keyboard + touch input for Alpine Rush. Jump and respawn are edge-triggered (consumed once); everything else is a held state read every frame. */
export class SkiInputController {
  readonly isTouch = isTouchDevice;

  private readonly keys = new Set<string>();
  private jumpQueued = false;
  private respawnQueued = false;

  private touchSteer = 0;
  private touchSpin = 0;
  private readonly steerTouches = new Map<number, -1 | 1>();
  private spinTouchId: number | null = null;

  private touchUi: HTMLDivElement | null = null;

  constructor(container: HTMLElement) {
    window.addEventListener('keydown', this.handleKeyDown);
    window.addEventListener('keyup', this.handleKeyUp);
    if (this.isTouch) this.setupTouchUi(container);
  }

  private handleKeyDown = (event: KeyboardEvent): void => {
    if (event.repeat) return;
    if (event.code === 'Space') this.jumpQueued = true;
    if (event.code === 'KeyR') this.respawnQueued = true;
    this.keys.add(event.code);
  };

  private handleKeyUp = (event: KeyboardEvent): void => {
    this.keys.delete(event.code);
  };

  private setupTouchUi(container: HTMLElement): void {
    const ui = document.createElement('div');
    ui.className = 'ski-touch-ui';
    ui.innerHTML = `
      <div class="ski-touch-zone ski-touch-zone--left"></div>
      <div class="ski-touch-zone ski-touch-zone--right"></div>
      <button class="ski-touch-button ski-touch-button--jump" type="button">JUMP</button>
      <button class="ski-touch-button ski-touch-button--spin" type="button">SPIN</button>
    `;
    container.appendChild(ui);
    this.touchUi = ui;

    const left = ui.querySelector<HTMLDivElement>('.ski-touch-zone--left')!;
    const right = ui.querySelector<HTMLDivElement>('.ski-touch-zone--right')!;
    const jumpBtn = ui.querySelector<HTMLButtonElement>('.ski-touch-button--jump')!;
    const spinBtn = ui.querySelector<HTMLButtonElement>('.ski-touch-button--spin')!;

    const onZoneStart = (dir: -1 | 1) => (event: TouchEvent) => {
      event.preventDefault();
      for (const touch of Array.from(event.changedTouches)) this.steerTouches.set(touch.identifier, dir);
      this.recomputeTouchSteer();
    };
    left.addEventListener('touchstart', onZoneStart(-1), { passive: false });
    right.addEventListener('touchstart', onZoneStart(1), { passive: false });

    const clearTouch = (event: TouchEvent) => {
      for (const touch of Array.from(event.changedTouches)) {
        this.steerTouches.delete(touch.identifier);
        if (this.spinTouchId === touch.identifier) {
          this.spinTouchId = null;
          this.touchSpin = 0;
        }
      }
      this.recomputeTouchSteer();
    };
    window.addEventListener('touchend', clearTouch);
    window.addEventListener('touchcancel', clearTouch);

    jumpBtn.addEventListener('touchstart', (event) => {
      event.preventDefault();
      this.jumpQueued = true;
    }, { passive: false });

    spinBtn.addEventListener('touchstart', (event) => {
      event.preventDefault();
      const touch = event.changedTouches[0];
      this.spinTouchId = touch.identifier;
      this.touchSpin = this.touchSteer !== 0 ? this.touchSteer : 1;
    }, { passive: false });

    container.addEventListener('touchstart', (event) => {
      for (const touch of Array.from(event.changedTouches)) {
        const target = touch.target as HTMLElement;
        if (target === left || target === right || target === jumpBtn || target === spinBtn) continue;
        const fraction = touch.clientX / window.innerWidth;
        if (fraction > 0.4 && fraction < 0.6) this.jumpQueued = true;
      }
    }, { passive: true });
  }

  private recomputeTouchSteer(): void {
    let sum = 0;
    for (const dir of this.steerTouches.values()) sum += dir;
    this.touchSteer = Math.max(-1, Math.min(1, sum));
  }

  getState(): SkiInputState {
    let steer = 0;
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) steer -= 1;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) steer += 1;
    if (steer === 0) steer = this.touchSteer;

    let spin = 0;
    if (this.keys.has('KeyQ')) spin -= 1;
    if (this.keys.has('KeyE')) spin += 1;
    if (spin === 0) spin = this.touchSpin;

    const tuck = this.keys.has('KeyW') || this.keys.has('ArrowUp') || this.keys.has('ShiftLeft') || this.keys.has('ShiftRight');
    const grab = this.keys.has('KeyS') || this.keys.has('ArrowDown');

    return { steer, tuck, grab, spin };
  }

  /** True once, the frame after a jump was requested; clears itself. */
  consumeJump(): boolean {
    if (!this.jumpQueued) return false;
    this.jumpQueued = false;
    return true;
  }

  /** True once, the frame after a respawn was requested; clears itself. */
  consumeRespawn(): boolean {
    if (!this.respawnQueued) return false;
    this.respawnQueued = false;
    return true;
  }

  dispose(): void {
    window.removeEventListener('keydown', this.handleKeyDown);
    window.removeEventListener('keyup', this.handleKeyUp);
    this.touchUi?.remove();
  }
}
