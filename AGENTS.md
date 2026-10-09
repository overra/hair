# AGENTS.md

Guidance for AI agents (Claude Code and others) working in this repository.

## Project focus

Build a **comprehensive, real-time hair simulation** — nothing else. Every decision should serve the hair system.

- **Full body atlas of hair types** — scalp (crown, temples, nape, hairline, sideburns), eyebrows, eyelashes, beard, mustache, ear/nose, axillary, chest, abdomen, back, arms, hands, pubic, legs, feet, and vellus "peach fuzz".
- **Broad scope of variables** that affect both the *appearance* (melanin, greying, dye, cuticle tilt, roughness, IOR, medulla, wetness, oil, damage, root-to-tip gradients) and the *behavior* (stiffness, diameter, ellipticity, curl, friction, cohesion, humidity, plasticity, damping) of hair.
- **Procedural and parametric** — grooms are generated from parameters, not hand-authored assets.
- **Cut / shave** — interactive trimming, shaving, clipper-guard lengths, fades.
- **Style** — comb, part, curl/straighten, clump, gel/hold, braids, ponytails, buns.
- Learn from industry prior art: Unreal Engine Groom, Frostbite strand hair, AMD TressFX, Unity demoteam hair, NVIDIA HairWorks, and the offline/academic literature (Marschner, d'Eon, Chiang, XPBD, Cosserat rods, DFTL, etc.).

## Tech stack

- **WebGPU** via **TypeGPU** (`typegpu`), TypeScript, Vite.
- **Spark.js v2** (`@sparkjsdev/spark`) for procedural Gaussian splats — *only if splats prove useful* for some part of the system (e.g. distant LOD, vellus fuzz). Strands are the default representation.

## Performance

- **Minimum 120 fps** (≤ 8.33 ms/frame). The target is aggressive on purpose: the hair system is the only thing on screen.
- Measure with GPU timestamp queries; keep a per-pass budget and treat regressions as bugs.

## Agent / model policy

- **Non-coding efforts** (research, literature review, surveys, summarization, documentation drafts, planning input) in subagents and workflows: use **Claude Haiku 5.5 at `xhigh` or `max` effort**.
- **Coding and deeper thinking** (implementation, architecture, debugging, code review, shader/algorithm design): use **Claude Opus 5.5 at `medium`, `high`, `xhigh`, or `max` effort**.
- **Never use Opus 5.5 at `low` effort.**

### Interaction focus: fingers through hair

A key target is a character whose hair you can **run your fingers through**. Contact is the hard part, more than
bending: strands must separate around fingers, slide with friction (stick–slip), keep their curl, and not pass
through each other. Guide interpolation breaks down exactly where fingers split the hair. The likely research
contribution is the **adaptive interaction layer**: detect where guide coherence fails, promote or repartition
strands near the hand, keep persistent frictional contact, transmit forces into the bulk groom, and return
smoothly to the reduced simulation. See `docs/research/05-*` and `06-*`.

## Repository layout

| Path | Purpose |
|---|---|
| `src/body/` | Procedural mannequin: SDF primitives (`sdf.ts`, which also emits WGSL), surface-nets mesher |
| `src/groom/` | Hair atlas (regions, masks, flow fields), parameter model and presets, CPU root scattering |
| `src/gpu/layouts.ts` | TypeGPU schemas and bind-group layouts (the single source of truth for GPU data) |
| `src/gpu/wgsl/` | WGSL kernels: `groom` (grow, cut, comb), `sim`, `expand`, `render`, `common` |
| `src/gpu/shaders.ts` | Assembles WGSL modules with `tgpu.resolve` (layouts referenced as `L.$.x`, `F.$.frame`, …) |
| `src/engine/` | `Renderer` (device, pipelines, frame encoding), `HairLayer` (one region's GPU buffers), GPU timer |
| `src/app/` | Camera, procedural hand (finger capsules) |
| `src/main.ts` | App shell: GUI, input, tools, frame loop, URL debug params |
| `scripts/screenshot.mjs` | Headless Chromium + SwiftShader WebGPU smoke test / screenshots |
| `docs/research/` | Research reports (atlas, rendering, simulation and grooming, TypeGPU, finger contact) |

## Architecture (current)

- **Data per region (`HairLayer`).** Point-major buffers (`index = point * count + strand`) so adjacent threads
  coalesce:
  - `restS`: body-space rest curve, with arc length in `w`.
  - `statics`: per-strand parameters, 7 × vec4.
  - `gPos`, `gPrev`, `gQ`: guide simulation state and rest-to-current frame rotations.
  - `render`: expanded render points, strand-major.
- **Guides are real strands.** A random subset (`GUIDE_STRIDE`) is simulated. Every strand follows its nearest
  guide (single-guide carry, which avoids head penetration from blending). Clump leaders are a separate subset.
- **Two curl scales.**
  - **Macro curl** (waves and large helices) is in the simulated rest shape, so it has mechanics.
  - **Micro coil** (tight 3C–4C coils and kinks) is added at render time around the simulated centerline, with
    shrinkage applied to the centerline length.
  - If the sim resolution cannot resolve the macro helix, the helix is demoted to a coil.
- **Frame:**
  - Compute: grow (on rebuild), then tools, then simulate × substeps, then expand.
  - Render: body shadow, hair shadow (front depth, for transmittance), main pass.
  - The main pass is 4× MSAA with a stochastic sample mask for sub-pixel strands.
- **Editing model.**
  - The rest shape (`restS`) is the authored, persistent state. Cut, clipper and comb edit it on the GPU.
  - Cutting resamples the rest curve to the new length, which keeps the point count.
  - Simulation state is derived from the rest shape. "Reset to rest" re-initializes it.
- **Kernel style.** Kernels are WGSL strings. TypeGPU provides the typed schemas, buffers and layouts, and
  resolves the resource declarations. TypeScript shaders (`'use gpu'`) would need `unplugin-typegpu` plus the
  `tsover` compiler for vector operators, so they are not used yet.

## Conventions

- Units are meters, except fiber diameter (µm) and angles (degrees) in the UI and parameters. +Y is up and the
  figure faces +Z.
- Body space is the mannequin's rest frame. Simulation and rendering are in world space through `frame.model`.
- WGSL reserves `pass`, `target` and similar words, so don't use them as identifiers. Parenthesize mixed `*`
  and `^` in WGSL.
- Verify GPU changes with `scripts/screenshot.mjs`, then check the console for compilation and validation
  errors. `HairLayer.debugRead(name)` reads back raw GPU buffers.
- Keep the 120 fps target in mind for every change. Note expected cost in commit messages for hot-path work.

## Roadmap (next)

1. **Hair–hair interaction.** A fixed-point atomic velocity and density grid gives volume, friction and force
   transfer from the hand into the bulk groom.
2. **Adaptive interaction layer for fingers.** Promote followers near the hand to simulated or contact-corrected
   strands. Re-partition guides when a finger splits a lock, keep persistent contacts for stick–slip, and blend
   back afterwards.
3. **Rod mechanics.** Move to XPBD Cosserat or Stable Cosserat Rods (bend and twist with rest Darboux vectors,
   anisotropic elliptical stiffness). Evaluate DER/ADMM (Daviet 2023) as the reference.
4. **Rendering.**
   - Deep opacity maps.
   - Dual-scattering multiple scattering.
   - Temporal AA for the stochastic coverage.
   - A compute rasterizer for sub-pixel strands.
   - Strand LOD.
5. **Grooming.**
   - Braids and ponytails (attachment constraints).
   - Curl, straighten, puff and smooth brushes, and plasticity.
   - Regrowth over time.
   - Undo.
6. **Body.** A baked SDF texture, skinning and an articulated head and neck.
