import { it, expect } from 'vitest';
import { buildShaderSources } from '../src/gpu/shaders';
it('resolves all shader modules', () => {
  const src = buildShaderSources();
  for (const [k, v] of Object.entries(src)) {
    expect(v.length, k).toBeGreaterThan(100);
  }
  console.log(src.sim.split('\n').filter((l) => l.includes('@group')).join('\n'));
  console.log(src.hair.split('\n').filter((l) => l.includes('@group') || l.startsWith('struct')).join('\n'));
});
