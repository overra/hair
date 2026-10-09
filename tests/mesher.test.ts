import { describe, it, expect } from 'vitest';
import { meshBody } from '../src/body/mesher';
import { BODY, bodySdf } from '../src/body/sdf';

describe('meshBody', () => {
  it("produces an outward-facing surface on the SDF zero set", { timeout: 30000 }, () => {
    const t0 = performance.now();
    const m = meshBody(0.004, BODY);
    const ms = performance.now() - t0;
    console.log(`verts=${m.positions.length / 3} tris=${m.indices.length / 3} ${ms.toFixed(0)}ms`);
    expect(m.indices.length).toBeGreaterThan(1000);
    let maxErr = 0;
    for (let v = 0; v < m.positions.length / 3; v += 97) {
      const p: [number, number, number] = [m.positions[3 * v], m.positions[3 * v + 1], m.positions[3 * v + 2]];
      maxErr = Math.max(maxErr, Math.abs(bodySdf(p)));
    }
    expect(maxErr).toBeLessThan(0.004);
    // Winding: geometric normals should agree with SDF normals.
    let agree = 0, total = 0;
    for (let t = 0; t < m.indices.length / 3; t += 13) {
      const [a, b, c] = [m.indices[3 * t], m.indices[3 * t + 1], m.indices[3 * t + 2]].map((i) => i * 3);
      const P = m.positions, N = m.normals;
      const u = [P[b] - P[a], P[b + 1] - P[a + 1], P[b + 2] - P[a + 2]];
      const w = [P[c] - P[a], P[c + 1] - P[a + 1], P[c + 2] - P[a + 2]];
      const g = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
      if (g[0] * N[a] + g[1] * N[a + 1] + g[2] * N[a + 2] > 0) agree++;
      total++;
    }
    expect(agree / total).toBeGreaterThan(0.98);
  });
});
