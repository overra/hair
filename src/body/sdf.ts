// Procedural mannequin defined as a smooth union of analytic primitives.
// The same primitive list drives the CPU evaluator (meshing, root scattering,
// picking) and generated WGSL (GPU collision), so both always agree.
//
// Units: meters. +Y up, the figure faces +Z, feet on y = 0.
import { type V3, clamp, scale, add, normalize } from '../math/vec';

export type BodyPart =
  | 'cranium' | 'face' | 'jaw' | 'nose' | 'ear' | 'brow' | 'eye' | 'neck'
  | 'chest' | 'abdomen' | 'pelvis' | 'glute' | 'shoulder'
  | 'upperArm' | 'forearm' | 'hand' | 'thigh' | 'shin' | 'foot';

export type Primitive =
  | { kind: 'ellipsoid'; part: BodyPart; c: V3; r: V3; k: number }
  | { kind: 'roundCone'; part: BodyPart; a: V3; b: V3; ra: number; rb: number; k: number };

const E = (part: BodyPart, c: V3, r: V3, k = 0.03): Primitive => ({ kind: 'ellipsoid', part, c, r, k });
const C = (part: BodyPart, a: V3, b: V3, ra: number, rb: number, k = 0.03): Primitive => ({
  kind: 'roundCone', part, a, b, ra, rb, k,
});

/** Mirror a primitive across the sagittal (x = 0) plane. */
function mirror(p: Primitive): Primitive {
  const m = (v: V3): V3 => [-v[0], v[1], v[2]];
  return p.kind === 'ellipsoid' ? { ...p, c: m(p.c) } : { ...p, a: m(p.a), b: m(p.b) };
}
const both = (p: Primitive) => [p, mirror(p)];

/** Key landmarks shared by groom generation (eyes, mouth, head frame). */
export const LANDMARKS = {
  headCenter: [0, 1.655, -0.012] as V3,
  crownWhorl: [0.012, 1.745, -0.055] as V3,
  eyeL: [0.032, 1.637, 0.078] as V3, // subject's left = +x
  eyeR: [-0.032, 1.637, 0.078] as V3,
  eyeRadius: 0.0125,
  mouth: [0, 1.566, 0.098] as V3,
  chin: [0, 1.528, 0.078] as V3,
  sternum: [0, 1.33, 0.11] as V3,
  navel: [0, 1.04, 0.1] as V3,
  pubis: [0, 0.9, 0.09] as V3,
  shoulderL: [0.19, 1.42, -0.01] as V3,
  elbowL: [0.265, 1.13, -0.03] as V3,
  wristL: [0.315, 0.885, 0.0] as V3,
  hipL: [0.09, 0.9, 0.0] as V3,
  kneeL: [0.1, 0.49, 0.015] as V3,
  ankleL: [0.1, 0.085, -0.01] as V3,
};

export const BODY: Primitive[] = [
  // Head
  E('cranium', LANDMARKS.headCenter, [0.074, 0.086, 0.098], 0.02),
  E('face', [0, 1.6, 0.03], [0.06, 0.07, 0.07], 0.025),
  E('jaw', [0, 1.548, 0.04], [0.05, 0.035, 0.048], 0.025),
  E('jaw', [0, 1.53, 0.068], [0.026, 0.02, 0.022], 0.02),
  C('nose', [0, 1.628, 0.093], [0, 1.592, 0.115], 0.006, 0.011, 0.012),
  C('brow', [-0.045, 1.652, 0.083], [0.045, 1.652, 0.083], 0.01, 0.01, 0.018),
  ...both(E('ear', [0.074, 1.628, -0.012], [0.012, 0.03, 0.017], 0.008)),
  ...both(E('eye', LANDMARKS.eyeL, [0.0125, 0.0125, 0.0125], 0.004)),
  // Neck & torso
  C('neck', [0, 1.45, -0.015], [0, 1.57, -0.02], 0.055, 0.05, 0.03),
  C('shoulder', [-0.18, 1.425, -0.015], [0.18, 1.425, -0.015], 0.058, 0.058, 0.05),
  E('chest', [0, 1.3, 0.0], [0.16, 0.19, 0.105], 0.05),
  E('abdomen', [0, 1.09, 0.005], [0.14, 0.16, 0.095], 0.06),
  E('pelvis', [0, 0.94, -0.005], [0.165, 0.11, 0.105], 0.05),
  ...both(E('glute', [0.07, 0.875, -0.055], [0.08, 0.095, 0.07], 0.04)),
  // Arms (relaxed A-pose)
  ...both(C('upperArm', [0.195, 1.405, -0.015], LANDMARKS.elbowL, 0.047, 0.036, 0.04)),
  ...both(C('forearm', LANDMARKS.elbowL, LANDMARKS.wristL, 0.036, 0.024, 0.02)),
  ...both(E('hand', [0.33, 0.815, 0.012], [0.016, 0.06, 0.042], 0.02)),
  // Legs
  ...both(C('thigh', [0.088, 0.9, 0.0], LANDMARKS.kneeL, 0.085, 0.05, 0.05)),
  ...both(C('shin', LANDMARKS.kneeL, LANDMARKS.ankleL, 0.05, 0.032, 0.02)),
  ...both(E('foot', [0.1, 0.035, 0.045], [0.042, 0.035, 0.11], 0.03)),
];

// ---------------------------------------------------------------- CPU eval

function sdEllipsoid(px: number, py: number, pz: number, c: V3, r: V3) {
  const qx = (px - c[0]) / r[0], qy = (py - c[1]) / r[1], qz = (pz - c[2]) / r[2];
  const k0 = Math.sqrt(qx * qx + qy * qy + qz * qz);
  const sx = qx / r[0], sy = qy / r[1], sz = qz / r[2];
  const k1 = Math.sqrt(sx * sx + sy * sy + sz * sz);
  return k1 > 1e-9 ? (k0 * (k0 - 1)) / k1 : -Math.min(r[0], r[1], r[2]);
}

function sdRoundCone(px: number, py: number, pz: number, a: V3, b: V3, r1: number, r2: number) {
  // Inigo Quilez, exact round cone.
  const bax = b[0] - a[0], bay = b[1] - a[1], baz = b[2] - a[2];
  const l2 = bax * bax + bay * bay + baz * baz;
  const rr = r1 - r2;
  const a2 = l2 - rr * rr;
  const il2 = 1 / l2;
  const pax = px - a[0], pay = py - a[1], paz = pz - a[2];
  const y = pax * bax + pay * bay + paz * baz;
  const z = y - l2;
  const xx = pax * l2 - bax * y, xy = pay * l2 - bay * y, xz = paz * l2 - baz * y;
  const x2 = xx * xx + xy * xy + xz * xz;
  const y2 = y * y * l2;
  const z2 = z * z * l2;
  const k = Math.sign(rr) * rr * rr * x2;
  if (Math.sign(z) * a2 * z2 > k) return Math.sqrt(x2 + z2) * il2 - r2;
  if (Math.sign(y) * a2 * y2 < k) return Math.sqrt(x2 + y2) * il2 - r1;
  return (Math.sqrt(x2 * a2 * il2) + y * rr) * il2 - r1;
}

function sdPrim(px: number, py: number, pz: number, pr: Primitive) {
  return pr.kind === 'ellipsoid'
    ? sdEllipsoid(px, py, pz, pr.c, pr.r)
    : sdRoundCone(px, py, pz, pr.a, pr.b, pr.ra, pr.rb);
}

function smin(a: number, b: number, k: number) {
  const h = clamp(0.5 + (0.5 * (b - a)) / k, 0, 1);
  return b + (a - b) * h - k * h * (1 - h);
}

/** Signed distance to the body surface (negative inside). */
export function bodySdf(p: V3, prims: Primitive[] = BODY): number {
  return bodySdfXYZ(p[0], p[1], p[2], prims);
}

export function bodySdfXYZ(x: number, y: number, z: number, prims: Primitive[] = BODY): number {
  let d = sdPrim(x, y, z, prims[0]);
  for (let i = 1; i < prims.length; i++) d = smin(d, sdPrim(x, y, z, prims[i]), prims[i].k);
  return d;
}

/** Which body part dominates at `p` (nearest primitive). */
export function bodyPartAt(p: V3, prims: Primitive[] = BODY): BodyPart {
  let best = Infinity;
  let part: BodyPart = prims[0].part;
  for (const pr of prims) {
    const d = sdPrim(p[0], p[1], p[2], pr);
    if (d < best) {
      best = d;
      part = pr.part;
    }
  }
  return part;
}

export function bodyNormal(p: V3, prims: Primitive[] = BODY): V3 {
  const e = 2e-4;
  const [x, y, z] = p;
  return normalize([
    bodySdfXYZ(x + e, y, z, prims) - bodySdfXYZ(x - e, y, z, prims),
    bodySdfXYZ(x, y + e, z, prims) - bodySdfXYZ(x, y - e, z, prims),
    bodySdfXYZ(x, y, z + e, prims) - bodySdfXYZ(x, y, z - e, prims),
  ]);
}

/** Sphere-trace a ray against the body. Returns hit distance or -1. */
export function raycastBody(origin: V3, dir: V3, maxT = 20, prims: Primitive[] = BODY): number {
  let t = 0;
  for (let i = 0; i < 256 && t < maxT; i++) {
    const d = bodySdf(add(origin, scale(dir, t)), prims);
    if (d < 1e-4) return t;
    t += d * 0.9;
  }
  return -1;
}

// ---------------------------------------------------------------- WGSL gen

const f = (x: number) => (Number.isInteger(x) ? `${x}.0` : `${x}`);
const v = (x: V3) => `vec3f(${f(x[0])}, ${f(x[1])}, ${f(x[2])})`;

/** WGSL source defining `fn bodySdf(p: vec3f) -> f32` for this primitive list. */
export function bodySdfWgsl(prims: Primitive[] = BODY): string {
  const call = (pr: Primitive) =>
    pr.kind === 'ellipsoid'
      ? `sdEllipsoid(p, ${v(pr.c)}, ${v(pr.r)})`
      : `sdRoundCone(p, ${v(pr.a)}, ${v(pr.b)}, ${f(pr.ra)}, ${f(pr.rb)})`;
  const lines = [`  var d = ${call(prims[0])};`];
  for (let i = 1; i < prims.length; i++) lines.push(`  d = smin(d, ${call(prims[i])}, ${f(prims[i].k)});`);
  return /* wgsl */ `
fn sdEllipsoid(p: vec3f, c: vec3f, r: vec3f) -> f32 {
  let q = (p - c) / r;
  let k0 = length(q);
  let k1 = length(q / r);
  return select(-min(r.x, min(r.y, r.z)), k0 * (k0 - 1.0) / k1, k1 > 1e-9);
}
fn sdRoundCone(p: vec3f, a: vec3f, b: vec3f, r1: f32, r2: f32) -> f32 {
  let ba = b - a;
  let l2 = dot(ba, ba);
  let rr = r1 - r2;
  let a2 = l2 - rr * rr;
  let il2 = 1.0 / l2;
  let pa = p - a;
  let y = dot(pa, ba);
  let z = y - l2;
  let xv = pa * l2 - ba * y;
  let x2 = dot(xv, xv);
  let y2 = y * y * l2;
  let z2 = z * z * l2;
  let k = sign(rr) * rr * rr * x2;
  if (sign(z) * a2 * z2 > k) { return sqrt(x2 + z2) * il2 - r2; }
  if (sign(y) * a2 * y2 < k) { return sqrt(x2 + y2) * il2 - r1; }
  return (sqrt(x2 * a2 * il2) + y * rr) * il2 - r1;
}
fn smin(a: f32, b: f32, k: f32) -> f32 {
  let h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
  return mix(b, a, h) - k * h * (1.0 - h);
}
fn bodySdf(p: vec3f) -> f32 {
${lines.join('\n')}
  return d;
}
fn bodyNormal(p: vec3f) -> vec3f {
  let e = vec2f(2e-4, 0.0);
  return normalize(vec3f(
    bodySdf(p + e.xyy) - bodySdf(p - e.xyy),
    bodySdf(p + e.yxy) - bodySdf(p - e.yxy),
    bodySdf(p + e.yyx) - bodySdf(p - e.yyx)));
}
`;
}
