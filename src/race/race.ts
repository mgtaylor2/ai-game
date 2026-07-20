import type { Kart } from '../kart/kart';
import type { Track } from '../track/track';

const FINISH_LINE_COOLDOWN_SECONDS = 2;
const MIN_CROSSING_SPEED = 1;

interface KartRaceState {
  laps: number;
  cooldown: number;
  prevZ: number;
}

export interface RaceOptions {
  onLap?: (kart: Kart, laps: number) => void;
}

/** Tracks lap progress for any number of karts on a track. */
export class Race {
  private readonly track: Track;
  private readonly onLap?: (kart: Kart, laps: number) => void;
  private readonly states = new Map<Kart, KartRaceState>();

  constructor(track: Track, options?: RaceOptions) {
    this.track = track;
    this.onLap = options?.onLap;
  }

  addKart(kart: Kart): void {
    this.states.set(kart, { laps: 0, cooldown: 0, prevZ: kart.position.z });
  }

  /** Must be called after kart physics have run for the frame. */
  update(dt: number): void {
    for (const [kart, state] of this.states) {
      state.cooldown = Math.max(0, state.cooldown - dt);
      if (
        state.cooldown === 0 &&
        Math.abs(kart.speed) > MIN_CROSSING_SPEED &&
        this.track.crossesFinishLine(kart.position.x, state.prevZ, kart.position.z)
      ) {
        state.laps += 1;
        state.cooldown = FINISH_LINE_COOLDOWN_SECONDS;
        this.onLap?.(kart, state.laps);
      }
      state.prevZ = kart.position.z;
    }
  }

  getLaps(kart: Kart): number {
    return this.states.get(kart)?.laps ?? 0;
  }

  reset(): void {
    for (const [kart, state] of this.states) {
      state.laps = 0;
      state.cooldown = 0;
      state.prevZ = kart.position.z;
    }
  }
}
