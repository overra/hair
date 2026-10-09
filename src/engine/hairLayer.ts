// One hair region on the GPU: its strands, guides and render buffers.
import { d } from 'typegpu';
import type { TgpuRoot } from 'typegpu';
import type { BodyMesh } from '../body/mesher';
import type { CharacterParams, RegionDef } from '../groom/atlas';
import type { RegionParams } from '../groom/params';
import { type LayerGeometry, scatterRegion } from '../groom/scatter';
import { LayerParams, StrandStatic, drawLayout, layerLayout } from '../gpu/layouts';

/** Simulated guides per strand (inverse). */
const GUIDE_STRIDE: Partial<Record<string, number>> = { scalp: 12, vellus: 32, legs: 16, forearms: 16 };

export class HairLayer {
  /** Global ribbon width multiplier (debug visualisation). */
  static widthScale = 1;
  geometry: LayerGeometry | null = null;
  needsGrow = false;
  private buffers: { destroy(): void }[] = [];
  private paramsBuf;
  computeGroup: GPUBindGroup | null = null;
  drawGroup: GPUBindGroup | null = null;

  constructor(
    private root: TgpuRoot,
    readonly region: RegionDef,
    public params: RegionParams,
  ) {
    this.paramsBuf = root.createBuffer(LayerParams).$usage('uniform');
  }

  get strands() { return this.geometry?.count ?? 0; }
  get guides() { return this.geometry?.guideStrand.length ?? 0; }
  get active() { return this.params.enabled && this.strands > 0; }

  rebuild(mesh: BodyMesh, ch: CharacterParams, densityScale: number) {
    for (const b of this.buffers) b.destroy();
    this.buffers = [];
    this.computeGroup = this.drawGroup = null;
    this.geometry = null;
    if (!this.params.enabled) return;
    const geo = scatterRegion(mesh, this.region, this.params, ch, densityScale, ch.seed, GUIDE_STRIDE[this.region.id] ?? 8);
    if (geo.count === 0) return;
    this.geometry = geo;
    const S = geo.count;
    const G = geo.guideStrand.length;
    const N = geo.simPoints;
    const M = geo.renderPoints;
    const root = this.root;
    const statics = root.createBuffer(d.arrayOf(StrandStatic, S)).$usage('storage');
    statics.write(geo.data.buffer as ArrayBuffer);
    const restS = root.createBuffer(d.arrayOf(d.vec4f, N * S)).$usage('storage');
    const guideStrand = root.createBuffer(d.arrayOf(d.u32, G)).$usage('storage');
    guideStrand.write(geo.guideStrand.buffer as ArrayBuffer);
    const gPos = root.createBuffer(d.arrayOf(d.vec4f, N * G)).$usage('storage');
    const gPrev = root.createBuffer(d.arrayOf(d.vec4f, N * G)).$usage('storage');
    const gQ = root.createBuffer(d.arrayOf(d.vec4f, N * G)).$usage('storage');
    const render = root.createBuffer(d.arrayOf(d.vec4f, M * S)).$usage('storage');
    this.buffers.push(statics, restS, guideStrand, gPos, gPrev, gQ, render);
    this.writeParams();
    this.computeGroup = root.unwrap(
      root.createBindGroup(layerLayout, { params: this.paramsBuf, statics, restS, guideStrand, gPos, gPrev, gQ, render }),
    );
    this.drawGroup = root.unwrap(root.createBindGroup(drawLayout, { params: this.paramsBuf, statics, render }));
    this.needsGrow = true;
  }

  /** Upload uniform parameters (look & physics changes need no rebuild). */
  writeParams() {
    const g = this.geometry;
    const { shape, look, physics } = this.params;
    const buf = new ArrayBuffer(d.sizeOf(LayerParams));
    const u = new Uint32Array(buf);
    const f = new Float32Array(buf);
    u.set([g?.count ?? 0, g?.guideStrand.length ?? 0, g?.simPoints ?? 2, g?.renderPoints ?? 2], 0);
    const wet = look.wetness;
    f.set([physics.bendStiffness, physics.hold, physics.holdFalloff, physics.damping], 4);
    f.set([physics.gravity * (1 + 0.6 * wet), physics.friction, 0.9, 0.0008], 8);
    f.set([look.eumelanin, look.pheomelanin, look.tipBleach, look.dye], 12);
    f.set([...look.dyeColor, look.roughness], 16);
    f.set([look.azimuthalRoughness, (-look.cuticleTilt * Math.PI) / 180, look.ior, wet], 20);
    f.set([look.oiliness, shape.tipTaper, HairLayer.widthScale, 0], 24);
    const droop = 22 * physics.gravity * (1 - 0.6 * physics.bendStiffness) * (1 + 0.5 * wet);
    f.set([droop, 1.2, 0, 0], 28);
    this.paramsBuf.write(buf);
  }

  destroy() {
    for (const b of this.buffers) b.destroy();
    this.paramsBuf.destroy();
  }
}
