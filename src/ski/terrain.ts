import * as THREE from 'three';
import { CONFIG } from './config';
import { TrackSpline } from './spline';
import { subRng, noise3Octave } from './rng';

export interface Kicker {
  z: number;
  x: number;
  amplitude: number;
  upSigma: number;
  downSigma: number;
  lateralSigma: number;
}

const KICKER_LATERAL_SIGMA = 4.5;
const KICKER_CURVATURE_SKIP = 0.012;
const VALLEY_WALL_GAIN = 0.14;
const VALLEY_WALL_CAP_EXCESS = 70;
const BANK_GAIN = 8;

/**
 * The whole mountain as one analytic height field, `heightAt(x, z)`. No physics engine, no raycasts:
 * the rider, camera, decor placement, and landing logic all sample this single function (plus its
 * finite-difference normal) so every part of the game agrees on what the ground looks like.
 */
export class Mountain {
  readonly spline: TrackSpline;
  private readonly kickerChunks = new Map<number, Kicker[]>();

  constructor(seed: number) {
    this.spline = new TrackSpline(seed);
  }

  centerXAt(z: number): number {
    return this.spline.xAt(z);
  }

  centerYAt(z: number): number {
    return this.spline.yAt(z);
  }

  dirAt(z: number): { x: number; z: number } {
    return this.spline.dirAt(z);
  }

  curvatureAt(z: number): number {
    return this.spline.curvatureAt(z);
  }

  private kickersForChunk(chunkIndex: number): Kicker[] {
    let cached = this.kickerChunks.get(chunkIndex);
    if (cached) return cached;

    cached = [];
    if (chunkIndex >= CONFIG.terrain.kickerStartChunk) {
      const random = subRng(CONFIG.seed, chunkIndex, 0xc1c1);
      const count = Math.floor(random() * (CONFIG.terrain.kickerChanceMax + 1));
      const chunkStart = chunkIndex * CONFIG.chunk.length;
      for (let i = 0; i < count; i++) {
        const z = chunkStart + random() * CONFIG.chunk.length;
        if (Math.abs(this.curvatureAt(z)) > KICKER_CURVATURE_SKIP) continue;
        const lateralOffset = (random() * 2 - 1) * CONFIG.terrain.kickerLateralOffsetMax;
        cached.push({
          z,
          x: this.centerXAt(z) + lateralOffset,
          amplitude: CONFIG.terrain.kickerAmpMin + random() * (CONFIG.terrain.kickerAmpMax - CONFIG.terrain.kickerAmpMin),
          upSigma: CONFIG.terrain.kickerUpSigmaMin + random() * (CONFIG.terrain.kickerUpSigmaMax - CONFIG.terrain.kickerUpSigmaMin),
          downSigma: CONFIG.terrain.kickerDownSigmaMin + random() * (CONFIG.terrain.kickerDownSigmaMax - CONFIG.terrain.kickerDownSigmaMin),
          lateralSigma: KICKER_LATERAL_SIGMA,
        });
      }
    }
    this.kickerChunks.set(chunkIndex, cached);
    return cached;
  }

  /** Returns every kicker near the given z (current chunk plus neighbours, since a ramp's gaussian tail can cross a chunk boundary). */
  kickersNear(z: number): Kicker[] {
    const chunkIndex = Math.floor(z / CONFIG.chunk.length);
    return [
      ...this.kickersForChunk(chunkIndex - 1),
      ...this.kickersForChunk(chunkIndex),
      ...this.kickersForChunk(chunkIndex + 1),
    ];
  }

  /** Kickers belonging to exactly one chunk (no neighbour bleed) — used by pickups.ts to trace a flight path over them. */
  getChunkKickers(chunkIndex: number): Kicker[] {
    return this.kickersForChunk(chunkIndex);
  }

  private kickerHeightAt(x: number, z: number): number {
    let sum = 0;
    for (const k of this.kickersNear(z)) {
      const dz = z - k.z;
      const sigmaZ = dz < 0 ? k.upSigma : k.downSigma;
      const dx = x - k.x;
      sum +=
        k.amplitude *
        Math.exp(-(dz * dz) / (2 * sigmaZ * sigmaZ)) *
        Math.exp(-(dx * dx) / (2 * k.lateralSigma * k.lateralSigma));
    }
    return sum;
  }

  /** Signed lateral distance from the groomed centerline. Positive = rider's right (+x side). */
  lateralDistanceAt(x: number, z: number): number {
    return x - this.centerXAt(z);
  }

  /** The pure height field: centerline elevation + valley walls + banking + rollers + moguls + kickers. */
  heightAt(x: number, z: number): number {
    const zc = Math.max(0, z);
    const base = this.centerYAt(zc);
    const lateral = x - this.centerXAt(zc);
    const absLateral = Math.abs(lateral);

    const excess = Math.min(Math.max(0, absLateral - CONFIG.terrain.corridorHalfWidth), VALLEY_WALL_CAP_EXCESS);
    const valleyWall = excess * excess * VALLEY_WALL_GAIN;

    const curvature = this.curvatureAt(zc);
    const bank = curvature * lateral * BANK_GAIN;

    const t = CONFIG.terrain;
    const rollerNoiseMod = 0.5 + 0.5 * noise3Octave(x * 0.05, zc * 0.05);
    const rollerShort = Math.sin((zc / t.rollerShortWavelength) * Math.PI * 2) * t.rollerShortAmp * rollerNoiseMod;
    const rollerLong = Math.sin((zc / t.rollerLongWavelength) * Math.PI * 2) * t.rollerLongAmp;

    const pisteMask = smoothstep(t.pisteHalfWidth, t.pisteHalfWidth + 10, absLateral);
    const mogul = noise3Octave(x / t.mogulScale, zc / t.mogulScale) * t.mogulAmp * (0.05 + 0.95 * pisteMask);

    const kicker = this.kickerHeightAt(x, zc);

    return base + valleyWall + bank + rollerShort + rollerLong + mogul + kicker;
  }

  /** Height plus a finite-difference surface normal, used by the rider, camera, and decor placement. */
  getHeightAndNormal(x: number, z: number): { height: number; normal: THREE.Vector3 } {
    const eps = 0.35;
    const height = this.heightAt(x, z);
    const hx1 = this.heightAt(x + eps, z);
    const hx0 = this.heightAt(x - eps, z);
    const hz1 = this.heightAt(x, z + eps);
    const hz0 = this.heightAt(x, z - eps);
    const dHdx = (hx1 - hx0) / (2 * eps);
    const dHdz = (hz1 - hz0) / (2 * eps);
    const normal = new THREE.Vector3(-dHdx, 1, -dHdz).normalize();
    return { height, normal };
  }
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}
