// Narrow-band surface-nets mesher for the body SDF.
// Blocks far from the surface are skipped entirely, and each active block
// evaluates only the primitives that can influence it, so meshing the full
// figure stays fast enough to run at startup.
import { BODY, type Primitive, bodySdf, bodySdfXYZ } from './sdf';
import type { V3 } from '../math/vec';

export interface BodyMesh {
  positions: Float32Array; // xyz
  normals: Float32Array; // xyz
  indices: Uint32Array;
  /** Per-triangle area, used for area-weighted root scattering. */
  triAreas: Float32Array;
}

const BLOCK = 6;

function primBound(pr: Primitive): { c: V3; r: number } {
  if (pr.kind === 'ellipsoid') return { c: pr.c, r: Math.max(...pr.r) };
  const c: V3 = [(pr.a[0] + pr.b[0]) / 2, (pr.a[1] + pr.b[1]) / 2, (pr.a[2] + pr.b[2]) / 2];
  const h = Math.hypot(pr.b[0] - pr.a[0], pr.b[1] - pr.a[1], pr.b[2] - pr.a[2]) / 2;
  return { c, r: h + Math.max(pr.ra, pr.rb) };
}

export function meshBody(h = 0.004, prims: Primitive[] = BODY): BodyMesh {
  const lo: V3 = [Infinity, Infinity, Infinity];
  const hi: V3 = [-Infinity, -Infinity, -Infinity];
  for (const b of prims.map(primBound)) {
    for (let a = 0; a < 3; a++) {
      lo[a] = Math.min(lo[a], b.c[a] - b.r - 4 * h);
      hi[a] = Math.max(hi[a], b.c[a] + b.r + 4 * h);
    }
  }
  const [bx, by, bz] = [0, 1, 2].map((a) => Math.ceil((hi[a] - lo[a]) / h / BLOCK));
  const [nx, ny, nz] = [bx * BLOCK, by * BLOCK, bz * BLOCK];
  const vx = nx + 1;
  const vy = ny + 1;
  const field = new Float32Array(vx * vy * (nz + 1)).fill(NaN);
  const vid = (i: number, j: number, k: number) => i + vx * (j + vy * k);

  // 1. Classify blocks; evaluate the exact field only in the narrow band.
  const bDiag = Math.sqrt(3) * BLOCK * h * 0.5;
  const active: number[] = [];
  for (let bk = 0; bk < bz; bk++)
    for (let bj = 0; bj < by; bj++)
      for (let bi = 0; bi < bx; bi++) {
        const c: V3 = [lo[0] + (bi + 0.5) * BLOCK * h, lo[1] + (bj + 0.5) * BLOCK * h, lo[2] + (bk + 0.5) * BLOCK * h];
        const dc = bodySdf(c, prims);
        const isActive = Math.abs(dc) <= bDiag + 2 * h;
        if (!isActive) continue;
        active.push(bi, bj, bk);
        // Keep primitives that can influence the smooth union inside this block.
        const ds = prims.map((pr) => bodySdf(c, [pr]));
        const dmin = Math.min(...ds);
        const local = prims.filter((pr, i) => ds[i] < dmin + 2 * bDiag + pr.k + 0.002);
        for (let k = bk * BLOCK; k <= (bk + 1) * BLOCK; k++)
          for (let j = bj * BLOCK; j <= (bj + 1) * BLOCK; j++) {
            let id = vid(bi * BLOCK, j, k);
            for (let i = bi * BLOCK; i <= (bi + 1) * BLOCK; i++, id++) {
              // Faces shared between active blocks are evaluated once.
              if (Number.isNaN(field[id])) field[id] = bodySdfXYZ(lo[0] + i * h, lo[1] + j * h, lo[2] + k * h, local);
            }
          }
      }
  // Vertices outside active blocks stay NaN; they are never read because
  // cells and edges below are only visited inside active blocks.

  // 2. One vertex per straddling cell (cells only straddle in active blocks).
  const cellVert = new Map<number, number>();
  const cid = (i: number, j: number, k: number) => i + nx * (j + ny * k);
  const pos: number[] = [];
  const corners = [
    [0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0],
    [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1],
  ];
  const cornerOff = corners.map(([di, dj, dk]) => di + vx * (dj + vy * dk));
  const edges = [
    [0, 1], [2, 3], [4, 5], [6, 7],
    [0, 2], [1, 3], [4, 6], [5, 7],
    [0, 4], [1, 5], [2, 6], [3, 7],
  ];
  const cv = new Float64Array(8);
  const forActiveRange = (fn: (i: number, j: number, k: number) => void) => {
    for (let a = 0; a < active.length; a += 3) {
      const [bi, bj, bk] = [active[a], active[a + 1], active[a + 2]];
      for (let k = bk * BLOCK; k < (bk + 1) * BLOCK; k++)
        for (let j = bj * BLOCK; j < (bj + 1) * BLOCK; j++)
          for (let i = bi * BLOCK; i < (bi + 1) * BLOCK; i++) fn(i, j, k);
    }
  };
  forActiveRange((i, j, k) => {
    const base = vid(i, j, k);
    let mask = 0;
    for (let c = 0; c < 8; c++) {
      const fv = field[base + cornerOff[c]];
      cv[c] = fv;
      if (fv < 0) mask |= 1 << c;
    }
    if (mask === 0 || mask === 255) return;
    let sx = 0, sy = 0, sz = 0, cnt = 0;
    for (let e = 0; e < 12; e++) {
      const a = edges[e][0], b = edges[e][1];
      if ((cv[a] < 0) === (cv[b] < 0)) continue;
      const t = cv[a] / (cv[a] - cv[b]);
      const ca = corners[a], cb = corners[b];
      sx += ca[0] + (cb[0] - ca[0]) * t;
      sy += ca[1] + (cb[1] - ca[1]) * t;
      sz += ca[2] + (cb[2] - ca[2]) * t;
      cnt++;
    }
    cellVert.set(cid(i, j, k), pos.length / 3);
    pos.push(lo[0] + (i + sx / cnt) * h, lo[1] + (j + sy / cnt) * h, lo[2] + (k + sz / cnt) * h);
  });

  // 3. A quad across each sign-changing grid edge.
  const idx: number[] = [];
  const cell = (i: number, j: number, k: number) => cellVert.get(cid(i, j, k)) ?? -1;
  const quad = (a: number, b: number, c: number, d: number, flip: boolean) => {
    if (a < 0 || b < 0 || c < 0 || d < 0) return;
    if (flip) idx.push(a, c, b, a, d, c);
    else idx.push(a, b, c, a, c, d);
  };
  forActiveRange((i, j, k) => {
    if (i === 0 || j === 0 || k === 0) return;
    const inside0 = field[vid(i, j, k)] < 0;
    if (inside0 !== field[vid(i + 1, j, k)] < 0)
      quad(cell(i, j - 1, k - 1), cell(i, j, k - 1), cell(i, j, k), cell(i, j - 1, k), !inside0);
    if (inside0 !== field[vid(i, j + 1, k)] < 0)
      quad(cell(i - 1, j, k - 1), cell(i - 1, j, k), cell(i, j, k), cell(i, j, k - 1), !inside0);
    if (inside0 !== field[vid(i, j, k + 1)] < 0)
      quad(cell(i - 1, j - 1, k), cell(i, j - 1, k), cell(i, j, k), cell(i - 1, j, k), !inside0);
  });

  // 4. Area-weighted vertex normals and per-triangle areas.
  const positions = new Float32Array(pos);
  const indices = new Uint32Array(idx);
  const normals = new Float32Array(pos.length);
  const triAreas = new Float32Array(indices.length / 3);
  for (let t = 0; t < triAreas.length; t++) {
    const a = indices[3 * t] * 3, b = indices[3 * t + 1] * 3, c = indices[3 * t + 2] * 3;
    const ux = positions[b] - positions[a], uy = positions[b + 1] - positions[a + 1], uz = positions[b + 2] - positions[a + 2];
    const wx = positions[c] - positions[a], wy = positions[c + 1] - positions[a + 1], wz = positions[c + 2] - positions[a + 2];
    const gx = uy * wz - uz * wy, gy = uz * wx - ux * wz, gz = ux * wy - uy * wx;
    triAreas[t] = 0.5 * Math.hypot(gx, gy, gz);
    for (const v of [a, b, c]) {
      normals[v] += gx;
      normals[v + 1] += gy;
      normals[v + 2] += gz;
    }
  }
  for (let v = 0; v < normals.length; v += 3) {
    const l = Math.hypot(normals[v], normals[v + 1], normals[v + 2]) || 1;
    normals[v] /= l;
    normals[v + 1] /= l;
    normals[v + 2] /= l;
  }
  return { positions, normals, indices, triAreas };
}
