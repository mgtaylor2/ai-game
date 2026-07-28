import { CONFIG } from './config';

const BEST_SCORE_KEY = 'alpineRush.bestScore';

/** Score + combo chain, with the multiplier that heats up as the chain grows and cools off after a wipeout or missed gate. */
export class ScoreTracker {
  score = 0;
  best = 0;
  chain = 0;
  private comboTimer = 0;

  constructor() {
    const stored = Number(localStorage.getItem(BEST_SCORE_KEY));
    this.best = Number.isFinite(stored) ? stored : 0;
  }

  get comboMultiplier(): number {
    return Math.min(CONFIG.scoring.comboMax, 1 + this.chain * CONFIG.scoring.comboPerChain);
  }

  get comboActive(): boolean {
    return this.chain > 0 && this.comboTimer > 0;
  }

  update(dt: number): void {
    if (this.comboTimer > 0) {
      this.comboTimer -= dt;
      if (this.comboTimer <= 0) this.chain = 0;
    }
  }

  /** Adds base*multiplier to the score and bumps/refreshes the combo chain. Returns the points actually added. */
  addPoints(base: number): number {
    const points = base * this.comboMultiplier;
    this.score += points;
    this.chain += 1;
    this.comboTimer = CONFIG.scoring.comboWindow;
    return points;
  }

  resetCombo(): void {
    this.chain = 0;
    this.comboTimer = 0;
  }

  finalizeBest(): void {
    if (this.score > this.best) {
      this.best = this.score;
      localStorage.setItem(BEST_SCORE_KEY, this.best.toString());
    }
  }

  reset(): void {
    this.score = 0;
    this.chain = 0;
    this.comboTimer = 0;
  }
}
