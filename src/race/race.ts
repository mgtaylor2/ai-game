import type { Kart } from '../kart/kart';
import type { Track } from '../track/track';
import type { Waypoint } from '../track/waypoints';

export const TOTAL_LAPS = 3;

const FINISH_LINE_COOLDOWN_SECONDS = 2;
const MIN_CROSSING_SPEED = 1;
const WAYPOINT_CAPTURE_RADIUS = 6;
/** Fraction of the waypoint loop a kart must pass since its last lap for a crossing to count. */
const LAP_WAYPOINT_FRACTION = 0.75;

interface KartRaceState {
  laps: number;
  cooldown: number;
  prevZ: number;
  nextWaypointIndex: number;
  /** Monotonic count of waypoints passed; never decremented. */
  totalWaypointsPassed: number;
  waypointsSinceLastLap: number;
}

export interface RaceOptions {
  onLap?: (kart: Kart, laps: number) => void;
}

/** Tracks lap and waypoint progress for any number of karts on a track. */
export class Race {
  private readonly track: Track;
  private readonly waypoints: Waypoint[];
  private readonly onLap?: (kart: Kart, laps: number) => void;
  private readonly states = new Map<Kart, KartRaceState>();

  constructor(track: Track, waypoints: Waypoint[], options?: RaceOptions) {
    this.track = track;
    this.waypoints = waypoints;
    this.onLap = options?.onLap;
  }

  addKart(kart: Kart): void {
    this.states.set(kart, {
      laps: 0,
      cooldown: 0,
      prevZ: kart.position.z,
      nextWaypointIndex: 0,
      totalWaypointsPassed: 0,
      waypointsSinceLastLap: 0,
    });
  }

  /** Must be called after kart physics have run for the frame. */
  update(dt: number): void {
    for (const [kart, state] of this.states) {
      this.advanceWaypoints(kart, state);

      state.cooldown = Math.max(0, state.cooldown - dt);
      if (
        state.cooldown === 0 &&
        Math.abs(kart.speed) > MIN_CROSSING_SPEED &&
        // Only count crossings in the racing direction (-Z)...
        kart.position.z < state.prevZ &&
        // ...after covering most of the waypoint loop since the last counted lap.
        state.waypointsSinceLastLap >= LAP_WAYPOINT_FRACTION * this.waypoints.length &&
        this.track.crossesFinishLine(kart.position.x, state.prevZ, kart.position.z)
      ) {
        state.laps += 1;
        state.cooldown = FINISH_LINE_COOLDOWN_SECONDS;
        state.waypointsSinceLastLap = 0;
        this.onLap?.(kart, state.laps);
      }
      state.prevZ = kart.position.z;
    }
  }

  private advanceWaypoints(kart: Kart, state: KartRaceState): void {
    const count = this.waypoints.length;
    // A kart can pass multiple waypoints in one frame at high speed / low fps,
    // so keep advancing while a pass condition holds (bounded to one full loop).
    for (let guard = 0; guard < count; guard++) {
      const next = this.waypoints[state.nextWaypointIndex];
      const after = this.waypoints[(state.nextWaypointIndex + 1) % count];
      const distToNext = this.distanceTo(kart, next);
      if (distToNext > WAYPOINT_CAPTURE_RADIUS && this.distanceTo(kart, after) >= distToNext) {
        break;
      }
      state.nextWaypointIndex = (state.nextWaypointIndex + 1) % count;
      state.totalWaypointsPassed += 1;
      state.waypointsSinceLastLap += 1;
    }
  }

  private distanceTo(kart: Kart, waypoint: Waypoint): number {
    return Math.hypot(kart.position.x - waypoint.x, kart.position.z - waypoint.z);
  }

  /**
   * Total waypoints passed plus a [0, 1) fraction of progress toward the next
   * waypoint. Monotone-ish along the racing line; used for position/debug display.
   */
  getProgress(kart: Kart): number {
    const state = this.states.get(kart);
    if (!state) return 0;
    const count = this.waypoints.length;
    const next = this.waypoints[state.nextWaypointIndex];
    const prev = this.waypoints[(state.nextWaypointIndex - 1 + count) % count];
    const segmentLength = Math.hypot(next.x - prev.x, next.z - prev.z);
    if (segmentLength === 0) return state.totalWaypointsPassed;
    const fraction = 1 - Math.min(1, Math.max(0, this.distanceTo(kart, next) / segmentLength));
    return state.totalWaypointsPassed + fraction;
  }

  getNextWaypointIndex(kart: Kart): number {
    return this.states.get(kart)?.nextWaypointIndex ?? 0;
  }

  getLaps(kart: Kart): number {
    return this.states.get(kart)?.laps ?? 0;
  }

  reset(): void {
    for (const [kart, state] of this.states) {
      state.laps = 0;
      state.cooldown = 0;
      state.prevZ = kart.position.z;
      state.nextWaypointIndex = 0;
      state.totalWaypointsPassed = 0;
      state.waypointsSinceLastLap = 0;
    }
  }
}
