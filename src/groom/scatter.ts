// CPU side of groom generation: places follicles (roots) on the skin per region
// and derives per-strand parameters. Strand rest shapes are grown on the GPU.
import { type BodyMesh } from '../body/mesher';
import { type BodyPart, LANDMARKS, bodyPartAt } from '../body/sdf';
import {
  type V3, add, dot, gauss, lerp, normalize, projectTangent, rng, rotateAxis, scale, sub,
} from '../math/vec';
import { type CharacterParams, type RegionDef, androgenScale } from './atlas';
import { type RegionParams, coilShrink } from './params';

/** Floats per strand in the static strand buffer (7 × vec4). */
export const STRAND_STRIDE = 28;

/**
 * Static per-strand data, packed as 7 vec4 per strand:
 *  0 root.xyz, length (true arc length)
 *  1 normal.xyz, rootLift (rad)
 *  2 flow.xyz (unit tangent), diameter (m)
 *  3 curlRadius, curlPitch, waveAmp, wavePeriod   (macro, simulated)
 *  4 coilRadius, coilPitch, kink, phase           (micro, rendered)
 *  5 frizz, clumpStrength, shell height, surfaceFollow
 *  6 bitcast<u32>: seed, clumpLeader, flags, guide index
 */
export interface ScatterResult {
  count: number;
  data: Float32Array;
}

export const FLAG_GREY = 1;
export const FLAG_FLYAWAY = 2;
export const FLAG_LASH = 4;

let partCache: { mesh: BodyMesh; parts: BodyPart[] } | null = null;
function triangleParts(mesh: BodyMesh): BodyPart[] {
  if (partCache?.mesh === mesh) return partCache.parts;
  const P = mesh.positions;
  const I = mesh.indices;
  const parts: BodyPart[] = new Array(I.length / 3);
  for (let t = 0; t < parts.length; t++) {
    const a = I[3 * t] * 3, b = I[3 * t + 1] * 3, c = I[3 * t + 2] * 3;
    parts[t] = bodyPartAt([(P[a] + P[b] + P[c]) / 3, (P[a + 1] + P[b + 1] + P[c + 1]) / 3, (P[a + 2] + P[b + 2] + P[c + 2]) / 3]);
  }
  partCache = { mesh, parts };
  return parts;
}

interface Root {
  p: V3;
  n: V3;
  flow: V3;
}

function surfaceRoots(mesh: BodyMesh, region: RegionDef, params: RegionParams, ch: CharacterParams, densityScale: number, rand: () => number): Root[] {
  const P = mesh.positions;
  const N = mesh.normals;
  const I = mesh.indices;
  const parts = triangleParts(mesh);
  const triCount = I.length / 3;
  const weights = new Float64Array(triCount);
  let total = 0;
  const dens = params.shape.density * androgenScale(region, ch) * densityScale;
  if (dens <= 0) return [];
  for (let t = 0; t < triCount; t++) {
    const a = I[3 * t] * 3, b = I[3 * t + 1] * 3, c = I[3 * t + 2] * 3;
    const p: V3 = [(P[a] + P[b] + P[c]) / 3, (P[a + 1] + P[b + 1] + P[c + 1]) / 3, (P[a + 2] + P[b + 2] + P[c + 2]) / 3];
    const n = normalize([N[a] + N[b] + N[c], N[a + 1] + N[b + 1] + N[c + 1], N[a + 2] + N[b + 2] + N[c + 2]]);
    const m = region.mask({ p, n, part: parts[t] }, ch);
    if (m <= 0) continue;
    const w = mesh.triAreas[t] * 1e4 * dens * m; // area m² → cm²
    weights[t] = w;
    total += w;
  }
  const count = Math.round(total);
  if (count === 0) return [];
  // Stratified sampling of the CDF gives an even spread across triangles.
  const roots: Root[] = [];
  let acc = 0;
  let t = 0;
  for (let k = 0; k < count; k++) {
    const target = ((k + rand()) / count) * total;
    while (t < triCount - 1 && acc + weights[t] < target) acc += weights[t++];
    let u = rand(), v = rand();
    if (u + v > 1) { u = 1 - u; v = 1 - v; }
    const a = I[3 * t] * 3, b = I[3 * t + 1] * 3, c = I[3 * t + 2] * 3;
    const w0 = 1 - u - v;
    const p: V3 = [
      P[a] * w0 + P[b] * u + P[c] * v,
      P[a + 1] * w0 + P[b + 1] * u + P[c + 1] * v,
      P[a + 2] * w0 + P[b + 2] * u + P[c + 2] * v,
    ];
    const n = normalize([
      N[a] * w0 + N[b] * u + N[c] * v,
      N[a + 1] * w0 + N[b + 1] * u + N[c + 1] * v,
      N[a + 2] * w0 + N[b + 2] * u + N[c + 2] * v,
    ]);
    let flow = projectTangent(region.flow({ p, n, part: parts[t] }, ch), n);
    if (Math.hypot(...flow) < 1e-6) flow = projectTangent([0, -1, 0.01], n);
    roots.push({ p, n, flow: normalize(flow) });
  }
  return roots;
}

function lashRoots(region: RegionDef, params: RegionParams, densityScale: number, rand: () => number): Root[] {
  const upper = region.emitter === 'lashUpper';
  const perEye = Math.round(params.shape.density * Math.min(1, densityScale * 4));
  const roots: Root[] = [];
  const R = LANDMARKS.eyeRadius + 0.0012;
  for (const eye of [LANDMARKS.eyeL, LANDMARKS.eyeR]) {
    const side = Math.sign(eye[0]);
    for (let k = 0; k < perEye; k++) {
      const u = -1 + (2 * (k + rand())) / perEye; // across the lid, medial → lateral
      const az = side * u * 0.85 + side * 0.15; // lids sit slightly lateral
      const el = (upper ? 0.42 : -0.5) * (1 - 0.35 * u * u);
      const dir: V3 = [Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)];
      const p = add(eye, scale(dir, R));
      const n = dir;
      const flow = normalize(projectTangent([side * u * 0.3, upper ? 1 : -1, 0], n));
      roots.push({ p, n, flow });
    }
  }
  return roots;
}

/** Nearest member of `leaders` (by root distance) for every root, via a uniform grid. */
function nearestLeaders(roots: Root[], leaders: number[], cell: number): Int32Array {
  const key = (x: number, y: number, z: number) => `${x},${y},${z}`;
  const grid = new Map<string, number[]>();
  for (const l of leaders) {
    const p = roots[l].p;
    const k = key(Math.floor(p[0] / cell), Math.floor(p[1] / cell), Math.floor(p[2] / cell));
    (grid.get(k) ?? grid.set(k, []).get(k)!).push(l);
  }
  const out = new Int32Array(roots.length);
  roots.forEach((r, i) => {
    const cx = Math.floor(r.p[0] / cell), cy = Math.floor(r.p[1] / cell), cz = Math.floor(r.p[2] / cell);
    let best = -1;
    let bestD = Infinity;
    for (let ring = 1; ring <= 3 && best < 0; ring++) {
      for (let dz = -ring; dz <= ring; dz++)
        for (let dy = -ring; dy <= ring; dy++)
          for (let dx = -ring; dx <= ring; dx++) {
            for (const l of grid.get(key(cx + dx, cy + dy, cz + dz)) ?? []) {
              const d = sub(roots[l].p, r.p);
              const dd = dot(d, d);
              if (dd < bestD) { bestD = dd; best = l; }
            }
          }
    }
    if (best < 0) {
      for (const l of leaders) {
        const d = sub(roots[l].p, r.p);
        const dd = dot(d, d);
        if (dd < bestD) { bestD = dd; best = l; }
      }
    }
    out[i] = best;
  });
  return out;
}

/** Pick ~count/stride members at random (at least one). */
function pickSubset(count: number, stride: number, rand: () => number): number[] {
  const out: number[] = [];
  const pr = 1 / Math.max(1, stride);
  for (let i = 0; i < count; i++) if (rand() < pr) out.push(i);
  if (out.length === 0 && count > 0) out.push(0);
  return out;
}

export interface LayerGeometry extends ScatterResult {
  /** Strand index of each simulated guide. */
  guideStrand: Uint32Array;
  simPoints: number;
  renderPoints: number;
}

/** Upper bound on render points per layer (memory: 16 B each). */
export const MAX_RENDER_POINTS_TOTAL = 6_000_000;
/** Simulated points are held in private arrays in the kernels. */
export const MAX_SIM_POINTS = 64;

export function scatterRegion(
  mesh: BodyMesh,
  region: RegionDef,
  params: RegionParams,
  ch: CharacterParams,
  densityScale: number,
  seed: number,
  guideStride = 12,
): LayerGeometry {
  const rand = rng(seed * 7919 + region.id.length * 104729 + ch.seed * 13);
  const roots = region.emitter === 'surface'
    ? surfaceRoots(mesh, region, params, ch, densityScale, rand)
    : lashRoots(region, params, densityScale, rand);
  const count = roots.length;
  const data = new Float32Array(count * STRAND_STRIDE);
  const u32 = new Uint32Array(data.buffer);
  const s = params.shape;

  // Resolution: enough sim points to resolve macro curls, enough render points for coils.
  const shrink = coilShrink(s.coilRadius, s.coilPitch);
  const maxLen = s.length * (1 + s.lengthVar);
  const centerline = maxLen * shrink;
  let simPoints = region.simPoints;
  let macroToCoil = false;
  if (s.curlRadius > 0 && region.emitter === 'surface') {
    const want = Math.ceil(centerline / (s.curlPitch / 5)) + 1;
    simPoints = Math.min(MAX_SIM_POINTS, Math.max(simPoints, want));
    // A helix the sim cannot resolve is rendered as a coil instead.
    macroToCoil = centerline / (simPoints - 1) > s.curlPitch / 4 && s.coilRadius === 0;
  }
  const coilR0 = macroToCoil ? s.curlRadius : s.coilRadius;
  const coilP0 = macroToCoil ? s.curlPitch : s.coilPitch;
  let renderPoints = Math.max(region.renderPoints, simPoints * 2);
  if (coilR0 > 0) renderPoints = Math.max(renderPoints, Math.ceil((maxLen * coilShrink(coilR0, coilP0)) / coilP0 * 8));
  renderPoints = Math.max(2, Math.min(256, renderPoints, Math.floor(MAX_RENDER_POINTS_TOTAL / Math.max(count, 1))));

  // Clumps: pick leaders, attach every strand to its nearest leader.
  const spacing = Math.sqrt(1 / Math.max(s.density, 1e-3)) * 0.01; // m between follicles
  const leaders = pickSubset(count, s.clumpSize, rand);
  const leaderOf = s.clumpSize > 1 && count > 0
    ? nearestLeaders(roots, leaders, spacing * Math.sqrt(s.clumpSize) * 1.5)
    : null;
  // Simulated guides: a random subset; every strand follows its nearest guide.
  const guides = pickSubset(count, guideStride, rand);
  const guideOf = count > 0 ? nearestLeaders(roots, guides, spacing * Math.sqrt(guideStride) * 1.5) : new Int32Array(0);
  const guideIndex = new Map<number, number>(guides.map((sIdx, g) => [sIdx, g]));

  for (let i = 0; i < count; i++) {
    const r = roots[i];
    const o = i * STRAND_STRIDE;
    const curlJ = 1 + s.curlVar * gauss(rand) * 0.5;
    const flyaway = rand() < s.flyaway;
    const coilR = coilR0 * curlJ;
    const coilP = coilP0 * curlJ;
    const length = Math.max(0.0005, s.length * (1 + s.lengthVar * gauss(rand) * 0.5));
    // Small random twist of the flow keeps neighbouring strands from looking combed.
    const flow = normalize(rotateAxis(r.flow, r.n, gauss(rand) * 0.08));
    data.set([...r.p, length], o);
    data.set([...r.n, (s.rootLift * Math.PI) / 180 * (1 + 0.25 * gauss(rand))], o + 4);
    data.set([...flow, s.diameter * 1e-6 * Math.max(0.3, 1 + s.diameterVar * gauss(rand) * 0.5)], o + 8);
    data.set([macroToCoil ? 0 : s.curlRadius * curlJ, s.curlPitch * curlJ, s.waveAmp * curlJ, s.wavePeriod * curlJ], o + 12);
    data.set([coilR, coilP, s.kink, rand() * Math.PI * 2], o + 16);
    data.set([
      s.frizz * (flyaway ? 6 : 1),
      s.clumpStrength * lerp(0.6, 1, rand()),
      Math.pow(rand(), 1.5) * s.volume,
      s.surfaceFollow,
    ], o + 20);
    let flags = 0;
    if (rand() < params.look.grey) flags |= FLAG_GREY;
    if (flyaway) flags |= FLAG_FLYAWAY;
    if (region.emitter !== 'surface') flags |= FLAG_LASH;
    u32[o + 24] = (seed * 2654435761 + i * 40503) >>> 0;
    u32[o + 25] = leaderOf ? leaderOf[i] : i;
    u32[o + 26] = flags;
    u32[o + 27] = guideIndex.get(guideOf[i])!;
  }
  return { count, data, guideStrand: Uint32Array.from(guides), simPoints, renderPoints };
}
