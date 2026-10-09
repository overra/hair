// Owns the device, pipelines and per-frame encoding.
//
// Frame: [compute] grow (on rebuild) → tools → simulate × substeps → expand
//        [render]  body shadow → hair shadow → main (MSAA, alpha-to-coverage)
import tgpu, { d } from 'typegpu';
import type { TgpuRoot } from 'typegpu';
import type { BodyMesh } from '../body/mesher';
import { FrameParams, drawLayout, frameLayout, layerLayout, shadowLayout, toolLayout } from '../gpu/layouts';
import { buildShaderSources } from '../gpu/shaders';
import type { HairLayer } from './hairLayer';
import { GpuTimer } from './timer';

export const MSAA = 4;
export const SHADOW_SIZE = 2048;

export interface FrameState {
  model: Float32Array;
  modelRot: [number, number, number, number];
  viewProj: Float32Array;
  proj11: number;
  camPos: [number, number, number];
  lightViewProj: Float32Array;
  lightDir: [number, number, number];
  lightIntensity: number;
  lightDepthRange: number;
  time: number;
  dt: number;
  substeps: number;
  frame: number;
  wind: [number, number, number];
  turbulence: number;
  brush: { x: number; y: number; radius: number; mode: number; drag: [number, number, number]; strength: number; guard: number; falloff: number; active: boolean };
  shadowDensity: number;
  resetSim: boolean;
}

export const TOOL_CUT = 1;
export const TOOL_CLIP = 2;
export const TOOL_COMB = 3;

export class Renderer {
  readonly device: GPUDevice;
  readonly format: GPUTextureFormat;
  readonly timer: GpuTimer;
  private frameBuf;
  private frameGroup: GPUBindGroup;
  private shadowGroup!: GPUBindGroup;
  private toolGroup: GPUBindGroup | null = null;
  private emptyGroup: GPUBindGroup;
  private pipes!: Record<string, GPUComputePipeline | GPURenderPipeline>;
  private bodyShadowTex!: GPUTexture;
  private hairShadowTex!: GPUTexture;
  private colorTex: GPUTexture | null = null;
  private depthTex: GPUTexture | null = null;
  private body: { vbuf: GPUBuffer; ibuf: GPUBuffer; count: number } | null = null;
  layers: HairLayer[] = [];
  width = 1;
  height = 1;

  private constructor(readonly root: TgpuRoot, private context: GPUCanvasContext, private canvas: HTMLCanvasElement) {
    this.device = root.device;
    this.format = navigator.gpu.getPreferredCanvasFormat();
    context.configure({ device: this.device, format: this.format, alphaMode: 'opaque' });
    this.frameBuf = root.createBuffer(FrameParams).$usage('uniform');
    this.frameGroup = root.unwrap(root.createBindGroup(frameLayout, { frame: this.frameBuf }));
    const emptyLayout = this.device.createBindGroupLayout({ entries: [] });
    this.emptyGroup = this.device.createBindGroup({ layout: emptyLayout, entries: [] });
    this.timer = new GpuTimer(this.device, ['sim', 'shadow', 'main']);
    this.createShadowMaps();
    this.createPipelines(emptyLayout);
  }

  static async create(canvas: HTMLCanvasElement): Promise<Renderer> {
    if (!navigator.gpu) throw new Error('WebGPU is not available in this browser.');
    const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
    if (!adapter) throw new Error('No WebGPU adapter found.');
    const want = 1024 * 1024 * 1024;
    const device = await adapter.requestDevice({
      requiredFeatures: adapter.features.has('timestamp-query') ? ['timestamp-query'] : [],
      requiredLimits: {
        maxStorageBufferBindingSize: Math.min(adapter.limits.maxStorageBufferBindingSize, want),
        maxBufferSize: Math.min(adapter.limits.maxBufferSize, want),
        maxStorageBuffersPerShaderStage: Math.min(adapter.limits.maxStorageBuffersPerShaderStage, 10),
      },
    });
    device.lost.then((info) => console.error('WebGPU device lost:', info.message));
    device.addEventListener('uncapturederror', (e) => console.error('WebGPU error:', (e as GPUUncapturedErrorEvent).error.message));
    const root = tgpu.initFromDevice({ device });
    const context = canvas.getContext('webgpu');
    if (!context) throw new Error('Could not create a WebGPU canvas context.');
    return new Renderer(root, context, canvas);
  }

  private createShadowMaps() {
    const mk = () =>
      this.device.createTexture({
        size: [SHADOW_SIZE, SHADOW_SIZE],
        format: 'depth32float',
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
      });
    this.bodyShadowTex = mk();
    this.hairShadowTex = mk();
    const cmp = this.device.createSampler({ compare: 'less-equal', magFilter: 'linear', minFilter: 'linear' });
    this.shadowGroup = this.device.createBindGroup({
      layout: this.root.unwrap(shadowLayout),
      entries: [
        { binding: 0, resource: this.bodyShadowTex.createView() },
        { binding: 1, resource: this.hairShadowTex.createView() },
        { binding: 2, resource: cmp },
      ],
    });
  }

  private createPipelines(emptyLayout: GPUBindGroupLayout) {
    const dev = this.device;
    const src = buildShaderSources();
    const mod = (code: string, label: string) => {
      const m = dev.createShaderModule({ code, label });
      m.getCompilationInfo().then((info) => {
        for (const msg of info.messages) {
          if (msg.type === 'error') console.error(`[${label}] ${msg.lineNum}:${msg.linePos} ${msg.message}`);
        }
      });
      return m;
    };
    const computeLayout = dev.createPipelineLayout({ bindGroupLayouts: [this.root.unwrap(layerLayout), this.root.unwrap(frameLayout), this.root.unwrap(toolLayout)] });
    const groom = mod(src.groom, 'groom');
    const sim = mod(src.sim, 'sim');
    const expand = mod(src.expand, 'expand');
    const hair = mod(src.hair, 'hair');
    const body = mod(src.body, 'body');
    const cp = (module: GPUShaderModule, entryPoint: string) =>
      dev.createComputePipeline({ layout: computeLayout, compute: { module, entryPoint }, label: entryPoint });

    const hairLayout = dev.createPipelineLayout({ bindGroupLayouts: [this.root.unwrap(drawLayout), this.root.unwrap(frameLayout), this.root.unwrap(shadowLayout)] });
    const hairShadowLayout = dev.createPipelineLayout({ bindGroupLayouts: [this.root.unwrap(drawLayout), this.root.unwrap(frameLayout)] });
    const bodyLayout = dev.createPipelineLayout({ bindGroupLayouts: [emptyLayout, this.root.unwrap(frameLayout), this.root.unwrap(shadowLayout)] });
    const bodyShadowLayout = dev.createPipelineLayout({ bindGroupLayouts: [emptyLayout, this.root.unwrap(frameLayout)] });
    const bodyBuffers: GPUVertexBufferLayout[] = [{
      arrayStride: 24,
      attributes: [
        { shaderLocation: 0, offset: 0, format: 'float32x3' },
        { shaderLocation: 1, offset: 12, format: 'float32x3' },
      ],
    }];
    const depth = (write = true): GPUDepthStencilState => ({ format: 'depth32float', depthWriteEnabled: write, depthCompare: 'less' });

    this.pipes = {
      grow: cp(groom, 'grow'),
      initGuides: cp(groom, 'initGuides'),
      cut: cp(groom, 'cut'),
      comb: cp(groom, 'comb'),
      simulate: cp(sim, 'simulate'),
      expand: cp(expand, 'expand'),
      hair: dev.createRenderPipeline({
        label: 'hair',
        layout: hairLayout,
        vertex: { module: hair, entryPoint: 'hairVS' },
        fragment: { module: hair, entryPoint: 'hairFS', targets: [{ format: this.format }] },
        primitive: { topology: 'triangle-strip', cullMode: 'none' },
        depthStencil: depth(),
        multisample: { count: MSAA },
      }),
      hairShadow: dev.createRenderPipeline({
        label: 'hairShadow',
        layout: hairShadowLayout,
        vertex: { module: hair, entryPoint: 'hairShadowVS' },
        primitive: { topology: 'triangle-strip', cullMode: 'none' },
        depthStencil: depth(),
      }),
      body: dev.createRenderPipeline({
        label: 'body',
        layout: bodyLayout,
        vertex: { module: body, entryPoint: 'bodyVS', buffers: bodyBuffers },
        fragment: { module: body, entryPoint: 'bodyFS', targets: [{ format: this.format }] },
        primitive: { topology: 'triangle-list', cullMode: 'back' },
        depthStencil: depth(),
        multisample: { count: MSAA },
      }),
      bodyShadow: dev.createRenderPipeline({
        label: 'bodyShadow',
        layout: bodyShadowLayout,
        vertex: { module: body, entryPoint: 'bodyShadowVS', buffers: bodyBuffers },
        primitive: { topology: 'triangle-list', cullMode: 'none' },
        depthStencil: { ...depth(), depthBias: 2, depthBiasSlopeScale: 2 },
      }),
    };
  }

  setBody(mesh: BodyMesh) {
    const n = mesh.positions.length / 3;
    const inter = new Float32Array(n * 6);
    for (let i = 0; i < n; i++) {
      inter.set(mesh.positions.subarray(3 * i, 3 * i + 3), 6 * i);
      inter.set(mesh.normals.subarray(3 * i, 3 * i + 3), 6 * i + 3);
    }
    const vbuf = this.device.createBuffer({ size: inter.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
    this.device.queue.writeBuffer(vbuf, 0, inter);
    const ibuf = this.device.createBuffer({ size: mesh.indices.byteLength, usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST });
    this.device.queue.writeBuffer(ibuf, 0, mesh.indices as Uint32Array<ArrayBuffer>);
    this.body = { vbuf, ibuf, count: mesh.indices.length };
  }

  resize(width: number, height: number) {
    width = Math.max(1, Math.floor(width));
    height = Math.max(1, Math.floor(height));
    if (width === this.width && height === this.height && this.colorTex) return;
    this.width = width;
    this.height = height;
    this.canvas.width = width;
    this.canvas.height = height;
    this.colorTex?.destroy();
    this.depthTex?.destroy();
    this.colorTex = this.device.createTexture({
      size: [width, height], format: this.format, sampleCount: MSAA, usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });
    this.depthTex = this.device.createTexture({
      size: [width, height], format: 'depth32float', sampleCount: MSAA,
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    });
    this.toolGroup = this.device.createBindGroup({
      layout: this.root.unwrap(toolLayout),
      entries: [{ binding: 0, resource: this.depthTex.createView() }],
    });
  }

  private writeFrame(s: FrameState) {
    const buf = new Float32Array(d.sizeOf(FrameParams) / 4);
    let o = 0;
    const put = (v: ArrayLike<number>) => { buf.set(v, o); o += v.length; };
    put(s.model);
    put(s.modelRot);
    put(s.viewProj);
    put(s.lightViewProj);
    put([...s.camPos, s.proj11]);
    put([...s.lightDir, s.lightIntensity]);
    put([this.width, this.height, 1 / this.width, 1 / this.height]);
    put([s.time, s.dt, s.substeps, s.frame]);
    put([...s.wind, s.turbulence]);
    const b = s.brush;
    put([b.x, b.y, b.radius, b.mode]);
    put([...b.drag, b.strength]);
    put([b.guard, b.falloff, b.active ? 1 : 0, 0]);
    put([s.shadowDensity, 0.0015, SHADOW_SIZE, s.lightDepthRange]);
    this.frameBuf.write(buf.buffer as ArrayBuffer);
  }

  render(s: FrameState) {
    if (!this.colorTex || !this.depthTex || !this.toolGroup) return;
    this.writeFrame(s);
    const dev = this.device;
    const enc = dev.createCommandEncoder();
    const layers = this.layers.filter((l) => l.active && l.computeGroup && l.drawGroup);
    const groups = (pass: GPUComputePassEncoder, l: HairLayer) => {
      pass.setBindGroup(0, l.computeGroup!);
      pass.setBindGroup(1, this.frameGroup);
      pass.setBindGroup(2, this.toolGroup!);
    };
    const wg = (n: number) => Math.ceil(n / 64);

    // ---- compute
    {
      const pass = enc.beginComputePass({ timestampWrites: this.timer.writes('sim') });
      for (const l of layers) {
        groups(pass, l);
        if (l.needsGrow) {
          pass.setPipeline(this.pipes.grow as GPUComputePipeline);
          pass.dispatchWorkgroups(wg(l.strands));
        }
        if (l.needsGrow || s.resetSim) {
          pass.setPipeline(this.pipes.initGuides as GPUComputePipeline);
          pass.dispatchWorkgroups(wg(l.guides));
          l.needsGrow = false;
        }
        if (s.brush.active && s.frame > 0) {
          const tool = s.brush.mode === TOOL_COMB ? 'comb' : 'cut';
          pass.setPipeline(this.pipes[tool] as GPUComputePipeline);
          pass.dispatchWorkgroups(wg(l.strands));
        }
      }
      // Substeps share one frame uniform (dt is per substep); each layer advances in turn.
      pass.setPipeline(this.pipes.simulate as GPUComputePipeline);
      for (let k = 0; k < s.substeps; k++) {
        for (const l of layers) {
          groups(pass, l);
          pass.dispatchWorkgroups(wg(l.guides));
        }
      }
      pass.setPipeline(this.pipes.expand as GPUComputePipeline);
      for (const l of layers) {
        groups(pass, l);
        pass.dispatchWorkgroups(wg(l.strands));
      }
      pass.end();
    }

    // ---- shadows
    const shadowWrites = this.timer.writes('shadow');
    {
      const pass = enc.beginRenderPass({
        colorAttachments: [],
        depthStencilAttachment: { view: this.bodyShadowTex.createView(), depthClearValue: 1, depthLoadOp: 'clear', depthStoreOp: 'store' },
        timestampWrites: shadowWrites ? { querySet: shadowWrites.querySet, beginningOfPassWriteIndex: shadowWrites.beginningOfPassWriteIndex } : undefined,
      });
      if (this.body) {
        pass.setPipeline(this.pipes.bodyShadow as GPURenderPipeline);
        pass.setBindGroup(0, this.emptyGroup);
        pass.setBindGroup(1, this.frameGroup);
        pass.setVertexBuffer(0, this.body.vbuf);
        pass.setIndexBuffer(this.body.ibuf, 'uint32');
        pass.drawIndexed(this.body.count);
      }
      pass.end();
    }
    {
      const pass = enc.beginRenderPass({
        colorAttachments: [],
        depthStencilAttachment: { view: this.hairShadowTex.createView(), depthClearValue: 1, depthLoadOp: 'clear', depthStoreOp: 'store' },
        timestampWrites: shadowWrites ? { querySet: shadowWrites.querySet, endOfPassWriteIndex: shadowWrites.endOfPassWriteIndex } : undefined,
      });
      pass.setPipeline(this.pipes.hairShadow as GPURenderPipeline);
      pass.setBindGroup(1, this.frameGroup);
      for (const l of layers) {
        pass.setBindGroup(0, l.drawGroup!);
        pass.draw(l.geometry!.renderPoints * 2, l.strands);
      }
      pass.end();
    }

    // ---- main
    {
      const pass = enc.beginRenderPass({
        colorAttachments: [{
          view: this.colorTex.createView(),
          resolveTarget: this.context.getCurrentTexture().createView(),
          clearValue: { r: 0.05, g: 0.055, b: 0.065, a: 1 },
          loadOp: 'clear',
          storeOp: 'discard',
        }],
        depthStencilAttachment: { view: this.depthTex.createView(), depthClearValue: 1, depthLoadOp: 'clear', depthStoreOp: 'store' },
        timestampWrites: this.timer.writes('main'),
      });
      pass.setBindGroup(1, this.frameGroup);
      pass.setBindGroup(2, this.shadowGroup);
      if (this.body) {
        pass.setPipeline(this.pipes.body as GPURenderPipeline);
        pass.setBindGroup(0, this.emptyGroup);
        pass.setVertexBuffer(0, this.body.vbuf);
        pass.setIndexBuffer(this.body.ibuf, 'uint32');
        pass.drawIndexed(this.body.count);
      }
      pass.setPipeline(this.pipes.hair as GPURenderPipeline);
      for (const l of layers) {
        pass.setBindGroup(0, l.drawGroup!);
        pass.draw(l.geometry!.renderPoints * 2, l.strands);
      }
      pass.end();
    }
    this.timer.resolve(enc);
    dev.queue.submit([enc.finish()]);
    this.timer.readback();
  }
}
