# TypeGPU 0.12.7 API reference (hair simulation + renderer)

Target: `typegpu@0.12.7` (npm), with `unplugin-typegpu@0.12.5` (peer `typegpu ^0.12.7`) and `@typegpu/noise@0.12.1`. Everything below was checked against the 0.12.7 package and the upstream repo, not against memory.

Snippet convention: each `ts` block type-checks on its own. The only page globals are `root` (from section 1), `canvas`, `context` (the canvas context) and `imageBitmap`.

## 0. Sources and verification

- **npm package:** installed in `/tmp/claude-0/tgpu-research/node_modules`. File:line references are relative to `node_modules/typegpu/`.
- **Upstream repo:** `software-mansion/TypeGPU` cloned at `main` (`fc85681`) to `/home/user/software-mansion/typegpu`. `packages/typegpu/package.json` says 0.12.7. Used for the migration guide (`apps/typegpu-docs/src/content/docs/migrations/0-12.mdx`), API pages (`.../content/docs/apis/*.mdx`), and examples (`apps/typegpu-docs/src/examples/`).
- **Type-checking:** upstream type-checks with `typescript: npm:tsover@^6.0.2` (`pnpm-workspace.yaml`), a TypeScript fork with vector operator typing. Stock `tsc` 5.9 rejects `vec + number` (TS2365). Snippets were checked with tsover 6.0.3, `strict`, and the docs-app settings (no `noUncheckedIndexedAccess`).
- **WGSL output:** shader code was compiled through `unplugin-typegpu/esbuild` and resolved with `tgpu.resolve` against a stub device. No GPU needed.
- **Pipeline descriptors and buffer uploads:** captured with a mock device (`createRenderPipeline`, `createComputePipeline`, `queue.writeBuffer`).
- **Not verified:** GPU execution, rendered output, performance.
- **Harness:** `/tmp/claude-0/tgpu-research/verify/src/` (`shaders.ts`, `api.ts`, `extra.ts`, `buffers.ts`, `descr.ts`, `uses.ts`).

Dependencies:

```json
{
  "dependencies": {
    "typegpu": "0.12.7",
    "unplugin-typegpu": "^0.12.5",
    "@typegpu/noise": "0.12.1"
  },
  "devDependencies": { "@webgpu/types": "^0.1.71", "vite": "^6" }
}
```

```ts ts-fragment
// vite.config.ts (same as the upstream StackBlitz template, openInStackBlitz.ts:129-135)
import { defineConfig } from 'vite';
import typegpu from 'unplugin-typegpu/vite';
export default defineConfig({ plugins: [typegpu()] });
```

The plugin is required for `'use gpu'` bodies. Without it, resolution fails with `Missing metadata for tgpu.fn function body (either missing 'use gpu' directive, or misconfigured unplugin-typegpu)` (verified; `core/function/fnCore.js:115`). WGSL-string functions still work without it.

## 1. Initialization, root, canvas, features

```ts
import { tgpu, d, std } from 'typegpu';

const root = await tgpu.init({
  device: {
    requiredFeatures: [],                     // rejects if the adapter lacks one
    optionalFeatures: ['timestamp-query'],    // skipped with a warning if missing
    requiredLimits: { maxStorageBufferBindingSize: 256 * 1024 * 1024 },
  },
});
const canvas = document.querySelector('canvas') as HTMLCanvasElement;
const context = root.configureContext({ canvas, alphaMode: 'premultiplied' });
const hasTimers = root.enabledFeatures.has('timestamp-query');
const device: GPUDevice = root.device;
```

- `tgpu.init(options?)`: `core/root/init.d.ts:101`. Throws if `navigator.gpu` is missing. Required features are checked against the adapter; missing optional features warn (`core/root/init.js:327-348`).
- `tgpu.initFromDevice({ device })`: `core/root/init.d.ts:111`. Synchronous.
- `root.configureContext({ canvas, format?, ...GPUCanvasConfiguration })` returns a `GPUCanvasContext`. Format defaults to `navigator.gpu.getPreferredCanvasFormat()` (`core/root/rootTypes.d.ts:302`, `init.js:207`).
- `root.unwrap(x)` returns the raw WebGPU object for buffers, binding objects, pipelines, bind groups, textures, views, query sets, encoders and passes (`unwrapper.d.ts`, `init.js:264`).
- `root.destroy()` destroys the device only if the root came from `tgpu.init` (`init.js:249`). It does not destroy buffers or textures (`rootTypes.d.ts:436-440`). Resources from different roots do not interoperate, so create one root at startup.
- `d` (data), `std` (functions) and `common` (helpers) are namespaces exported from `'typegpu'` (`indexNamedExports.d.ts:1-3`). `common` can also be imported from `'typegpu/common'`.

## 2. Data schemas (`d`)

Sizes and alignments verified in Node with `d.sizeOf` and `d.alignmentOf`:

| Schema | Size | Align | Notes |
|---|---|---|---|
| `f32`, `i32`, `u32` | 4 | 4 | `f16`, `u16`: 2 / 2 |
| `vec2f` | 8 | 8 | |
| `vec3f` | 12 | 16 | 4 bytes tail padding when followed by another member |
| `vec4f` | 16 | 16 | |
| `mat2x2f` / `mat3x3f` / `mat4x4f` | 16 / 48 / 64 | 8 / 16 / 16 | column-major |
| `struct {pos: vec3f, vel: f32}` | 16 | 16 | `f32` fills the vec3 tail |
| `struct {pos, vel: vec3f, life: f32}` | 32 | 16 | |
| `arrayOf(vec3f, 4)` | 64 | 16 | stride 16 |
| `arrayOf(vec2f, 3)` | 24 | 8 | stride 8 |
| `arrayOf(f16, 5)` | 10 | 2 | stride 2 |
| `disarrayOf(vec3f, 3)` | 36 | 1 | packed, stride 12 (vertex data) |
| `unstruct({f32, vec3f})` | 16 | 1 | packed (vertex data) |
| `struct {a: f32, b: align(16, vec3f)}` | 32 | 16 | `d.align`/`d.size` apply to struct members |

```ts
import { d } from 'typegpu';
const Particle = d.struct({ pos: d.vec3f, vel: d.f32 });     // 16 bytes
const Particles = d.arrayOf(Particle, 1024);                  // stride 16
const velOffset = d.memoryLayoutOf(Particles, (a) => a[3].vel); // { offset, contiguous }
```

- `d.arrayOf(T)` without a count returns `(n) => WgslArray`, not a schema. Passing that to `createBuffer` gives `Buffer of type undefined cannot be used as storage` (verified). Pass the count. The function form is only for layout entries (`storage: d.arrayOf(T)`).
- Array element types cannot carry `d.align` or `d.size`. Wrap them in a struct (`data/array.d.ts:17-19`).
- Vertex layouts: `tgpu.vertexLayout(d.arrayOf(d.vec3f))` has `arrayStride: 16`; `tgpu.vertexLayout(d.disarrayOf(d.vec3f))` has `arrayStride: 12` (verified in the mock descriptor).
- `d.vec3f(1, 2, 3)`, `d.f32(x)`, `d.u32(x)` construct and cast. `d.Vec3f` is the schema type, `d.v3f` the instance type. Atomics: `d.atomic(d.u32)` (`data/atomic.d.ts:11`), 4 bytes.
- `u16` arrays are index-buffer data. `$usage('storage')` on them is a type error (`core/buffer/buffer.d.ts:52-55`, checked with tsover).

## 3. Buffers

```ts
import { d } from 'typegpu';
const Params = d.struct({ dt: d.f32, gravity: d.vec3f });
const paramsBuf = root.createUniform(Params, { dt: 1 / 60, gravity: d.vec3f(0, -9.8, 0) });
const hairs = root.createBuffer(d.arrayOf(d.vec4f, 64 * 32)).$usage('storage');
const indices = root.createBuffer(d.arrayOf(d.u32, 6), [0, 1, 2, 2, 1, 3]).$usage('index');
const drawArgs = root
  .createBuffer(d.struct({ vertexCount: d.u32, instanceCount: d.u32, firstVertex: d.u32, firstInstance: d.u32 }))
  .$usage('indirect');

hairs.write(new Float32Array(64 * 32 * 4));            // typed array: bytes copied as-is (must match padded layout)
hairs.write([[0, 0, 0, 1]], { startOffset: 16 * 3 });  // byte offsets; ranges must be 4-byte aligned
hairs.patch({ 5: d.vec4f(1, 2, 3, 4) });               // sparse array update: only element 5 uploaded
const first = await hairs.read();                      // async; allocates a staging buffer if not MAP_READ
```

- `root.createBuffer(schema, initial?)` (`core/root/rootTypes.d.ts:312`). `initial` is a value or an initializer callback that receives the mapped buffer.
- `root.createUniform` / `createReadonly` / `createMutable` (`rootTypes.d.ts:331`, `:367`, `:349`) return bindings with usage already set (`init.js:223-237`). They can be used directly in shaders (section 5).
- `buf.$usage(...usages)` (`buffer.d.ts:79`). Default flags are `COPY_SRC | COPY_DST` (`buffer.js:60`). Flags are read when the GPU buffer is first materialized (`buffer.js:87`), which happens on the first write, bind or unwrap. Call `$usage` right after creation.
- `buf.as('mutable' | 'readonly' | 'uniform')` (`buffer.d.ts:84`). Storage access requires `$usage('storage')` first (`core/buffer/bufferBinding.js:120-126`).
- `write` and `patch` go through a host mirror and `queue.writeBuffer` (`buffer.js:195-241`). Offsets are bytes. A range that is not 4-byte aligned throws `Cannot write to bytes 2-4 ... WebGPU requires writes to start and end at a multiple of 4 bytes` (verified; `buffer.js:222`).
- `patch` on an array uploads only the touched elements (verified: `patch({2: ...})` uploaded 12 bytes at offset 32).
- Typed arrays and `ArrayBuffer`s are copied without interpretation (`docs apis/buffers.mdx`, "Permissive write inputs").
- `read()` on a buffer without `MAP_READ` allocates a staging buffer per call (`buffer.js:297`). Do not call it every frame.
- `copyFrom(src, encoder?)` and `clear(encoder?)` (`buffer.d.ts:91-92`). `buf.destroy()` releases owned buffers. `root.unwrap(buf)` or `buf.buffer` gives the raw `GPUBuffer`.

Struct-of-arrays upload (verified): packed fields go in, padding is inserted (`common/writeSoA.d.ts:11`).

```ts
import { common, d } from 'typegpu';
const Particle = d.struct({ pos: d.vec3f, vel: d.f32 });
const soa = root.createBuffer(d.arrayOf(Particle, 2)).$usage('storage');
common.writeSoA(soa, { pos: new Float32Array([1, 2, 3, 4, 5, 6]), vel: new Float32Array([10, 20]) });
```

## 4. Shader functions

Three forms, all callable from each other.

```ts
import { tgpu, d, std } from 'typegpu';

// (a) JS body: needs unplugin-typegpu. Also callable from plain JS.
const rotate = (v: d.v2f, a: number) => {
  'use gpu';
  const c = std.cos(a);
  const s = std.sin(a);
  return d.vec2f(v.x * c - v.y * s, v.x * s + v.y * c);
};

// (b) Typed shell: tgpu.fn([argSchemas], returnSchema)(implementation). The body still needs 'use gpu'.
const scale = tgpu.fn([d.vec3f, d.f32], d.vec3f)((v, s) => {
  'use gpu';
  return v.mul(s);
});

// (c) WGSL string body: parameter list without 'fn' or the name. Externals go in $uses.
const mixColor = tgpu.fn([d.f32], d.vec3f)`(t) {
  return mix(vec3f(1.0, 0.0, 0.0), vec3f(0.0, 1.0, 0.0), t);
}`;
const useMix = tgpu.fn([d.f32], d.vec3f)`(t) {
  return mixer(t);
}`.$uses({ mixer: mixColor });
```

Verified WGSL for (c): `fn useMix(t: f32) -> vec3f { return mixColor(t); }`, with `mixColor` emitted as a dependency.

Entry points:

```ts
import { tgpu, d } from 'typegpu';

const sim = tgpu.computeFn({
  workgroupSize: [64],                          // 1 to 3 numbers
  in: { gid: d.builtin.globalInvocationId },
})((input) => {
  'use gpu';
  const i = input.gid.x;
  void i;
});

const vs = tgpu.vertexFn({
  in: { vid: d.builtin.vertexIndex, iid: d.builtin.instanceIndex },
  out: { pos: d.builtin.position, t: d.f32, id: d.interpolate('flat', d.u32) },
})((input) => {
  'use gpu';
  return { pos: d.vec4f(0, 0, 0, 1), t: d.f32(input.vid), id: input.iid };
});

const fs = tgpu.fragmentFn({
  in: { t: d.f32, id: d.interpolate('flat', d.u32) },
  out: d.vec4f,
})((input) => {
  'use gpu';
  return d.vec4f(input.t, 0, 0, 1);
});
```

- Integer varyings need `d.interpolate('flat', ...)`. Without it, resolution fails with `Integer value "id" in vertexFn ... output requires flat interpolation` (verified).
- Builtins (`d.builtin.*`, `builtin.d.ts:22-43`). Vertex in: `vertexIndex`, `instanceIndex`. Vertex out: `position`, `clipDistances`. Fragment in: `position`, `frontFacing`, `primitiveIndex`, `sampleIndex`, `sampleMask`. Fragment out: `fragDepth`, `sampleMask`. Compute in: `globalInvocationId`, `localInvocationId`, `localInvocationIndex`, `workgroupId`, `numWorkgroups`.
- Inline closures can be passed straight to `createRenderPipeline` (verified; example in section 7).

### Operators and std

- In `'use gpu'` bodies, `+ - * / %` work on numbers, vectors and matrices (tsover). On the CPU, use methods (`add`, `sub`, `mul`, `div`, `mod`; `data/wgslTypes.d.ts:34-45`).
- `std` (`std/index.d.ts`), grouped:
  - Numeric: `normalize`, `length`, `distance`, `dot`, `cross`, `reflect`, `mix`, `clamp`, `smoothstep`, `step`, `sqrt`, `inverseSqrt`, `pow`, `exp`, `log`, `floor`, `fract`, `round`, `sign`, `min`, `max`, `abs`, `atan2`, `saturate`, `transpose`, `determinant`.
  - Boolean: `select`, `lt`, `le`, `gt`, `ge`, `eq`, `ne`, `all`, `any`, `and`, `or`, `not`.
  - Atomics: `atomicLoad`, `atomicStore`, `atomicAdd`, `atomicSub`, `atomicMin`, `atomicMax`, `atomicAnd`, `atomicOr`, `atomicXor`, `atomicExchange`, `atomicCompareExchangeWeak` (`std/atomic.d.ts:4-27`).
  - Barriers: `workgroupBarrier`, `storageBarrier`, `textureBarrier`, `workgroupUniformLoad`.
  - Textures: `textureSample`, `textureSampleLevel`, `textureLoad`, `textureStore`, `textureDimensions` (`std/texture.d.ts`). Also `arrayLength`, subgroup ops, packing, bitcast.
- `std.lt` and the other comparison helpers are component-wise, for vectors. For scalars use `a < b`.

Restrictions the generator enforces (messages from `tgsl/wgslGenerator.js`):

- `??`, `in`, `instanceof`, `|>` are unsupported (`:77-89`).
- Only `'use gpu'` functions can be called. `console.log` and some `Math.*` calls map to std. Other `Math` calls throw (`:659`, `:665`).
- `tgpu.const(...)` cannot be created inside a shader function. Define it at module scope (`:603`).
- Module-level JS values are inlined as constants at resolution. Changing them on the CPU later has no effect (`docs apis/functions/index.mdx`, "The outer scope").
- `&&`, `||`, `!` need boolean operands. `<`, `<=`, `>`, `>=` need numeric scalars (migration guide; verified message `Logical expression '&&' requires boolean operands`).
- Ternaries between struct, array or vector values are rejected. Use `std.select(a, b, cond)` for vectors, or `if`/`else` for structs (verified).
- A `let` cannot hold a reference into a buffer (`:1025`). Copy first: `let p = d.vec3f(seg.a);` (verified).
- Writing to uniform, readonly or argument bindings is rejected (`:1565-1574`). `TgpuUniform.$` is read-only in the TS types too (verified).
- `void x;` statements are rejected (verified).
- Number literals: an integer-valued JS literal becomes an abstract integer. `const a = 1.0` produced `const a = 1;` (the functions docs say `1i`; observed output differs). In an f32 expression it adapts (`2.0 * y` gave `2f * y`). Write `d.f32(1.0)` when the type matters.

## 5. Bind groups, fixed resources, `$uses`, slots, accessors

Explicit layout:

```ts
import { tgpu, d } from 'typegpu';
const Particle = d.struct({ pos: d.vec3f, vel: d.vec3f, life: d.f32 });
const Params = d.struct({ dt: d.f32, gravity: d.vec3f });
const layout = tgpu.bindGroupLayout({
  particles: { storage: d.arrayOf(Particle), access: 'mutable' }, // runtime-sized
  params: { uniform: Params },
  albedo: { texture: d.texture2d(d.f32) },
  linSampler: { sampler: 'filtering' },
});
const particlesBuf = root.createBuffer(d.arrayOf(Particle, 1024)).$usage('storage');
const paramsBuf = root.createUniform(Params, { dt: 1 / 60, gravity: d.vec3f(0, -9.8, 0) });
const albedoTex = root.createTexture({ size: [256, 256], format: 'rgba8unorm' }).$usage('sampled', 'render');
const bg = root.createBindGroup(layout, {
  particles: particlesBuf,
  params: paramsBuf,
  albedo: albedoTex.createView(d.texture2d(d.f32)),
  linSampler: root.createSampler({ minFilter: 'linear', magFilter: 'linear' }),
});
```

Inside a shader, use `layout.$.particles[i]` and `layout.$.params.dt`. Layouts: `tgpuBindGroupLayout.d.ts:122`. Entry types: `:24-60` (`access` defaults to `'readonly'`, and `storage` may be a function of the count). Bind groups: `rootTypes.d.ts:415`.

- A pipeline that uses a layout must receive its bind group via `.with(bg)`. Otherwise dispatch throws `MissingBindGroupsError` (`core/pipeline/drawState.js:75`).

Fixed resources (automatic catch-all group):

```ts
import { tgpu, d } from 'typegpu';
const time = root.createMutable(d.f32, 0);
const tick = tgpu.computeFn({ workgroupSize: [1] })(() => {
  'use gpu';
  time.$ += 1;
});
root.createComputePipeline({ compute: tick }).dispatchWorkgroups(1); // no .with(): the catch-all group is bound automatically
```

Verified WGSL: `@group(0) @binding(0) var<storage, read_write> time: f32;`. The catch-all is applied at dispatch (`drawState.js:58`). Bindings are numbered in resolution order, so do not hardcode indices.

`$uses` on WGSL templates: `tgpu.fn(...)` + template + `.$uses({ name: resource })`, where `name` is the identifier used in the body (`apis/functions/index.mdx`). The unplugin may rename a resource to its JS variable name. The body is rewritten to match (verified: `particleData` became `particleDataBuffer`).

Slots and accessors (verified WGSL):

```ts
import { tgpu, d } from 'typegpu';
const buf = root.createMutable(d.u32, 0);
const multiplier = tgpu.slot<number>(1);                          // core/slot/slot.d.ts:2
const kernel = tgpu.computeFn({ workgroupSize: [1] })(() => {
  'use gpu';
  buf.$ = buf.$ * d.u32(multiplier.$);
});
const mulPipe = root.with(multiplier, 3).createComputePipeline({ compute: kernel });

const tint = tgpu.accessor(d.vec3f, d.vec3f(1, 1, 1));           // core/slot/accessor.d.ts:8
const tintU = root.createUniform(d.vec3f, d.vec3f(1, 0, 0));
const vs = tgpu.vertexFn({ out: { pos: d.builtin.position } })(() => {
  'use gpu';
  return { pos: d.vec4f(0, 0, 0, 1) };
});
const frag = tgpu.fragmentFn({ out: d.vec4f })(() => {
  'use gpu';
  return d.vec4f(tint.$, 1);
});
const tintPipe = root.with(tint, tintU).createRenderPipeline({ vertex: vs, fragment: frag, targets: { format: 'rgba8unorm' } });
```

- `tgpu.slot<T>(default?)` holds any value, including TypeGPU functions. Bind with `root.with(slot, value)` before `createComputePipeline` or `createRenderPipeline`, or with `tgpu.fn(f).with(slot, value)` (`TgpuFn` is `Withable`, `tgpuFn.d.ts:24`). Missing values throw at runtime.
- `tgpu.accessor(schema, default?)` accepts buffer bindings, variables, constants, immediates, or literal values that match the schema (`core/slot/slotTypes.d.ts:55-59`). `tgpu.lazy` is `core/slot/lazy.d.ts:2`.

## 6. Compute pipelines

```ts
import { tgpu, d, std } from 'typegpu';
const N = 2048;
const Particle = d.struct({ pos: d.vec3f, vel: d.vec3f, life: d.f32 }); // 32 bytes
const Params = d.struct({ dt: d.f32, gravity: d.vec3f });
const sim = tgpu.bindGroupLayout({
  particles: { storage: d.arrayOf(Particle), access: 'mutable' },
  params: { uniform: Params },
});
const particlesBuf = root.createBuffer(d.arrayOf(Particle, N)).$usage('storage');
const paramsBuf = root.createUniform(Params, { dt: 0.016, gravity: d.vec3f(0, -9.8, 0) });

const integrate = tgpu.computeFn({
  workgroupSize: [64],
  in: { gid: d.builtin.globalInvocationId },
})((input) => {
  'use gpu';
  const i = input.gid.x;
  if (i >= d.u32(sim.$.particles.length)) {
    return;
  }
  const p = sim.$.particles[i];
  const v = p.vel + sim.$.params.gravity * sim.$.params.dt;
  sim.$.particles[i] = Particle({ pos: p.pos + v * sim.$.params.dt, vel: v, life: p.life - sim.$.params.dt });
});

const simPipe = root.createComputePipeline({ compute: integrate });
const simBG = root.createBindGroup(sim, { particles: particlesBuf, params: paramsBuf });
simPipe.with(simBG).dispatchWorkgroups(Math.ceil(N / 64));

// Batch several dispatches into one submission
const enc = root['~unstable'].createCommandEncoder();
const pass = enc.beginComputePass();
simPipe.with(pass).dispatchWorkgroups(Math.ceil(N / 64));
pass.end();
enc.submit();

// Indirect dispatch: the args buffer must have 'indirect' usage
const DispatchArgs = d.struct({ x: d.u32, y: d.u32, z: d.u32 });
const dispatchArgs = root.createBuffer(DispatchArgs, { x: 16, y: 1, z: 1 }).$usage('indirect');
simPipe.with(simBG).dispatchWorkgroupsIndirect(dispatchArgs);
```

- Verified WGSL for the kernel shape: `@compute @workgroup_size(64) fn integrate(@builtin(global_invocation_id) gid: vec3u)`, with `arrayLength(&particles)` and inline struct construction.
- `root.createComputePipeline({ compute })` (`core/root/rootTypes.d.ts:135`, `core/pipeline/computePipeline.d.ts:98`). Compilation is lazy, on first dispatch, `initSync` or `initAsync` (`computePipeline.js:225-300`).
- `pipe.with(x)` returns a new wrapper; the original is unchanged (`computePipeline.js:82`). Cache bound wrappers instead of rebuilding them each frame.
- `pipe.dispatchWorkgroups(x, y?, z?)` (`computePipeline.d.ts:76`) creates its own encoder and pass, then submits (`computePipeline.js:157-170`, `drawState.js:152`). Use an encoder to batch (above). A raw `GPUCommandEncoder` works too: `pipe.with(rawEnc)`, then `device.queue.submit([rawEnc.finish()])` (`docs apis/pipelines.mdx`, "WebGPU encoder interoperability").
- Indirect offsets come from `d.memoryLayoutOf(Schema, (v) => v.dispatch)`, must be 4-byte aligned, and go in the second argument (`computePipeline.d.ts:95`).

Guarded compute (stable in 0.12.7):

```ts
import { tgpu, d } from 'typegpu';
const doubled = root.createMutable(d.arrayOf(d.u32, 8), [0, 1, 2, 3, 4, 5, 6, 7]);
const doubleUp = root.createGuardedComputePipeline((x) => {
  'use gpu';
  doubled.$[x] *= 2;
});
doubleUp.dispatchThreads(8);  // rootTypes.d.ts:204; dispatchThreads at :73
```

- Verified WGSL: `@workgroup_size(256, 1, 1)` for one dimension, plus a `sizeUniform` bounds check. Default workgroup sizes: `[1,1,1]`, `[256,1,1]`, `[16,16,1]`, `[8,8,4]` (`init.js:37-42`). You cannot set workgroup size or use builtins in guarded pipelines.
- Guarded pipelines cannot record into a pass or encoder. Each `dispatchThreads` submits (`docs apis/pipelines.mdx`).

Workgroup memory and atomics (verified WGSL):

```ts
import { tgpu, d, std } from 'typegpu';
const tile = tgpu.workgroupVar(d.arrayOf(d.u32, 64));       // core/variable/tgpuVariable.d.ts:38
const counters = root.createMutable(d.arrayOf(d.atomic(d.u32), 4));
const reduce = tgpu.computeFn({
  workgroupSize: [64],
  in: { lid: d.builtin.localInvocationId },
})((input) => {
  'use gpu';
  tile.$[input.lid.x] = input.lid.x;
  std.workgroupBarrier();
  std.atomicAdd(counters.$[0], tile.$[input.lid.x]);
});
```

Per-thread variables use `tgpu.privateVar(d.u32, 0)` (initial value is the second argument, `tgpuVariable.d.ts:31`). `tgpu.const` is for module-level values.

## 7. Render pipelines

The 0.12 API is one descriptor. `withVertex(...).withFragment(...)`, `withCompute` and `createPipeline` were removed (`migrations/0-12.mdx`). `createRenderPipeline` takes `{ vertex, fragment, attribs?, targets?, primitive?, depthStencil?, multisample? }` (`core/pipeline/renderPipeline.d.ts:160-179`, `core/root/rootTypes.d.ts:136-158`).

Vertex pulling from storage (no vertex buffers; verified WGSL), with depth, MSAA, blending, and a draw:

```ts
import { tgpu, d } from 'typegpu';
const Segment = d.struct({ a: d.vec3f, b: d.vec3f });
const segmentCount = 16384;
const segments = root.createReadonly(d.arrayOf(Segment, segmentCount));
const camera = root.createUniform(d.mat4x4f);

const hairVert = tgpu.vertexFn({
  in: { vid: d.builtin.vertexIndex, iid: d.builtin.instanceIndex },
  out: { pos: d.builtin.position, t: d.f32, id: d.interpolate('flat', d.u32) },
})((input) => {
  'use gpu';
  const seg = segments.$[input.iid];
  let p = d.vec3f(seg.a);
  if (input.vid === 1) {
    p = d.vec3f(seg.b);
  }
  return { pos: camera.$ * d.vec4f(p, 1), t: d.f32(input.vid), id: input.iid };
});

const hairFrag = tgpu.fragmentFn({
  in: { t: d.f32, id: d.interpolate('flat', d.u32) },
  out: d.vec4f,
})((input) => {
  'use gpu';
  return d.vec4f(input.t, d.f32(input.id % 7) / 7, 0.5, 1);
});

const hairPipe = root.createRenderPipeline({
  vertex: hairVert,
  fragment: hairFrag,
  targets: {
    format: 'rgba8unorm',
    blend: {
      color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' },
      alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
    },
    writeMask: 0xf,
  },
  primitive: { topology: 'line-list', cullMode: 'none' },
  depthStencil: { format: 'depth24plus', depthWriteEnabled: false, depthCompare: 'less' },
  multisample: { count: 4 },
});

const msaaTex = root.createTexture({ size: [1280, 720], format: 'rgba8unorm', sampleCount: 4 }).$usage('render');
const depthTex = root.createTexture({ size: [1280, 720], format: 'depth24plus' }).$usage('render');

hairPipe
  .withColorAttachment({ view: msaaTex, resolveTarget: context, clearValue: [0, 0, 0, 1] })
  .withDepthStencilAttachment({ view: depthTex.createView('render'), depthClearValue: 1, depthLoadOp: 'clear', depthStoreOp: 'store' })
  .draw(2, segmentCount);  // 2 vertices per segment, one instance per segment

// Same draw, recorded into an encoder-owned pass (lets several pipelines share one pass)
const enc = root['~unstable'].createCommandEncoder();
const pass = enc.beginRenderPass({
  colorAttachments: [{ view: msaaTex, resolveTarget: context, clearValue: [0, 0, 0, 1] }],
  depthStencilAttachment: { view: depthTex },
});
hairPipe.with(pass).draw(2, segmentCount);
pass.end();
enc.submit();
```

- Verified descriptor mapping (mock device): `targets[0].blend`, `writeMask`, `primitive`, `depthStencil` and `multisample.count: 4` all reach `createRenderPipeline`.
- Without `targets`, the color format defaults to `navigator.gpu.getPreferredCanvasFormat()` (`core/pipeline/connectTargetsToShader.js:24,32`). Any other format needs `targets`.
- Multi-pass variant (encoder-owned pass) is the last block above: one encoder, one pass per frame.

- `pass.setPipeline`, `setBindGroup`, `setVertexBuffer` and `setImmediates` exist too (`core/commandEncoder/renderPass.d.ts:50-94`). `root['~unstable'].createRenderBundleEncoder` records reusable bundles (`rootTypes.d.ts:487`).
- Indexed draws: `pipe.withIndexBuffer(buf)` returns a pipeline with `drawIndexed` (`renderPipeline.d.ts:127-128`, `HasIndexBuffer` at `:67-70`). `drawIndirect` and `drawIndexedIndirect` take `$usage('indirect')` buffers (`:148`, `:157`).

Vertex-buffer path (verified):

```ts
import { tgpu, d } from 'typegpu';
const pos = tgpu.vertexLayout(d.arrayOf(d.vec3f));  // core/vertexLayout/vertexLayout.d.ts:24; stride 16
const positionBuffer = root.createBuffer(d.arrayOf(d.vec3f, 3)).$usage('vertex');
const meshPipe = root.createRenderPipeline({
  attribs: { position: pos.attrib },                // name matches the vertex input
  vertex: ({ position }) => {
    'use gpu';
    return { $position: d.vec4f(position, 1) };
  },
  fragment: () => {
    'use gpu';
    return d.vec4f(1, 1, 1, 1);
  },
  targets: { format: 'rgba8unorm' },
});
meshPipe.with(pos, positionBuffer).draw(3);
```

For instance data, use `tgpu.vertexLayout(d.disarrayOf(d.vec3f), 'instance')` (packed, stride 12).

## 8. Textures and samplers

```ts
import { tgpu, d, std } from 'typegpu';
const albedoTex = root.createTexture({ size: [512, 512], format: 'rgba8unorm' }).$usage('sampled', 'render');
albedoTex.write(imageBitmap);                      // 'render' usage needed; size must match or pass { fit: 'stretch' }
const linSampler = root.createSampler({ magFilter: 'linear', minFilter: 'linear' });
const texLayout = tgpu.bindGroupLayout({
  albedo: { texture: d.texture2d(d.f32) },
  linSampler: { sampler: 'filtering' },
});
const texBG = root.createBindGroup(texLayout, {
  albedo: albedoTex.createView(d.texture2d(d.f32)),
  linSampler,
});
const shade = tgpu.fragmentFn({ in: { uv: d.vec2f }, out: d.vec4f })((input) => {
  'use gpu';
  return std.textureSample(texLayout.$.albedo, texLayout.$.linSampler, input.uv);
});
```

Verified WGSL: `@group(0) @binding(0) var albedo: texture_2d<f32>;`, `@group(0) @binding(1) var linSampler: sampler;`, and `textureSample(albedo, linSampler, _arg_0.uv)`.

- Storage textures: `$usage('storage')` plus a layout entry `{ storageTexture: d.textureStorage2d('rgba8unorm', 'write-only') }` (`data/texture.d.ts`).
- `createView(schema, desc?)` (`core/texture/texture.d.ts:117-122`). `createView('render')` returns a render view for attachments (`:118`).
- `root.createTexture` (`rootTypes.d.ts:377`). Set `sampleCount` for MSAA. `viewFormats` allows views in another format, such as sRGB.
- Raw interop: `root.unwrap(tex)` gives the `GPUTexture`. `rendering/3d-fish/scene.ts` also creates its depth texture with `root.device.createTexture`.

## 9. Timestamps and performance

```ts
import { tgpu } from 'typegpu';
const sim = tgpu.computeFn({ workgroupSize: [64] })(() => {
  'use gpu';
});
const simPipe = root.createComputePipeline({ compute: sim });
const qs = root.createQuerySet('timestamp', 2);                // rootTypes.d.ts:390; needs timestamp-query
const timed = simPipe
  .withTimestampWrites({ querySet: qs, beginningOfPassWriteIndex: 0, endOfPassWriteIndex: 1 })
  .withPerformanceCallback((start, end) => {
    console.log(Number(end - start), 'ns');
  });

if (qs.available) {
  qs.resolve();
  const [t0, t1] = await qs.read(); // bigint[]
}
```

- `withTimestampWrites` throws `Timestamp writes require the "timestamp-query" feature` when the feature is missing (`core/pipeline/timeable.js:23`). `withPerformanceCallback` only logs a warning and returns the pipeline unchanged (`computePipeline.js:134`).
- Callback signature: `(start: bigint, end: bigint) => void | Promise<void>` (`timeable.d.ts:10`). Only the last callback is used. Encoder-bound pipelines fire after `enc.submit()`. Shared passes do not support it; set `timestampWrites` on the pass descriptor.
- `querySet.resolve()` must run before `read()`. `read()` throws while a previous read is in flight, so check `available` first (`core/querySet/querySet.d.ts:9-25`).

## 10. Gotchas and limitations (0.12.7)

- **Removed APIs:** `withVertex`, `withFragment`, `withCompute`, `createPipeline`, `.value` (use `.$`), `layout.bound` (use `layout.$`), `root['~unstable'].flush()`. Replace `beginRenderPass(desc, callback)` with `createCommandEncoder()` (`migrations/0-12.mdx`).
- **`~unstable` root members:** `createCommandEncoder` and `createRenderBundleEncoder` are unstable. The rest are stable duplicates (`createTexture`, `createSampler`, `createComparisonSampler`, `createGuardedComputePipeline`, `pipe`, `with`). `tgpu['~unstable']` still holds `simulate`, `declare`, `immediateVar`, `rawCodeSnippet`, `namespace` (`tgpuUnstable.d.ts:1-5`).
- **Immediates** (`tgpu['~unstable'].immediateVar`, `core/immediate/immediateVar.d.ts:32`) need the `immediate_address_space` WGSL extension (Chrome 149+). Check `root.enabledWgslLanguageFeatures` first.
- **Plugin:** every `'use gpu'` body needs `unplugin-typegpu` (`typegpu()` in Vite). There is no `'kernel'` directive in 0.12.7; a search of both packages found none.
- **Typing:** vector operators need tsover. With `noUncheckedIndexedAccess`, `arr[i]` is `T | undefined`. Writes to `TgpuUniform.$` and `&&` on non-booleans are type errors.
- **Storage limits:** `u16` is index-only. `d.arrayOf(T)` without a count is a function. `d.align`/`d.size` only work inside structs.
- **Buffers:** `read()` per frame allocates a staging buffer. Call `$usage` before first use. Byte offsets and lengths of writes must be 4-byte aligned.
- **Submission:** standalone `pipe.dispatchWorkgroups`, `draw` and `drawIndexed` each create and submit their own encoder (`drawState.js:152`, `renderPipeline.js:235-249`). Batch with one encoder per frame, and cache `pipe.with(x)` wrappers.
- **Roots:** resources from different roots do not interoperate. `root.destroy()` does not free buffers or textures.
- **Docs drift:** `pipelines.mdx` mentions `withDepthStencil`; the typed method is `withDepthStencilAttachment` (`renderPipeline.d.ts:125`). `functions/index.mdx` says `1.0` compiles to `1i`; observed output is `1`.
- **Guarded pipelines:** no builtins, fixed workgroup sizes, no pass or encoder recording.

## 11. Hair-specific notes (design advice, not GPU-verified)

- Keep per-segment state in a 16-byte-stride struct, for example `{pos: vec3f, t: f32}`, to avoid padding.
- Use double-buffered bind group pairs for ping-pong simulation steps, as in `apps/typegpu-docs/src/examples/simulation/boids/index.ts`.
- Render strands as `topology: 'line-list'` with vertex pulling by instance index. Use `flat` interpolation for integer ids. For thicker hair, generate triangle-strip ribbons in the vertex shader.
- Upload SoA data with `common.writeSoA`. For per-frame uniforms, use `root.createUniform` so the catch-all group binds them.
- Use one encoder per frame: compute passes first, then one render pass with `resolveTarget: context`.

## 12. Key signatures (file:line, relative to `node_modules/typegpu/`)

| API | Location |
|---|---|
| `tgpu.init`, `tgpu.initFromDevice` | `core/root/init.d.ts:101`, `:111` |
| `root.createBuffer` / `createUniform` / `createMutable` / `createReadonly` | `core/root/rootTypes.d.ts:312`, `:331`, `:349`, `:367` |
| `root.createTexture`, `createSampler`, `createQuerySet`, `createBindGroup`, `configureContext`, `destroy` | `rootTypes.d.ts:377`, `:378`, `:390`, `:415`, `:302`, `:441` |
| `root.createComputePipeline`, `createRenderPipeline`, `createGuardedComputePipeline` | `rootTypes.d.ts:135`, `:136-158`, `:204` |
| `root['~unstable']` members | `rootTypes.d.ts:442` |
| `buffer.$usage`, `as`, `write`, `patch`, `read`, `copyFrom`, `clear` | `core/buffer/buffer.d.ts:79`, `:84`, `:86`, `:90`, `:93`, `:92`, `:91` |
| `TgpuUniform` / `TgpuMutable` / `TgpuReadonly` (`$`) | `core/buffer/bufferBinding.d.ts:37`, `:23`, `:30` |
| `d.struct`, `d.arrayOf`, `d.atomic`, `d.align`, `d.size`, `d.interpolate` | `data/struct.d.ts:13`, `data/array.d.ts:34`, `data/atomic.d.ts:11`, `data/attributes.d.ts:41`, `:54`, `:84` |
| `d.disarrayOf`, `d.unstruct`, `d.memoryLayoutOf`, `d.sizeOf` | `data/disarray.d.ts:28`, `data/unstruct.d.ts:20`, `data/offsetUtils.d.ts:30`, `data/sizeOf.d.ts:7` |
| `tgpu.fn`, `computeFn`, `vertexFn`, `fragmentFn`, `$uses` | `core/function/tgpuFn.d.ts:46`, `tgpuComputeFn.d.ts:42`, `tgpuVertexFn.d.ts:48`, `tgpuFragmentFn.d.ts:63`, `tgpuFn.d.ts:31` |
| `tgpu.bindGroupLayout`, `TgpuLayoutStorage` (`access`) | `tgpuBindGroupLayout.d.ts:122`, `:39` |
| `tgpu.slot`, `tgpu.accessor`, `tgpu.lazy` | `core/slot/slot.d.ts:2`, `accessor.d.ts:8`, `lazy.d.ts:2` |
| `tgpu.privateVar`, `tgpu.workgroupVar`, `tgpu.const` | `core/variable/tgpuVariable.d.ts:31`, `:38`; `core/constant/tgpuConstant.d.ts:29` |
| `computePipeline.dispatchWorkgroups`, `dispatchWorkgroupsIndirect`, `Descriptor` | `core/pipeline/computePipeline.d.ts:76`, `:95`, `:98` |
| `renderPipeline` `withColorAttachment`, `withDepthStencilAttachment`, `withIndexBuffer`, `draw` | `core/pipeline/renderPipeline.d.ts:124`, `:125`, `:127`, `:129` |
| `DescriptorBase`, `Descriptor`, `HasIndexBuffer` | `core/pipeline/renderPipeline.d.ts:160`, `:174`, `:67` |
| `Timeable.withTimestampWrites` | `core/pipeline/timeable.d.ts:11` |
| `TgpuCommandEncoder`, `TgpuRenderPass`, `TgpuComputePass` | `core/commandEncoder/commandEncoder.d.ts:34`, `renderPass.d.ts:113`, `computePass.d.ts:37` |
| `std.normalize`, `std.atomicAdd`, `std.workgroupBarrier`, `std.textureSample` | `std/numeric.d.ts:205`, `std/atomic.d.ts:15`, `:4`, `std/texture.d.ts:15` |
| `common.writeSoA`, `common.fullScreenTriangle` | `common/writeSoA.d.ts:11`, `common/fullScreenTriangle.d.ts:17` |
| Unstable exports | `tgpuUnstable.d.ts:1-5`, `core/immediate/immediateVar.d.ts:32` |
| WGSL generator error messages | `tgsl/wgslGenerator.js:77-105`, `:603`, `:659`, `:665`, `:1025`, `:1565-1574` |
| Submission behaviour | `core/pipeline/drawState.js:144-154`, `computePipeline.js:157-170`, `renderPipeline.js:235-249` |
| Catch-all group and missing-group error | `core/pipeline/drawState.js:54-77` |
| Buffer defaults, materialization, write/read paths | `core/buffer/buffer.js:60`, `:87`, `:214`, `:222`, `:297` |

Examples in the repo (`apps/typegpu-docs/src/examples/`): `simulation/boids/index.ts` (storage ping-pong, instanced vertex layout, guarded compute, uniforms), `algorithms/bitonic-sort/index.ts` (`computeFn`, `createComputePipeline`, `createBindGroup`, timestamps), `rendering/3d-fish/scene.ts` (depth, guarded simulation, raw depth texture), `algorithms/matrix-next/computeShared.ts` (`workgroupVar`, barrier, `tgpu.fn` shell), `simulation/fluid-with-atomics/index.ts` (atomics).
