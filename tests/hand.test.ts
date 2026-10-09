import { it, expect } from 'vitest';
import { capsuleMesh } from '../src/app/hand';
it('capsule mesh winds outward (CCW from outside)', () => {
  const { vertices: V, indices: I } = capsuleMesh([{ a: [0, 0, 0], b: [0, 0.05, 0], r: 0.01 }]);
  let ok = 0, total = 0;
  for (let t = 0; t < I.length / 3; t++) {
    const [a, b, c] = [I[3 * t], I[3 * t + 1], I[3 * t + 2]].map((i) => i * 6);
    const u = [V[b] - V[a], V[b + 1] - V[a + 1], V[b + 2] - V[a + 2]];
    const w = [V[c] - V[a], V[c + 1] - V[a + 1], V[c + 2] - V[a + 2]];
    const g = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
    const len = Math.hypot(g[0], g[1], g[2]);
    if (len < 1e-12) continue;
    total++;
    if (g[0] * V[a + 3] + g[1] * V[a + 4] + g[2] * V[a + 5] > 0) ok++;
  }
  expect(ok / total).toBeGreaterThan(0.95);
});
