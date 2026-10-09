// Minimal allocation-light vector math for CPU-side groom generation.
export type V3 = [number, number, number];

export const v3 = (x = 0, y = 0, z = 0): V3 => [x, y, z];
export const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale = (a: V3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s];
export const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: V3, b: V3): V3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
export const len = (a: V3) => Math.hypot(a[0], a[1], a[2]);
export const normalize = (a: V3): V3 => {
  const l = len(a);
  return l > 1e-12 ? [a[0] / l, a[1] / l, a[2] / l] : [0, 1, 0];
};
export const mix = (a: V3, b: V3, t: number): V3 => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];
export const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
export const smoothstep = (e0: number, e1: number, x: number) => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Remove the component of `v` along unit normal `n`. */
export const projectTangent = (v: V3, n: V3): V3 => sub(v, scale(n, dot(v, n)));

/** Rotate `v` around unit `axis` by `angle` (Rodrigues). */
export function rotateAxis(v: V3, axis: V3, angle: number): V3 {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const d = dot(axis, v);
  const cr = cross(axis, v);
  return [
    v[0] * c + cr[0] * s + axis[0] * d * (1 - c),
    v[1] * c + cr[1] * s + axis[1] * d * (1 - c),
    v[2] * c + cr[2] * s + axis[2] * d * (1 - c),
  ];
}

/** Any unit vector perpendicular to unit `n`. */
export function anyPerp(n: V3): V3 {
  const a: V3 = Math.abs(n[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  return normalize(cross(n, a));
}

/** Deterministic PRNG (mulberry32). */
export function rng(seed: number) {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

/** Standard normal sample from a uniform generator (Box–Muller). */
export function gauss(rand: () => number) {
  const u = Math.max(1e-9, rand());
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand());
}
