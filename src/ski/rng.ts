/** Deterministic PRNG + noise helpers. Every random choice in the game must go through these so a fixed seed reproduces an identical mountain. */

/** Mulberry32: tiny, fast, good-enough-for-games PRNG. Returns a function producing floats in [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function next(): number {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Derives a per-chunk (or otherwise per-integer-key) PRNG from the world seed, so chunks are stable regardless of generation order. */
export function seededRandomFor(seed: number, key: number): () => number {
  return mulberry32(hash2i(seed, key));
}

/** Derives an independent PRNG stream for one subsystem (decor, pickups, gates, ...) within a chunk, so they don't consume from a shared stream in a fragile order. */
export function subRng(seed: number, chunkIndex: number, salt: number): () => number {
  return mulberry32(hash2i(hash2i(seed, chunkIndex), salt));
}

/** 2D integer hash -> unsigned 32-bit int. Used to seed per-cell/per-chunk RNGs and as a noise lattice value source. */
export function hash2i(x: number, y: number): number {
  let h = Math.imul(x, 374761393) + Math.imul(y, 668265263) + 0x9e3779b9;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return h >>> 0;
}

/** Hash to a float in [0, 1). */
function hash2f(x: number, y: number): number {
  return hash2i(x, y) / 4294967296;
}

function smoothstep(t: number): number {
  return t * t * (3 - 2 * t);
}

/** Single-octave value noise on an integer lattice, smoothly interpolated. Range approximately [-1, 1]. */
function valueNoise2(x: number, y: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const v00 = hash2f(xi, yi);
  const v10 = hash2f(xi + 1, yi);
  const v01 = hash2f(xi, yi + 1);
  const v11 = hash2f(xi + 1, yi + 1);
  const sx = smoothstep(xf);
  const sy = smoothstep(yf);
  const a = v00 + (v10 - v00) * sx;
  const b = v01 + (v11 - v01) * sx;
  return (a + (b - a) * sy) * 2 - 1;
}

/** 3-octave fractal value noise, range approximately [-1, 1]. The one noise helper everything (terrain, shaders' CPU-side needs, decor jitter) should use. */
export function noise3Octave(x: number, y: number): number {
  let sum = 0;
  let amp = 0.55;
  let freq = 1;
  let total = 0;
  for (let i = 0; i < 3; i++) {
    sum += valueNoise2(x * freq, y * freq) * amp;
    total += amp;
    amp *= 0.5;
    freq *= 2.03;
  }
  return sum / total;
}
