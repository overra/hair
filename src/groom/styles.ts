// Quick scalp style presets, expressed purely as parameters.
import { type CurlType, PIGMENTS, type RegionParams, applyCurlType } from './params';

export interface StylePreset {
  curl: CurlType;
  length: number;
  apply?: (p: RegionParams) => void;
}

export const STYLES: Record<string, StylePreset> = {
  'Long straight': { curl: '1A', length: 0.38, apply: (p) => { p.shape.volume = 0.01; p.physics.hold = 0.08; } },
  'Shoulder wavy (2B)': { curl: '2B', length: 0.26 },
  'Curly (3B)': { curl: '3B', length: 0.24, apply: (p) => { p.shape.volume = 0.025; p.shape.rootLift = 45; p.physics.bendStiffness = 0.6; } },
  'Coily afro (4C)': {
    curl: '4C', length: 0.16,
    apply: (p) => {
      p.shape.volume = 0.05; p.shape.rootLift = 70; p.shape.surfaceFollow = 0.25;
      p.physics.bendStiffness = 0.85; p.physics.hold = 0.55; p.physics.holdFalloff = 0.5;
      [p.look.eumelanin, p.look.pheomelanin] = PIGMENTS.black;
    },
  },
  'Short crop': { curl: '1C', length: 0.05, apply: (p) => { p.shape.rootLift = 40; p.physics.bendStiffness = 0.8; p.physics.hold = 0.5; } },
  'Buzz cut': { curl: '1B', length: 0.006, apply: (p) => { p.shape.rootLift = 50; p.physics.hold = 1; } },
};

export function applyStyle(p: RegionParams, name: string) {
  const s = STYLES[name];
  if (!s) return;
  applyCurlType(p.shape, s.curl);
  p.shape.length = s.length;
  s.apply?.(p);
}
