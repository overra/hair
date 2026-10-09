// The body hair atlas: where each kind of hair grows, how dense it is, and
// which way it flows. Masks are soft (0..1) density multipliers evaluated on
// the skin surface; flow fields return a direction that is projected onto the
// skin tangent plane by the generator.
import { type BodyPart, LANDMARKS } from '../body/sdf';
import {
  type V3, add, clamp, cross, dot, len, lerp, normalize, scale, smoothstep, sub,
} from '../math/vec';
import { type RegionParams, applyCurlType, defaultLook, defaultPhysics, defaultShape } from './params';

export type RegionId =
  | 'scalp' | 'eyebrows' | 'lashesUpper' | 'lashesLower' | 'beard' | 'mustache'
  | 'chest' | 'abdomen' | 'axillary' | 'pubic' | 'arms' | 'forearms' | 'hands'
  | 'legs' | 'feet' | 'back' | 'vellus';

/** Character-wide controls that modulate the whole atlas. */
export interface CharacterParams {
  /** Androgen-driven terminal hair (0 = typical female, 1 = very hirsute male). */
  androgen: number;
  /** Male/female pattern hair loss (0 = none, 1 = Norwood VII). */
  hairLoss: number;
  /** Clockwise (+1) / counter-clockwise (-1) crown whorl. */
  whorlSpin: number;
  /** Part position: -1 = left side, 0 = center/none, +1 = right side. */
  part: number;
  /** Whether a part line is used at all. */
  usePart: boolean;
  /** Front hairline: 0 = swept back / to the side, 1 = falls forward as bangs. */
  fringe: number;
  seed: number;
}

export const defaultCharacter = (): CharacterParams => ({
  androgen: 0.5,
  hairLoss: 0,
  whorlSpin: 1,
  part: 0.35,
  usePart: true,
  fringe: 0.2,
  seed: 1,
});

export interface SurfaceSample {
  p: V3;
  n: V3;
  part: BodyPart;
}

export interface RegionDef {
  id: RegionId;
  label: string;
  /** How roots are placed. */
  emitter: 'surface' | 'lashUpper' | 'lashLower';
  /** Simulated points per strand. */
  simPoints: number;
  /** Rendered points per strand. */
  renderPoints: number;
  /** Soft density mask at a surface sample. */
  mask(s: SurfaceSample, c: CharacterParams): number;
  /** Preferred growth direction at a surface sample (world space). */
  flow(s: SurfaceSample, c: CharacterParams): V3;
  /** How much the region's density scales with androgen (0 = not at all). */
  androgenic: number;
  defaults(): RegionParams;
}

// ------------------------------------------------------------ head frame

const H = LANDMARKS.headCenter;
const DEG = Math.PI / 180;

/** Azimuth (0 = facing forward, + toward subject's left) and elevation around the head center. */
function headAngles(p: V3) {
  const q = sub(p, H);
  return { az: Math.atan2(q[0], q[2]), el: Math.atan2(q[1], Math.hypot(q[0], q[2])), q };
}

/** Periodic piecewise-linear table lookup over |azimuth| in degrees. */
function table(azDeg: number, pts: [number, number][]) {
  const a = Math.abs(azDeg);
  for (let i = 1; i < pts.length; i++) {
    if (a <= pts[i][0]) {
      const t = (a - pts[i - 1][0]) / (pts[i][0] - pts[i - 1][0]);
      return lerp(pts[i - 1][1], pts[i][1], smoothstep(0, 1, t));
    }
  }
  return pts[pts.length - 1][1];
}

/** Scalp hairline elevation (degrees) as a function of azimuth. */
function hairlineEl(azDeg: number, recession: number) {
  return table(azDeg, [
    [0, 27 + 6 * recession],
    [22, 28 + 14 * recession], // temporal recession forms the "M"
    [45, 16 + 10 * recession],
    [68, 6],
    [80, -10], // sideburn
    [88, -6],
    [110, -14], // behind the ear
    [140, -38],
    [180, -50], // nape
  ]);
}

const isHead = (part: BodyPart) =>
  part === 'cranium' || part === 'face' || part === 'jaw' || part === 'brow' || part === 'nose';

function ellipseFalloff(d: number, r: number, soft: number) {
  return 1 - smoothstep(r - soft, r + soft, d);
}

/** Distance from 2D point to polyline. */
function distPolyline2(x: number, y: number, pts: [number, number][]) {
  let best = Infinity;
  let tBest = 0;
  let acc = 0;
  let total = 0;
  for (let i = 1; i < pts.length; i++) total += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  for (let i = 1; i < pts.length; i++) {
    const [ax, ay] = pts[i - 1];
    const [bx, by] = pts[i];
    const dx = bx - ax, dy = by - ay;
    const l2 = dx * dx + dy * dy;
    const t = clamp(((x - ax) * dx + (y - ay) * dy) / l2, 0, 1);
    const d = Math.hypot(x - ax - t * dx, y - ay - t * dy);
    const seg = Math.sqrt(l2);
    if (d < best) {
      best = d;
      tBest = (acc + t * seg) / total;
    }
    acc += seg;
  }
  return { d: best, t: tBest };
}

/** Eyebrow centerline in (|x|, y) for the subject's side. */
const BROW: [number, number][] = [
  [0.011, 1.652], [0.022, 1.659], [0.036, 1.663], [0.048, 1.66], [0.058, 1.652],
];
const browHalfWidth = (t: number) => lerp(0.0055, 0.0022, t);

// Limb axes for flow.
const limbAxis = (a: V3, b: V3, p: V3): V3 => {
  const mirrored = p[0] < 0;
  const A: V3 = mirrored ? [-a[0], a[1], a[2]] : a;
  const B: V3 = mirrored ? [-b[0], b[1], b[2]] : b;
  return normalize(sub(B, A));
};

// ------------------------------------------------------------ regions

const region = (
  r: Omit<RegionDef, 'defaults'> & { defaults: (p: RegionParams) => void },
): RegionDef => ({
  ...r,
  defaults: () => {
    const p: RegionParams = { enabled: true, shape: defaultShape(), look: defaultLook(), physics: defaultPhysics() };
    r.defaults(p);
    return p;
  },
});

export const REGIONS: RegionDef[] = [
  region({
    id: 'scalp',
    label: 'Scalp',
    emitter: 'surface',
    simPoints: 32,
    renderPoints: 64,
    androgenic: 0,
    mask: ({ p, part }, c) => {
      if (!isHead(part) && part !== 'neck') return 0;
      const { az, el, q } = headAngles(p);
      if (q[1] < -0.12) return 0;
      const azDeg = az / DEG;
      const elDeg = el / DEG;
      const line = hairlineEl(azDeg, c.hairLoss);
      let w = smoothstep(line - 1.5, line + 3, elDeg);
      // Keep sideburns narrow: no hair on the cheek in front of them.
      if (Math.abs(azDeg) < 74 && elDeg < 4) w *= 1 - smoothstep(-2, 6, 74 - Math.abs(azDeg));
      // Pattern loss: vertex thinning around the whorl and frontal recession.
      if (c.hairLoss > 0) {
        const dWhorl = len(sub(p, LANDMARKS.crownWhorl));
        w *= 1 - c.hairLoss * ellipseFalloff(dWhorl, 0.02 + 0.07 * c.hairLoss, 0.015);
        if (c.hairLoss > 0.5) {
          const top = smoothstep(10, 40, elDeg) * smoothstep(-110, -60, -Math.abs(azDeg));
          w *= 1 - smoothstep(0.5, 1, c.hairLoss) * top;
        }
      }
      return w;
    },
    flow: ({ p, n }, c) => {
      // Radial from the crown whorl, spiralling near it.
      const w = LANDMARKS.crownWhorl;
      let d = sub(p, w);
      const r = len(d);
      const spin = c.whorlSpin * (1 - smoothstep(0.0, 0.06, r)) * 1.4;
      d = add(normalize(d), scale(cross(n, normalize(d)), spin));
      // Part line: hair on each side combs away from it.
      if (c.usePart) {
        const partX = c.part * 0.045;
        const { q, el } = headAngles(p);
        const nearTop = smoothstep(0.2, 0.6, el) * smoothstep(-0.06, 0.02, q[2] - (-0.03));
        const side = Math.sign(p[0] - partX) || 1;
        const away: V3 = [side, -0.25, 0];
        d = normalize(add(scale(normalize(d), 1 - nearTop), scale(away, nearTop * 1.5)));
      }
      // Front hairline: sweep away from the face unless bangs are wanted.
      {
        const { az, el } = headAngles(p);
        const front = (1 - smoothstep(0.6, 1.3, Math.abs(az))) * (1 - smoothstep(0.75, 1.2, el));
        const side = Math.sign(p[0] - (c.usePart ? c.part * 0.045 : 0)) || 1;
        const sweep: V3 = [side * 0.8, 0.15, -1];
        const w = front * (1 - c.fringe);
        d = normalize(add(scale(normalize(d), 1 - w), scale(normalize(sweep), w * 1.5)));
      }
      // Bias downward on the sides and back.
      return add(normalize(d), [0, -0.35, 0]);
    },
    defaults: (p) => {
      Object.assign(p.shape, {
        density: 180, length: 0.3, lengthVar: 0.12, diameter: 75, rootLift: 25,
        surfaceFollow: 0.75, volume: 0.012, tipTaper: 0.15,
      });
      applyCurlType(p.shape, '1B');
      p.physics.bendStiffness = 0.35;
      p.physics.hold = 0.12;
      p.physics.holdFalloff = 3;
    },
  }),
  region({
    id: 'eyebrows',
    label: 'Eyebrows',
    emitter: 'surface',
    simPoints: 4,
    renderPoints: 8,
    androgenic: 0.15,
    mask: ({ p, part }) => {
      if (!isHead(part) || p[2] < 0.05) return 0;
      const { d, t } = distPolyline2(Math.abs(p[0]), p[1], BROW);
      return ellipseFalloff(d, browHalfWidth(t), 0.0015);
    },
    flow: ({ p }) => {
      const side = Math.sign(p[0]) || 1;
      const { t } = distPolyline2(Math.abs(p[0]), p[1], BROW);
      const up = lerp(1.6, -0.35, smoothstep(0, 0.6, t));
      return normalize([side * 1, up, 0.15]);
    },
    defaults: (p) => {
      Object.assign(p.shape, {
        density: 120, length: 0.009, lengthVar: 0.35, diameter: 85, rootLift: 18,
        surfaceFollow: 0.95, volume: 0.0005, tipTaper: 0.5, frizz: 0.08,
      });
      p.look.eumelanin = 1.8;
      p.physics.bendStiffness = 0.95;
      p.physics.hold = 0.9;
    },
  }),
  region({
    id: 'lashesUpper',
    label: 'Eyelashes (upper)',
    emitter: 'lashUpper',
    simPoints: 4,
    renderPoints: 8,
    androgenic: 0,
    mask: () => 1,
    flow: () => [0, 1, 0],
    defaults: (p) => {
      Object.assign(p.shape, {
        density: 130, length: 0.0095, lengthVar: 0.3, diameter: 110, rootLift: 65,
        tipTaper: 0.6, frizz: 0.02, curlRadius: 0.009,
      });
      p.look.eumelanin = 6;
      p.physics.bendStiffness = 1;
      p.physics.hold = 1;
    },
  }),
  region({
    id: 'lashesLower',
    label: 'Eyelashes (lower)',
    emitter: 'lashLower',
    simPoints: 4,
    renderPoints: 6,
    androgenic: 0,
    mask: () => 1,
    flow: () => [0, -1, 0],
    defaults: (p) => {
      Object.assign(p.shape, {
        density: 70, length: 0.0055, lengthVar: 0.3, diameter: 80, rootLift: 70,
        tipTaper: 0.6, frizz: 0.02, curlRadius: 0.012,
      });
      p.look.eumelanin = 5;
      p.physics.bendStiffness = 1;
      p.physics.hold = 1;
    },
  }),
  region({
    id: 'beard',
    label: 'Beard',
    emitter: 'surface',
    simPoints: 8,
    renderPoints: 16,
    androgenic: 1,
    mask: ({ p, part }) => {
      if (!isHead(part) && part !== 'neck') return 0;
      const { az, el, q } = headAngles(p);
      const azDeg = Math.abs(az / DEG);
      const elDeg = el / DEG;
      if (azDeg > 100) return 0;
      // Cheek line: from sideburn base down toward the mouth corner.
      const cheek = table(azDeg, [[0, -20], [25, -24], [45, -27], [70, -21], [85, -12], [100, -18]]);
      let w = smoothstep(cheek + 2, cheek - 3, elDeg);
      // Neck line under the jaw.
      w *= smoothstep(-0.135, -0.11, q[1]);
      if (q[2] < -0.02) w *= smoothstep(-0.05, -0.02, q[2]);
      // Clear the lips and a gap under the lower lip.
      const m = sub(p, LANDMARKS.mouth);
      const lip = Math.hypot(m[0] / 0.026, m[1] / 0.011);
      w *= smoothstep(1.0, 1.25, lip);
      // The mustache region is separate.
      if (Math.abs(m[0]) < 0.03 && m[1] > 0 && m[1] < 0.03) w = 0;
      return w;
    },
    flow: ({ p }) => {
      const side = Math.sign(p[0]) || 1;
      const { q } = headAngles(p);
      const onNeck = smoothstep(-0.09, -0.11, q[1]);
      return normalize([side * 0.15, -1, 0.25 * (1 - onNeck)]);
    },
    defaults: (p) => {
      Object.assign(p.shape, {
        density: 60, length: 0.006, lengthVar: 0.3, diameter: 110, rootLift: 30,
        surfaceFollow: 0.6, volume: 0.002, frizz: 0.15, ellipticity: 0.6,
      });
      applyCurlType(p.shape, '2C');
      p.shape.clumpSize = 3;
      p.shape.clumpStrength = 0.2;
      p.look.eumelanin = 1.6;
      p.look.pheomelanin = 0.5;
      p.physics.bendStiffness = 0.8;
      p.physics.hold = 0.6;
    },
  }),
  region({
    id: 'mustache',
    label: 'Mustache',
    emitter: 'surface',
    simPoints: 6,
    renderPoints: 12,
    androgenic: 1,
    mask: ({ p, part }) => {
      if (!isHead(part)) return 0;
      const m = sub(p, LANDMARKS.mouth);
      if (m[2] < -0.02) return 0;
      const inX = 1 - smoothstep(0.024, 0.03, Math.abs(m[0]));
      const inY = smoothstep(0.006, 0.01, m[1]) * (1 - smoothstep(0.02, 0.026, m[1] - Math.abs(m[0]) * 0.2));
      return inX * inY;
    },
    flow: ({ p }) => normalize([(Math.sign(p[0]) || 1) * 0.55, -1, 0.3]),
    defaults: (p) => {
      Object.assign(p.shape, {
        density: 70, length: 0.008, lengthVar: 0.25, diameter: 110, rootLift: 25,
        surfaceFollow: 0.7, frizz: 0.12,
      });
      p.look.eumelanin = 1.6;
      p.look.pheomelanin = 0.5;
      p.physics.bendStiffness = 0.85;
      p.physics.hold = 0.6;
    },
  }),
  region({
    id: 'chest',
    label: 'Chest',
    emitter: 'surface',
    simPoints: 6,
    renderPoints: 10,
    androgenic: 1,
    mask: ({ p, part }) => {
      if (part !== 'chest' && part !== 'shoulder' && part !== 'abdomen') return 0;
      if (p[2] < 0.04) return 0;
      const s = LANDMARKS.sternum;
      const pec = Math.hypot((Math.abs(p[0]) - 0.055) / 0.075, (p[1] - (s[1] - 0.01)) / 0.065);
      const sternumStrip = Math.hypot(p[0] / 0.025, (p[1] - (s[1] - 0.03)) / 0.12);
      return Math.max(ellipseFalloff(pec, 1, 0.35), ellipseFalloff(sternumStrip, 1, 0.3));
    },
    flow: ({ p }) => {
      const s = LANDMARKS.sternum;
      const side = Math.sign(p[0]) || 1;
      const r = sub(p, s);
      return normalize(add([side * 0.6, -0.8, 0], scale(normalize([r[0], r[1], 0]), 0.6)));
    },
    defaults: (p) => {
      Object.assign(p.shape, { density: 18, length: 0.03, lengthVar: 0.4, diameter: 75, rootLift: 15, surfaceFollow: 0.9 });
      applyCurlType(p.shape, '3B');
      p.shape.curlRadius = 0.003;
      p.shape.curlPitch = 0.01;
      p.shape.clumpSize = 2;
      p.look.eumelanin = 1.6;
      p.physics.bendStiffness = 0.85;
      p.physics.hold = 0.6;
    },
  }),
  region({
    id: 'abdomen',
    label: 'Abdomen',
    emitter: 'surface',
    simPoints: 6,
    renderPoints: 10,
    androgenic: 1,
    mask: ({ p, part }) => {
      if (part !== 'abdomen' && part !== 'pelvis' && part !== 'chest') return 0;
      if (p[2] < 0.04) return 0;
      // The linea ("happy trail") from sternum to pubis, widening below the navel.
      if (p[1] > 1.22 || p[1] < 0.95) return 0;
      const below = smoothstep(1.06, 0.98, p[1]);
      const halfW = lerp(0.012, 0.035, below);
      return ellipseFalloff(Math.abs(p[0]), halfW, 0.008) * 0.8;
    },
    flow: ({ p }) => normalize([-(Math.sign(p[0]) || 1) * 0.3, -1, 0]),
    defaults: (p) => {
      Object.assign(p.shape, { density: 14, length: 0.025, lengthVar: 0.4, diameter: 70, rootLift: 12, surfaceFollow: 0.9 });
      p.shape.curlRadius = 0.003;
      p.shape.curlPitch = 0.012;
      p.look.eumelanin = 1.6;
      p.physics.bendStiffness = 0.85;
      p.physics.hold = 0.6;
    },
  }),
  region({
    id: 'axillary',
    label: 'Axillary',
    emitter: 'surface',
    simPoints: 6,
    renderPoints: 12,
    androgenic: 0.4,
    mask: ({ p }) => {
      const a: V3 = [Math.sign(p[0]) * 0.17, 1.33, -0.02];
      return ellipseFalloff(len(sub(p, a)), 0.035, 0.012);
    },
    flow: () => [0, -1, -0.3],
    defaults: (p) => {
      Object.assign(p.shape, { density: 35, length: 0.035, lengthVar: 0.35, diameter: 80, rootLift: 25, surfaceFollow: 0.7 });
      applyCurlType(p.shape, '3C');
      p.shape.curlRadius = 0.003;
      p.look.eumelanin = 1.8;
      p.physics.bendStiffness = 0.8;
    },
  }),
  region({
    id: 'pubic',
    label: 'Pubic',
    emitter: 'surface',
    simPoints: 6,
    renderPoints: 12,
    androgenic: 0.3,
    mask: ({ p, part }) => {
      if (part !== 'pelvis' && part !== 'thigh' && part !== 'abdomen') return 0;
      if (p[2] < 0.03) return 0;
      const y = p[1] - 0.86;
      if (y < 0) return 0;
      const halfW = 0.035 + y * 1.2;
      return ellipseFalloff(Math.abs(p[0]), halfW, 0.012) * (1 - smoothstep(0.08, 0.1, y));
    },
    flow: ({ p }) => normalize([-(Math.sign(p[0]) || 1) * 0.4, -1, 0.1]),
    defaults: (p) => {
      Object.assign(p.shape, { density: 40, length: 0.035, lengthVar: 0.35, diameter: 90, rootLift: 25, surfaceFollow: 0.7 });
      applyCurlType(p.shape, '4A');
      p.shape.curlRadius = 0.003;
      p.look.eumelanin = 1.8;
      p.physics.bendStiffness = 0.85;
    },
  }),
  region({
    id: 'arms',
    label: 'Upper arms',
    emitter: 'surface',
    simPoints: 4,
    renderPoints: 6,
    androgenic: 0.8,
    mask: ({ part }) => (part === 'upperArm' ? 0.5 : 0),
    flow: ({ p }) => limbAxis(LANDMARKS.shoulderL, LANDMARKS.elbowL, p),
    defaults: (p) => {
      Object.assign(p.shape, { density: 10, length: 0.012, lengthVar: 0.4, diameter: 45, rootLift: 12 });
      p.look.eumelanin = 1.2;
      p.physics.bendStiffness = 0.9;
      p.physics.hold = 0.8;
    },
  }),
  region({
    id: 'forearms',
    label: 'Forearms',
    emitter: 'surface',
    simPoints: 4,
    renderPoints: 6,
    androgenic: 0.8,
    mask: ({ p, part }) => {
      if (part !== 'forearm') return 0;
      // Denser on the dorsal / ulnar side (outer, back of the forearm).
      const outward = smoothstep(-0.5, 0.6, (Math.sign(p[0]) * (p[0] - 0.29 * Math.sign(p[0]))) / 0.03);
      return lerp(0.35, 1, outward);
    },
    flow: ({ p }) => {
      const ax = limbAxis(LANDMARKS.elbowL, LANDMARKS.wristL, p);
      return add(ax, [Math.sign(p[0]) * 0.25, 0, 0]);
    },
    defaults: (p) => {
      Object.assign(p.shape, { density: 22, length: 0.014, lengthVar: 0.4, diameter: 55, rootLift: 12 });
      p.look.eumelanin = 1.2;
      p.physics.bendStiffness = 0.9;
      p.physics.hold = 0.8;
    },
  }),
  region({
    id: 'hands',
    label: 'Hands',
    emitter: 'surface',
    simPoints: 4,
    renderPoints: 4,
    androgenic: 0.8,
    mask: ({ p, part }) => (part === 'hand' && Math.abs(p[0]) > 0.335 ? 0.4 : 0),
    flow: () => [0, -1, 0],
    defaults: (p) => {
      Object.assign(p.shape, { density: 6, length: 0.008, lengthVar: 0.4, diameter: 45, rootLift: 10 });
      p.look.eumelanin = 1.2;
      p.physics.hold = 0.9;
    },
  }),
  region({
    id: 'legs',
    label: 'Legs',
    emitter: 'surface',
    simPoints: 4,
    renderPoints: 6,
    androgenic: 0.8,
    mask: ({ p, part }) => {
      if (part === 'shin') return 1;
      if (part === 'thigh') return p[2] > -0.02 ? 0.7 : 0.35;
      return 0;
    },
    flow: ({ p, part }) => {
      const ax = part === 'shin'
        ? limbAxis(LANDMARKS.kneeL, LANDMARKS.ankleL, p)
        : limbAxis(LANDMARKS.hipL, LANDMARKS.kneeL, p);
      return add(ax, [Math.sign(p[0]) * 0.2, 0, 0]);
    },
    defaults: (p) => {
      Object.assign(p.shape, { density: 22, length: 0.018, lengthVar: 0.4, diameter: 60, rootLift: 12 });
      p.look.eumelanin = 1.3;
      p.physics.bendStiffness = 0.9;
      p.physics.hold = 0.8;
    },
  }),
  region({
    id: 'feet',
    label: 'Feet & toes',
    emitter: 'surface',
    simPoints: 4,
    renderPoints: 4,
    androgenic: 0.8,
    mask: ({ p, part }) => (part === 'foot' && p[1] > 0.045 ? 0.4 : 0),
    flow: () => [0, 0, 1],
    defaults: (p) => {
      Object.assign(p.shape, { density: 6, length: 0.01, lengthVar: 0.4, diameter: 50, rootLift: 10 });
      p.physics.hold = 0.9;
    },
  }),
  region({
    id: 'back',
    label: 'Back & shoulders',
    emitter: 'surface',
    simPoints: 4,
    renderPoints: 6,
    androgenic: 1,
    mask: ({ p, part }) => {
      if (part !== 'chest' && part !== 'shoulder' && part !== 'abdomen') return 0;
      return p[2] < -0.03 ? 0.3 : 0;
    },
    flow: ({ p }) => normalize([-(Math.sign(p[0]) || 1) * 0.4, -1, 0]),
    defaults: (p) => {
      p.enabled = false;
      Object.assign(p.shape, { density: 10, length: 0.015, lengthVar: 0.4, diameter: 55, rootLift: 12 });
      p.physics.hold = 0.8;
    },
  }),
  region({
    id: 'vellus',
    label: 'Vellus (peach fuzz)',
    emitter: 'surface',
    simPoints: 2,
    renderPoints: 3,
    androgenic: 0,
    mask: ({ part }) => (part === 'eye' ? 0 : 1),
    flow: ({ n }) => {
      const down: V3 = [0, -1, 0];
      return dot(n, down) > 0.95 ? [0, 0, 1] : down;
    },
    defaults: (p) => {
      p.enabled = false;
      Object.assign(p.shape, {
        density: 2, length: 0.0015, lengthVar: 0.5, diameter: 25, rootLift: 15, frizz: 0.2,
      });
      p.look.eumelanin = 0.15;
      p.look.pheomelanin = 0.1;
      p.physics.hold = 1;
    },
  }),
];

export const regionById = (id: RegionId) => REGIONS.find((r) => r.id === id)!;

/** Androgen modulation of density: neutral at androgen = 0.5. */
export function androgenScale(r: RegionDef, c: CharacterParams) {
  return lerp(1, c.androgen * 2, r.androgenic);
}
