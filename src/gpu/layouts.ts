// Typed GPU data schemas and bind group layouts shared by every hair kernel.
// Kernels are written in WGSL and refer to these through `tgpu.resolve`
// externals (e.g. `L.$.restS[i]`), so declarations always match the buffers.
import tgpu, { d } from 'typegpu';

/** Static per-strand data (matches STRAND_STRIDE packing in groom/scatter.ts). */
export const StrandStatic = d.struct({
  root: d.vec4f, // xyz body-space root, w true length (m)
  normal: d.vec4f, // xyz skin normal, w root lift (rad)
  flow: d.vec4f, // xyz flow tangent, w diameter (m)
  curl: d.vec4f, // macro: radius, pitch, waveAmp, wavePeriod
  coil: d.vec4f, // micro: radius, pitch, kink, phase
  misc: d.vec4f, // frizz, clumpStrength, shell, surfaceFollow
  ids: d.vec4u, // seed, clumpLeader, flags, guide index
});

/** Per-layer (per-region) parameters. */
export const LayerParams = d.struct({
  counts: d.vec4u, // strands S, guides G, sim points N, render points M
  sim: d.vec4f, // bendStiffness, hold, holdFalloff, damping
  sim2: d.vec4f, // gravity, friction, dftlDamping, collisionMargin
  look0: d.vec4f, // eumelanin, pheomelanin, tipBleach, dye
  look1: d.vec4f, // dyeColor.rgb, roughness
  look2: d.vec4f, // azimuthalRoughness, cuticleTilt (rad), ior, wetness
  look3: d.vec4f, // oiliness, tipTaper, widthScale, unused
  growth: d.vec4f, // droop (1/m), clumpProfile, seed, unused
});

export const MAX_FINGERS = 5;

/** Per-frame values shared by all layers. */
export const FrameParams = d.struct({
  model: d.mat4x4f, // body → world
  modelInv: d.mat4x4f, // world → body
  modelRot: d.vec4f, // rotation quaternion of `model`
  viewProj: d.mat4x4f,
  lightViewProj: d.mat4x4f,
  camPos: d.vec4f,
  lightDir: d.vec4f, // xyz toward light, w intensity
  viewport: d.vec4f, // width, height, 1/width, 1/height
  time: d.vec4f, // time, substep dt, substeps, frame index
  wind: d.vec4f, // xyz wind (m/s), w turbulence
  brush: d.vec4f, // screen x, y (px), radius (px), mode
  brush2: d.vec4f, // drag direction in body space, strength
  brush3: d.vec4f, // guard length (m), falloff, active (0/1), unused
  shadow: d.vec4f, // hair density (1/m), bias, map size, light depth range (m)
  hand: d.vec4f, // per-substep hand displacement xyz (world), finger count
  hand2: d.vec4f, // friction, contact margin, unused, unused
  fingers: d.arrayOf(d.vec4f, 2 * MAX_FINGERS), // per finger: (a.xyz, radius), (b.xyz, 0)
});

/** Group 0: one layer's buffers, writable (compute). */
export const layerLayout = tgpu
  .bindGroupLayout({
    params: { uniform: LayerParams },
    statics: { storage: d.arrayOf(StrandStatic), access: 'mutable' },
    restS: { storage: d.arrayOf(d.vec4f), access: 'mutable' },
    guideStrand: { storage: d.arrayOf(d.u32), access: 'readonly' },
    gPos: { storage: d.arrayOf(d.vec4f), access: 'mutable' },
    gPrev: { storage: d.arrayOf(d.vec4f), access: 'mutable' },
    gQ: { storage: d.arrayOf(d.vec4f), access: 'mutable' },
    render: { storage: d.arrayOf(d.vec4f), access: 'mutable' },
  })
  .$idx(0);

/** Group 0 for drawing: read-only views of a layer. */
export const drawLayout = tgpu
  .bindGroupLayout({
    params: { uniform: LayerParams },
    statics: { storage: d.arrayOf(StrandStatic), access: 'readonly' },
    render: { storage: d.arrayOf(d.vec4f), access: 'readonly' },
  })
  .$idx(0);

/** Group 1: per-frame uniforms. */
export const frameLayout = tgpu
  .bindGroupLayout({
    frame: { uniform: FrameParams },
  })
  .$idx(1);

/** Group 2 for tools: the scene depth buffer used to reject occluded strands. */
export const toolLayout = tgpu
  .bindGroupLayout({
    depth: { texture: d.textureDepthMultisampled2d() },
  })
  .$idx(2);

/** Group 2 for shading: shadow maps. */
export const shadowLayout = tgpu
  .bindGroupLayout({
    bodyShadow: { texture: d.textureDepth2d() },
    hairShadow: { texture: d.textureDepth2d() },
    cmp: { sampler: 'comparison' },
  })
  .$idx(2);
