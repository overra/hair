// A procedural "hand": a row of finger capsules raking through the hair.
// The fingers stand along the skin normal under the cursor, spread
// perpendicular to the stroke direction; pressing lowers them into the hair.
import { bodyNormal, raycastBody } from '../body/sdf';
import { type V3, add, cross, dot, lerp, normalize, scale, sub } from '../math/vec';
import { MAX_FINGERS } from '../gpu/layouts';

export interface Capsule { a: V3; b: V3; r: number }

export interface HandParams {
  fingers: number;
  spacing: number; // m between finger axes
  radius: number; // m
  length: number; // m
  friction: number; // 0..1 fraction of finger motion transferred to touching hair
  depth: number; // m: how far above the skin the fingertips stay while pressed
  lean: number; // rad: finger tilt away from the skin normal, against the stroke
}

export const defaultHand = (): HandParams => ({
  fingers: 4,
  spacing: 0.02,
  radius: 0.0085,
  length: 0.08,
  friction: 0.5,
  depth: 0.0005,
  lean: 0.8,
});

export class Hand {
  capsules: Capsule[] = [];
  /** World-space displacement of the hand during the last frame. */
  displacement: V3 = [0, 0, 0];
  visible = false;
  private center: V3 | null = null;
  private lift = 0.08;
  private spread: V3 = [1, 0, 0];
  private stroke: V3 = [0, -1, 0];

  /**
   * @param origin,dir  mouse ray in body space
   * @param camRight    camera right vector in body space (fallback spread direction)
   * @param pressed     whether the fingers should be in the hair
   */
  update(origin: V3, dir: V3, camRight: V3, pressed: boolean, p: HandParams) {
    const t = raycastBody(origin, dir);
    if (t < 0) {
      this.visible = false;
      this.capsules = [];
      this.displacement = [0, 0, 0];
      this.center = null;
      return;
    }
    const hit = add(origin, scale(dir, t));
    const n = bodyNormal(hit);
    const prev = this.center;
    // Smooth the anchor so the fingers move continuously across mesh noise.
    const center = prev ? add(prev, scale(sub(hit, prev), 0.6)) : hit;
    const move = prev ? sub(center, prev) : ([0, 0, 0] as V3);
    this.center = center;
    // Spread fingers across the stroke (or across the view when still).
    const moveT = sub(move, scale(n, dot(move, n)));
    if (Math.hypot(...moveT) > 1e-4) {
      this.stroke = normalize(add(scale(this.stroke, 0.7), scale(normalize(moveT), 0.3)));
      const across = normalize(cross(n, normalize(moveT)));
      this.spread = normalize(add(scale(this.spread, 0.7), scale(dot(across, this.spread) < 0 ? scale(across, -1) : across, 0.3)));
    } else if (!prev) {
      this.spread = normalize(sub(camRight, scale(n, dot(camRight, n))));
    }
    this.lift = lerp(this.lift, pressed ? p.depth : 0.09, 0.35);
    const caps: Capsule[] = [];
    const count = Math.min(p.fingers, MAX_FINGERS);
    for (let k = 0; k < count; k++) {
      const off = (k - (count - 1) / 2) * p.spacing;
      // Middle fingers are slightly longer, like a real hand.
      const reach = 1 - 0.12 * Math.abs(k - (count - 1) / 2);
      const tip = add(add(center, scale(this.spread, off)), scale(n, this.lift + p.radius + (1 - reach) * 0.004));
      // Fingers lean back against the stroke, tips leading, like a raking hand.
      const strokeT = sub(this.stroke, scale(n, dot(this.stroke, n)));
      const lean = Math.hypot(...strokeT) > 1e-3 ? normalize(strokeT) : ([0, 0, 0] as V3);
      const axis = normalize(sub(scale(n, Math.cos(p.lean)), scale(lean, Math.sin(p.lean))));
      caps.push({ a: tip, b: add(tip, scale(axis, p.length * reach)), r: p.radius });
    }
    this.capsules = caps;
    this.displacement = move;
    this.visible = true;
  }
}

/** Triangle mesh (positions + normals interleaved, indices) for a set of capsules. */
export function capsuleMesh(caps: Capsule[], seg = 12, rings = 6) {
  const verts: number[] = [];
  const idx: number[] = [];
  for (const c of caps) {
    const axis = normalize(sub(c.b, c.a));
    const u = normalize(Math.abs(axis[0]) < 0.9 ? cross(axis, [1, 0, 0]) : cross(axis, [0, 1, 0]));
    const v = cross(axis, u);
    const base = verts.length / 6;
    // Rings from the bottom hemisphere pole to the top pole.
    const rows: { center: V3; ang: number }[] = [];
    for (let i = 0; i <= rings; i++) rows.push({ center: c.a, ang: -Math.PI / 2 + (i / rings) * (Math.PI / 2) });
    for (let i = 0; i <= rings; i++) rows.push({ center: c.b, ang: (i / rings) * (Math.PI / 2) });
    for (const row of rows) {
      for (let j = 0; j <= seg; j++) {
        const phi = (j / seg) * Math.PI * 2;
        const radial = add(scale(u, Math.cos(phi)), scale(v, Math.sin(phi)));
        const nrm = normalize(add(scale(radial, Math.cos(row.ang)), scale(axis, Math.sin(row.ang))));
        const pos = add(row.center, scale(nrm, c.r));
        verts.push(...pos, ...nrm);
      }
    }
    const stride = seg + 1;
    for (let i = 0; i < rows.length - 1; i++)
      for (let j = 0; j < seg; j++) {
        const a = base + i * stride + j;
        const b = a + stride;
        idx.push(a, a + 1, b, a + 1, b + 1, b);
      }
  }
  return { vertices: new Float32Array(verts), indices: new Uint32Array(idx) };
}
