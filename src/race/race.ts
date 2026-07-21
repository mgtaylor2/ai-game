import type { Kart } from '../kart/kart';
import * as THREE from 'three';
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
  prevPosition: THREE.Vector3;
  nextWaypointIndex: number;
  /** Monotonic count of waypoints passed; never decremented. */
  totalWaypointsPassed: number;
  waypointsSinceLastLap: number;
  finished: boolean;
  /** 1-based order in which this kart crossed the line on its final lap; 0 until then. */
  finishRank: number;
}

export interface RaceOptions {
  onLap?: (kart: Kart, laps: number) => void;
  onFinish?: (kart: Kart, laps: number) => void;
}

/** Tracks lap and waypoint progress for any number of karts on a track. */
export class Race {
  private readonly track: Track;
  private readonly waypoints: Waypoint[];
  private readonly onLap?: (kart: Kart, laps: number) => void;
  private readonly onFinish?: (kart: Kart, laps: number) => void;
  private readonly states = new Map<Kart, KartRaceState>();
  private finishedCount = 0;

  constructor(track: Track, waypoints: Waypoint[], options?: RaceOptions) {
    this.track = track;
    this.waypoints = waypoints;
    this.onLap = options?.onLap;
    this.onFinish = options?.onFinish;
  }

  addKart(kart: Kart): void {
    this.states.set(kart, {
      laps: 0,
      cooldown: 0,
      prevPosition: kart.position.clone(),
      nextWaypointIndex: 0,
      totalWaypointsPassed: 0,
      waypointsSinceLastLap: 0,
      finished: false,
      finishRank: 0,
    });
  }

  /** Must be called after kart physics have run for the frame. */
  update(dt: number): void {
    for (const [kart, state] of this.states) {
      this.advanceWaypoints(kart, state);

      state.cooldown = Math.max(0, state.cooldown - dt);
      if (
        !state.finished &&
        state.cooldown === 0 &&
        Math.abs(kart.speed) > MIN_CROSSING_SPEED &&
        // Only count crossings in the racing direction defined by the track...
        this.isMovingInFinishDirection(kart.position, state.prevPosition) &&
        // ...after covering most of the waypoint loop since the last counted lap.
        state.waypointsSinceLastLap >= LAP_WAYPOINT_FRACTION * this.waypoints.length &&
        this.track.crossesFinishLine(state.prevPosition, kart.position)
      ) {
        state.laps += 1;
        state.cooldown = FINISH_LINE_COOLDOWN_SECONDS;
        state.waypointsSinceLastLap = 0;
        this.onLap?.(kart, state.laps);
        if (state.laps >= TOTAL_LAPS) {
          state.finished = true;
          state.finishRank = ++this.finishedCount;
          this.onFinish?.(kart, state.laps);
        }
      }
      state.prevPosition.copy(kart.position);
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

  private isMovingInFinishDirection(current: THREE.Vector3, previous: THREE.Vector3): boolean {
    const { direction } = this.track.definition.finishLine;
    const dx = current.x - previous.x;
    const dz = current.z - previous.z;
    return dx * direction.x + dz * direction.z > 0;
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

  /**
   * 1-based race position. Finished karts rank by crossing order; unfinished karts
   * rank below all finished ones, ordered by lap/waypoint progress.
   */
  getPosition(kart: Kart): number {
    const state = this.states.get(kart);
    if (!state) return 1;
    let ahead = 0;
    for (const [otherKart, otherState] of this.states) {
      if (otherKart === kart) continue;
      if (this.isAhead(otherKart, otherState, kart, state)) ahead += 1;
    }
    return ahead + 1;
  }

  private isAhead(a: Kart, aState: KartRaceState, b: Kart, bState: KartRaceState): boolean {
    if (aState.finished !== bState.finished) return aState.finished;
    if (aState.finished && bState.finished) return aState.finishRank < bState.finishRank;
    return this.getProgress(a) > this.getProgress(b);
  }

  /** True while the kart is deliberately travelling away from its next checkpoint. */
  isWrongWay(kart: Kart): boolean {
    const state = this.states.get(kart);
    if (!state || Math.abs(kart.speed) < 2) return false;
    const next = this.waypoints[state.nextWaypointIndex];
    const forwardX = Math.sin(kart.heading);
    const forwardZ = Math.cos(kart.heading);
    const toNextX = next.x - kart.position.x;
    const toNextZ = next.z - kart.position.z;
    const distance = Math.hypot(toNextX, toNextZ);
    return distance > 0.1 && (forwardX * toNextX + forwardZ * toNextZ) / distance < -0.35;
  }

  reset(): void {
    this.finishedCount = 0;
    for (const [kart, state] of this.states) {
      state.laps = 0;
      state.cooldown = 0;
      state.prevPosition.copy(kart.position);
      state.nextWaypointIndex = 0;
      state.totalWaypointsPassed = 0;
      state.waypointsSinceLastLap = 0;
      state.finished = false;
      state.finishRank = 0;
    }
  }
}
