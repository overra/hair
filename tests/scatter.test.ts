import { describe, it, expect } from 'vitest';
import { meshBody } from '../src/body/mesher';
import { REGIONS, defaultCharacter } from '../src/groom/atlas';
import { scatterRegion, STRAND_STRIDE } from '../src/groom/scatter';

describe('scatterRegion', () => {
  const mesh = meshBody(0.004);
  const ch = defaultCharacter();
  it('places plausible strand counts per region', { timeout: 60000 }, () => {
    const counts: Record<string, string> = {};
    for (const r of REGIONS) {
      const p = r.defaults();
      const t0 = performance.now();
      const g = scatterRegion(mesh, r, p, ch, 1, 1);
      counts[r.id] = `${g.count} strands, ${g.guideStrand.length} guides, N=${g.simPoints} M=${g.renderPoints}, ${(performance.now() - t0).toFixed(0)}ms`;
      expect(g.data.length).toBe(g.count * STRAND_STRIDE);
      const u = new Uint32Array(g.data.buffer);
      for (let i = 0; i < g.count; i += 97) {
        const gi = u[i * STRAND_STRIDE + 27];
        expect(gi).toBeLessThan(g.guideStrand.length);
      }
    }
    console.log(counts);
    expect(parseInt(counts.scalp)).toBeGreaterThan(30000);
    expect(parseInt(counts.lashesUpper)).toBeGreaterThan(100);
  });
});
