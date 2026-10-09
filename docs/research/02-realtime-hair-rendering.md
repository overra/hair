# Real-Time Hair Rendering: State of the Art and Recommendations for a 120 fps WebGPU Strand System

Research memo, dated 2026-10-09. Scope is research only; no production code. Target: a full groom of roughly 100k+ strands at 120 fps (an 8.33 ms GPU frame) on a modern desktop GPU, using WebGPU through TypeGPU.

## 0. Method and confidence

- Sources came from web search and page fetches. Inline links point to the page or PDF each claim came from.
- Several primary sources could not be read directly in this environment. The Frostbite 2019 SIGGRAPH slides and Karis 2016 slides came back as binary PDF. The Epic 4.24 tech blog returned HTTP 403. The WebGPU spec's primitive-state section was truncated in fetch. Where I rely on search excerpts or secondary sources, the text says so.
- Performance figures are the authors' or vendors' own. Most are native-API measurements on RTX 4090 or 5080 class GPUs, not WebGPU. Read them as orders of magnitude.
- Items marked [unverified] could not be confirmed in a primary source.

## 1. Executive summary

1. The production pattern is consistent across studios. Strands are simulated, often on a sparse set of guides. They are rendered through a dedicated strand path, shadowed through a density or deep-opacity structure, and shaded with Marschner-family lobes plus a multiple-scattering approximation. LOD steps from strands to bundles or cards to meshes.
2. The most relevant recent work is Lipp, Jarabo, Wimmer and Bode (arXiv 2607.04230, July 2026). It is a compute software rasterizer for strands with one-sample visibility, a reconstruction filter for anti-aliasing, and screen-coverage LOD. Its G-buffer uses 64-bit atomics, which WebGPU core does not provide, so we need a substitute.
3. WebGPU has no geometry, tessellation or mesh shaders, and hardware lines are one pixel wide. Per-strand compute rasterization is therefore the primary path. Hardware ribbon quads are a fallback for near-field strands wider than a pixel.
4. Gaussian splats are the wrong primitive for strands. Spark.js v2 is built on WebGL2 and three.js, and its docs describe no WebGPU backend. Adopting it would add a second renderer that cannot share our buffers. Distant and vellus hair should use strand LOD bundles and shells, implemented natively.
5. The budget is tight. My estimate is about 4.2 to 7.1 ms of hair GPU time at 1080p for roughly 100k to 130k strands, against a hair ceiling of about 6.5 ms at 120 fps. Meeting it requires strand LOD, amortized shadows, and a measurement spike on a high-end card in the first week.

## 2. Production systems

### 2.1 Overview

| System | Strand geometry | Visibility and AA | Transparency | Shadows | Scale reported |
|---|---|---|---|---|---|
| Unreal Engine grooms | Staged pipeline: simulation, interpolation, voxelization, primary visibility, lighting, composition ([UE docs](https://dev.epicgames.com/documentation/unreal-engine/groom-scalability-and-performance-with-unreal-engine)) | MSAA default 4 sub-samples (range 1–8); PPLL up to 32, marked "very expensive" (same page) | PPLL option, not default | Voxel transmittance by default; per-light deep opacity maps opt-in | About 50k strands for long hair and 200k for short hair on a high-end PC, 2020 ([UE 4.24 blog](https://www.unrealengine.com/en-US/tech-blog/an-early-look-at-next-generation-real-time-hair-and-fur)) |
| Frostbite and Dragon Age: The Veilguard | Per-strand compute software rasterizer, per the Veilguard post ([Microsoft Developer](https://developer.microsoft.com/en-us/games/articles/2024/12/bioware-dragon-age-the-veilguard-strand-hair-technology/)) | [unverified] for 2019 Frostbite | Opaque hair first, then transparent effects test against a hair depth texture and set a stencil bit ([EA post excerpt](https://www.ea.com/technology/news/strand-hair-dragon-age-the-veilguard)) | [unverified] | 10k strands in the 2019 demo; up to 50k per character on Xbox Series X in Veilguard |
| AMD TressFX 4.1 and 5.0 | GPU simulation and render | "High quality anti-aliasing," method unspecified ([GPUOpen](https://gpuopen.com/tressfx/)) | "ShortCut" OIT option in 3.1 | Shadow casting and receiving in 5.0; deep shadow approximation for UE 5.4 | No counts on the page |
| NVIDIA HairWorks | Tessellation-generated strands | Not documented here | Not documented here | Self-shadowing | 10k to 60k per figure, per 2015 press ([ComputerBase](https://www.computerbase.de/2015-05/witcher-3-grafikkarten-test-benchmark-prozessoren-vergleich/)) |
| Unity demoteam hair | GPU strand simulation, Alembic import, procedural scattering ([repository](https://github.com/Unity-Technologies/com.unity.demoteam.hair)) | Not in the README | Not in the README | Not in the README | "Tens of thousands" of strands |

### 2.2 Unreal Engine

What the current groom documentation states:

- **Pipeline.** Simulation, interpolation, voxelization, primary visibility, lighting and composition are separate stages. Cost rises with curve count, mainly in simulation, interpolation, voxelization and primary visibility ([UE groom scalability](https://dev.epicgames.com/documentation/unreal-engine/groom-scalability-and-performance-with-unreal-engine)).
- **LOD.** Strands are the top level. Imported cards, or cards from the Hair Card Generator, and meshes are fallbacks. A single LOD can mix strands and cards. "Auto LOD bias" reduces curve count sooner as coverage shrinks. Decimation of curves and points is available in the Strands panel.
- **Shadows.** Voxelization is the default, and the same voxel data serves Lumen and ambient occlusion. The voxel size CVar `r.HairStrands.Voxelization.VoxelSizeInPixel` defaults to 0.3 per the docs. Deep opacity shadow maps are opt-in per light for important lights.
- **Anti-aliasing.** MSAA is the default. "Stable rasterization" snaps hair to pixels and is documented for sparse, scattered hair only, because groups look thicker.
- **Ray tracing.** Hair ray-tracing geometry is off by default and expensive for animated grooms.

The 2020 Epic blog for 4.24 is the only design-level source I could read, and I used search excerpts for it because the fetch was refused. It states:

- A full hair shader and renderer with multiple scattering from light sources, ray-traced shadows, and Niagara-driven simulation.
- Grooms arrive via Alembic from Ornatrix, Yeti and XGen.
- Multiple scattering uses the dual scattering approximation: first estimate the light that has passed through the volume, then evaluate local scattering from that estimate.
- An informal forum reply says the multiple-scattering term applies only to groom assets, and other geometry falls back to Kajiya-Kay ([UE forum](https://forums.unrealengine.com/t/regarding-the-dual-scattering-implementation-in-unreal-engine-vs-the-original-paper/2738248)).

What we should take from this: the stage separation, LOD by coverage, and per-light opt-in for expensive shadows. Voxelizing everything and ray-traced hair are not affordable in our budget. I could not verify the current UE5 visibility implementation. The engine source is the authority for that.

### 2.3 EA SEED and Frostbite

- **2019 SIGGRAPH Advances talk.** Sebastian Tafuri's "Strand-based hair rendering in Frostbite" slides ([PDF](https://www.advances.realtimerendering.com/s2019/hair_presentation_final.pdf)) could not be read here. The talk is described as work in progress.
- **Frostbite blog, part 2.** Strands are imported as NURBS and resampled to evenly spaced points. The long-hair asset uses 25 points per strand, and the short style uses 3 to 5. The demo simulated and rendered about 10k strands. The post says more points raise simulation quality and cost, and that performance for games is still "challenging" ([part 2](https://ea.com/frostbite/amp/news/frostbite-hair-rendering-and-simulation-2)).
- **Frostbite blog, part 1.** The stated goal is "a step change in real-time hair and reach results close to movie and offline rendering." Follow-up posts were promised on the shading model, multiple scattering, and anti-aliasing of fine hair ([part 1](https://ea.com/frostbite/amp/news/frostbite-hair-rendering-and-simulation)). I could not retrieve those follow-ups.
- **Dragon Age: The Veilguard (2024).** BioWare's Maciej Kurowski describes a compute-based software rasterizer that processes each strand individually, rendering up to 50k strands per character on Xbox Series X. The system took more than four years of joint BioWare and Frostbite effort. It is described as memory- and computation-intensive ([Microsoft Developer](https://developer.microsoft.com/en-us/games/articles/2024/12/bioware-dragon-age-the-veilguard-strand-hair-technology/)).
- **Veilguard details from EA's post (search excerpt).** The per-hair point limit rose from 63 to 255. Lighting got better transmittance and visibility. Transparency works in two passes: opaque hair first, then transparent effects test against the hair depth texture and set a stencil bit where they sit behind hair. EA claims 60 fps on PS5, Xbox Series X and PC ([EA](https://www.ea.com/technology/news/strand-hair-dragon-age-the-veilguard)). These are EA's own figures.
- **Frostbite software rasterization.** The 2026 Lipp paper cites Taillandier and Valdes (2020) as describing software rasterization for AAA hair using tiled per-pixel depth-bucket OIT and analytic line anti-aliasing ([arXiv 2607.04230](https://arxiv.org/abs/2607.04230)). [unverified] I could not access that 2020 source.

### 2.4 AMD TressFX

- **Versions** ([GPUOpen](https://gpuopen.com/tressfx/)). 3.1 (2016) introduced a "ShortCut" OIT option. 4.1 (2017) added an optimized simulation, StrandUV, hair parameter blending and a new LOD system, with Radeon Cauldron source in DX12 and Vulkan. 5.0 targets UE 4.26/4.27 and UE 5.4 and adds shadow casting and receiving, a deep shadow approximation and continuous LOD. The library is MIT licensed.
- **Anti-aliasing and transparency.** The GPUOpen page does not name the anti-aliasing method. Press coverage of the 2013 original describes per-strand coverage converted to alpha and per-pixel linked lists that sort the nearest K fragments and blend the rest. [secondary, unverified against the original]

Adopt the LOD concept and the ShortCut-style approximate OIT as a baseline. PPLL is memory-heavy and should not be the default.

### 2.5 NVIDIA HairWorks

HairWorks used tessellation to generate strands. Press in 2015 reported 10k to 60k strands per figure, and about 30k on average for Geralt in The Witcher 3 ([ComputerBase](https://www.computerbase.de/2015-05/witcher-3-grafikkarten-test-benchmark-prozessoren-vergleich/)). Its features included self-shadowing, body-to-hair shadow casting, wind and LOD. I found no primary shading documentation, and I did not verify current support. The relevant lesson is the pattern: tessellation-driven strand generation is not available to us in WebGPU.

### 2.6 Unity

- **com.unity.demoteam.hair.** The package covers strand authoring and import, GPU simulation with interactive editing, and procedural scattering on meshes. It handles tens of thousands of strands and requires Unity 2020.2 or later ([repository](https://github.com/Unity-Technologies/com.unity.demoteam.hair)). Its README covers the solver more than shading.
- **Enemies and Lion demos.** Lion extended the approach to "several orders of magnitude more hair strands" and runs in real time at 4K on PS5. No frame-rate or strand counts are published in the article ([CGChannel](https://www.cgchannel.com/2022/08/watch-lion-unitys-fur-raising-new-tech-demo/)). A search excerpt attributed tile-based rasterization, analytic anti-aliasing and compute-sorted OIT to Unity's HDRP work. I could not confirm that in the article, so treat it as [unverified].

### 2.7 Recent research systems

- **Hair meshes.** Yuksel's SIGGRAPH 2024 work generates strands on the GPU from a coarse hair mesh. A scene of 100 characters with 100k strands each rasterizes in 2 ms on an RTX 4090 with 8x MSAA. Each model is 13 to 21 KB. The method relies on mesh shaders ([project page](https://cemyuksel.com/research/hairmesh_rendering/)). The 2025 follow-up by Bhokare et al. adds LOD by control-point count ([SIGGRAPH history](https://history.siggraph.org/experience/super-fast-strand-based-hair-rendering-with-hair-meshes-by-bhokare-montalvo-diaz-allen-and-yuksel)).
- **Strand LOD with thick primitives.** Huang et al. replace clusters of strands with elliptical thick hairs chosen by projected width, with a matching scattering model. This avoids the motion and appearance breaks that hair cards cause. The arXiv abstract claims up to 3x speedup, while the PDF and the journal version claim up to 13x. I treat the speedup as uncertain ([arXiv 2405.10565](https://arxiv.org/abs/2405.10565); [CGF 2025](https://diglib.eg.org/handle/10.1111/cgf70181)).
- **Compute software rasterizer.** Lipp et al. (PACMCGIT 9(4), article 58, July 2026; [PDF](https://www.cg.tuwien.ac.at/research/publications/2026/LIPP-2026-HAIR/LIPP-2026-HAIR-paper.pdf)) are the most relevant source for us. Section 6 covers the details.

## 3. Shading models

| Model | Source | What it gives | Real-time suitability | Recommendation |
|---|---|---|---|---|
| Kajiya-Kay | Kajiya and Kay 1989 | Tangent-based diffuse and specular; no R/TT/TRT split; not energy conserving | Very cheap | Baseline and far-field fallback |
| Marschner | [Marschner et al. 2003](https://w1.graphics.cornell.edu/pubs/2003/MJC+03.pdf) | Measured R, TT and TRT lobes with azimuthal dependence | Naive evaluation is costly; needs approximations | Basis for the lobe structure |
| d'Eon | [d'Eon et al. 2011, EGSR](https://diglib.eg.org/items/a62ba8bb-e415-4395-9be6-9c9186ededfa) | Energy-conserving analytic model; arbitrary internal reflections; non-Gaussian longitudinal term | Good for precomputed tables | Reference for LUT generation |
| Chiang | [Chiang et al. 2016, CGF 35(2)](https://diglib.eg.org/handle/10.1111/cgf12830) | Near-field, energy conserving; higher internal bounces folded into one isotropic lobe; closed-form logistic azimuthal distribution; artist parameters | Well suited to real time | Primary BSDF candidate |
| Yan | [Yan et al. 2015](https://cseweb.ucsd.edu/~viscomp/projects/fur/index.html), [Yan et al. 2017](https://history.siggraph.org/?p=102376) | Fur as two nested cylinders with a medulla; 2017 version uses five lobes and about 150 KB of precomputed data | Good for fur and vellus | Only if we need animal fur or medulla control |
| Karis (UE) | [Karis, SIGGRAPH 2016 course](https://blog.selfshadow.com/publications/s2016-shading-course/karis/s2016_pbs_epic_hair.pdf) | Wrapped Lambert term; absorption scaled by path length; fake normals in place of authored ones, given filtered shadows | Cheap | Adopt the wrapped diffuse and fake-normal ideas |
| Zinke dual scattering | [Zinke et al. 2008, TOG 27(3)](https://cemyuksel.com/research/dualscattering/) | Global lobe for light crossing many fibers, local lobe for backscatter in the neighborhood | Designed for real time; no parameter tuning | Multiple-scattering term |

Notes:

- The Karis slides were only partly readable. A search excerpt says the approximation is a "biggest opportunity" open problem near slide 37. I did not verify that slide directly.
- The dual scattering project page reports a GPU implementation at real-time rates. Its demo video ran at about 14 fps on a GeForce 8800 GTX, so the numbers are old. Pixar notes that d'Eon et al. 2011 found non-negligible higher-order energy for light hair, especially at grazing angles. That affects approximations that drop higher orders ([Pixar paper](https://graphics.pixar.com/library/DataDrivenHairScattering/paper.pdf)). [inference from excerpt]

Recommended shading stack for 120 fps:

- Chiang-style R, TT and TRT lobes with an isotropic residual, using a closed-form azimuthal distribution. Precompute longitudinal terms in a small LUT.
- Dual scattering for the multiple-scattering term, with the global transmittance taken from the deep opacity shadow.
- Karis-style wrapped diffuse for short and vellus hair, and fake normals instead of an authored normal map.
- Scattering to scene light (UE's "Scatter Scene Lighting") for vellus, so short hair picks up skin-bounce colour.

The per-fragment ALU budget is my estimate and needs measuring. Start with the LUT and closed-form choices, and profile before adding terms.

## 4. Shadows, self-shadowing, transparency and anti-aliasing

### 4.1 Shadows

- **Deep shadow maps** ([Lokovic and Veach 2000](https://graphics.stanford.edu/papers/deepshadows/)) store per-pixel visibility as a function of depth. They are prefiltered and support partially transparent and volumetric occluders. Their variable per-pixel storage fits GPU SIMD poorly, so they are mostly offline ([patent summary](https://image-ppubs.uspto.gov/dirsearch-public/print/downloadPdf/9514566)). Not for us.
- **Deep opacity maps** ([Yuksel and Keyser 2008, CGF 27(2)](https://www.cemyuksel.com/research/deepopacity)) build layers from a depth map rather than evenly spaced slices. They need far fewer layers than opacity shadow maps and avoid layering artifacts. They ran in real time on the hardware of the time. This is the best fit for us.
- **Voxel transmittance** (UE) builds a density volume and ray-marches it. The same volume also serves ambient occlusion and Lumen, which makes it attractive for quality, but it costs more per light. TressFX 5.0 uses a deep shadow approximation for UE 5.4.

Recommendation: one deep opacity map for the key light, built from the same strand generator. Make it opt-in per light, as UE does. Allow a half-rate update with reprojection as a budget lever. Skip voxels in the first version.

### 4.2 Order-independent transparency

- **Per-pixel linked lists (PPLL).** Exact-ish and used by TressFX and UE, but UE calls it very expensive and recommends it for linear media and cinematics. WebGPU can implement it with u32 atomics, but the memory and contention cost is high. Not the default.
- **Weighted blended OIT** ([McGuire and Bavoil 2013, JCGT](https://www.jcgt.org/published/0002/02/09/paper.pdf)). One pass with additive blending into float targets, approximate but order-independent. Cesium adopted it for WebGL because PPLL needed atomics that WebGL lacks ([Cesium](https://cesium.com/blog/2014/03/14/weighted-blended-order-independent-transparency/)). WebGPU has atomics, so PPLL is available, but WBOIT is still the cheaper option if fuzz ever needs it.
- **Stochastic transparency** ([Enderton et al. 2010](https://www.cse.chalmers.se/~d00sint/StochasticTransparency_I3D2010.pdf)). One pass with fixed memory and no sorting, but noisy. It needs a temporal filter. It covers hair, smoke and foliage in one pass.
- **Visibility plus reconstruction.** Lipp's approach resolves the nearest strand per pixel with a reconstruction filter that produces coverage-based alpha. It avoids hair-internal OIT entirely.

Recommendation: nearest-strand visibility with reconstruction alpha for hair-on-hair. The Veilguard two-pass depth-and-stencil scheme for hair against transparent effects. Keep WBOIT or PPLL in reserve for fuzz.

### 4.3 Anti-aliasing thin strands

Strands are often well under a pixel wide, so their sub-pixel coverage changes quickly with camera motion. The result is shimmer. Lipp notes that thin, glinty primitives are prone to aliasing and that flicker remains during camera motion.

Options:

- **MSAA.** UE defaults to 4x, and hair-mesh work uses 8x. Memory and bandwidth cost is significant. WebGPU render attachments support 4x. Compute rasterization does not get MSAA for free.
- **Coverage-to-alpha.** TressFX's per-strand coverage approach. It works with OIT, but flickers with motion.
- **Reconstruction filter** (Lipp). One sample per pixel, plus a center-hit buffer and a conservative buffer that records any intersected pixel. A bilateral 11x11 filter, with alpha from the ratio of center hits to conservative hits along a 0.5 px tangent strip. The authors report quality "comparable to MSAA 4-8 while maintaining performance close to MSAA 2." [author-reported]
- **Bundle LOD.** Merging strands into thick primitives as they approach sub-pixel width removes shimmer and cost. It changes appearance, so it needs the matching scattering model.
- **Stable rasterization.** UE's pixel-snapping option. Good for sparse hair, and it makes groups look thicker.
- **Temporal.** TAA or temporal filtering with motion vectors. Lipp lists temporal filtering as future work.

Recommendation: reconstruction filter as the primary AA, bundle LOD for far hair, optional temporal filtering, and coverage alpha as a fallback.

## 5. Geometry pipeline

### 5.1 Primitive options in WebGPU

- **Hardware line lists.** One pixel wide, aliased, with no width control. Secondary sources (PlayCanvas's wide-line docs, and a Khronos community thread on GL lines) say WebGL and WebGPU lines are one pixel wide ([PlayCanvas](https://developer.playcanvas.com/user-manual/graphics/wide-lines/)). I could not confirm this in the spec's primitive-state section, which was truncated in fetch. [unverified against spec] Use only for debugging.
- **Camera-facing ribbon quads.** Expand segments in the vertex shader from storage buffers. Core WebGPU allows storage buffers in the vertex stage, with a default of 8 per stage in the spec excerpt. Sub-pixel triangles can miss pixel centers and leave holes, so this path needs width clamping and coverage alpha. It works for near-field strands wider than a pixel.
- **Compute software rasterization.** Per-strand workgroups, DDA line rasterization, and visibility written with atomics. This is what Lipp and Veilguard do. It is efficient for sub-pixel strands. Lipp reports it is less efficient in the near field, where strands are wider than a pixel, and suggests a hybrid with hardware rasterization.
- **Mesh shaders.** Used by Yuksel and Bhokare. Not available in WebGPU. The feature index I retrieved lists no mesh-shader feature.
- **Geometry and tessellation shaders.** Not in WebGPU.

Recommendation: compute software rasterization as the primary path. The ribbon-quad hardware path is the near-field fallback.

### 5.2 Strand generation and interpolation

- Simulate guides, then generate render strands on the GPU every frame from the guides, so render strands are never stored. UE's interpolation stage does this. Veilguard decouples simulation from render tessellation. Lipp generates strands from a coarse hair mesh.
- Points per strand are a quality knob. Frostbite uses 25 for long hair and 3 to 5 for short. Veilguard raised its cap to 255. Lipp caps at 127 and uses power-of-two-plus-one snapping for LOD changes.
- Memory check: 100k strands at 25 points with vec4 f32 positions is 40 MB, inside the default 128 MiB storage binding. At 500k strands it is 200 MB and would exceed the default binding, so buffers must be chunked or a higher limit requested.

### 5.3 LOD

- UE and TressFX use strands, cards and meshes, with continuous LOD in TressFX 5.0.
- Huang et al. replace clusters with thick elliptical primitives and a matching scattering model.
- Lipp's scheme ([arXiv 2607.04230](https://arxiv.org/abs/2607.04230), Sec. 3):
  - Screen-space LOD: L = clamp(AABB size / vertical resolution x lambda, 0, 1), with a per-style sensitivity lambda.
  - Strand count: N_LOD = clamp(ceil(L (N + delta)), 1, N), with a per-bundle random offset delta to smooth transitions.
  - Control points: sqrt(L) scaling, snapped to power-of-two-plus-one values.
  - Depth correction for culled strands using a Beer-Lambert offset, so shadow maps stay consistent.
- In the paper's far-view test, frame time fell from 4.5 ms to 0.4 ms with filter and LOD on an RTX 5080 at 1080p.

Recommendation: adopt the structure of Lipp's LOD formulas, plus bundle primitives and cards for the far field.

## 6. Gaussian splats: research and the Spark.js verdict

### 6.1 Research

- **GaussianHair** ([arXiv 2402.10483](https://arxiv.org/abs/2402.10483), 2024) models each strand as a chain of cylindrical 3D Gaussians and supports relighting and animation. A 2026 follow-up says this produces millions of Gaussians with heavy redundancy, and proposes a hierarchical hair-card structure ([arXiv 2604.03716](https://arxiv.org/html/2604.03716v1)).
- **Gaussian Haircut** (ECCV 2024, [arXiv 2409.14778](https://arxiv.org/abs/2409.14778)) pairs strand polylines with strand-aligned Gaussians. It is a reconstruction method whose output is strands, so engines can use it directly.
- **HairGS** ([arXiv 2509.07774](https://arxiv.org/abs/2509.07774), BMVC 2025) reconstructs strands from multi-view images by Gaussian rasterization. It addresses reconstruction, not render-time LOD.
- **Gaussian Frosting** ([arXiv 2403.14554](https://arxiv.org/pdf/2403.14554), 2024) wraps a mesh in a shell of Gaussians with varying thickness to represent fuzzy materials. It renders in real time and can be animated with standard tools. A shell is a plausible far-field fallback for body fuzz, but no source I found tests that.
- **Inverse rendering with line primitives** ([arXiv 2609.00625](https://arxiv.org/pdf/2609.00625), 2026) argues that translucent Gaussians conflict with depth-tested rasterization, reflection modeling and simulation. It reconstructs fuzzy geometry from explicit line segments rasterized on a sub-pixel grid.
- I found no source describing a render-time handoff from strands to Gaussians.

Assessment: Gaussians are a reconstruction and representation tool. For real-time rendering they add sorting, translucency and memory cost. Their main advantage, view-consistent soft appearance for fuzz, is achievable with strand LOD bundles and shells.

### 6.2 Spark.js v2

- **What it is.** A three.js-integrated 3D Gaussian splatting renderer. The docs say it is "built for THREE.js and WebGL2," "targeting 98%+ WebGL2 support" ([docs overview](https://sparkjs.dev/docs/overview/); [README](https://github.com/sparkjsdev/spark)). Neither the docs nor the README mention a WebGPU backend. [inference from absence]
- **Procedural splats.** `PackedSplats` with `pushSplat` and `setSplat`, taking center, scales, quaternion, opacity and color. Each splat is encoded in 16 bytes. Built-in constructors cover grids, axes, text, images and sphere points. The sphere constructor warns that "splat count grows exponentially with depth" ([docs](https://sparkjs.dev/docs/procedural-splats/)).
- **Dyno.** Function blocks composed into computation graphs, converted to GLSL and run on the GPU. They can generate or modify splats, including colour edits, displacement and skeletal animation ([docs](https://sparkjs.dev/docs/overview/)).
- **LoD.** Spark 2.0 builds a tree of merged splats, cut by viewpoint, streamed in the RAD format with an LRU pager that caps GPU memory. A developer preview shipped in February 2026 and the full release on April 14, 2026, per third-party reports ([cgworld](https://cgworld.jp/flashnews/01-202603-Spark2.html); [radiancefields](https://radiancefields.com/platforms/spark)). Version 2.2.0 added experimental faster LoD traversal and Rust decoders ([radiancefields](https://radiancefields.com/spark-v2.2.0-adds-faster-lod-traversal-rust-decoders)). The README shows build 2.3.1. I could not confirm release dates against GitHub Releases.
- **Performance and limits.** No frame rates, splat count limits or hardware minimums appear in the docs. The sorting note says splat ordering "can lag behind" per-frame updates.

Verdict: do not adopt Spark for strands or for distant hair.

1. It is a second renderer on WebGL2 and three.js, against our WebGPU and TypeGPU stack. It cannot share our storage buffers, depth or shadow maps.
2. Its strengths, large streamed captures and scene LOD, are not our problem.
3. There are no measured numbers for dynamic hair at our counts.
4. Per-frame updates with sorted translucent splats are the opposite of the cost structure we need at 120 fps.

What is worth borrowing: the LoD-tree idea, and the awareness that sorting lags updates. If the far field still needs a splat-like primitive later, prototype a native compute-written point or quad pass with coverage. That is a separate experiment, not a Spark dependency. My confidence in rejecting Spark is high. My confidence in the native alternatives is medium, since there is no direct evidence for them in our setting.

## 7. WebGPU constraints

| Area | Constraint | Impact and workaround | Source |
|---|---|---|---|
| Shader stages | No geometry, tessellation or mesh shaders. The feature index lists none. | Compute software rasterization | [WebGPU features](https://gpuweb.github.io/gpuweb/#feature-index) |
| Lines | One-pixel lines; I could not confirm the spec's primitive section | Compute rasterization; ribbon quads for near field | [PlayCanvas](https://developer.playcanvas.com/user-manual/graphics/wide-lines/) [unverified against spec] |
| Atomics | WGSL atomics are 32-bit integer only (i32 and u32). No f32 atomics. | Compare-exchange loop over float bits, fixed-point u32 accumulation, or per-workgroup reduction. TypeGPU exposes atomic u32 and i32 types ([TypeGPU](https://docs.swmansion.com/TypeGPU/api/typegpu/data/functions/atomic)). | Secondary sources |
| 64-bit atomics | The feature index lists no 64-bit atomic feature. Lipp requires 64-bit atomicMin. | Two-pass visibility (depth, then payload), or a packed 32-bit experiment. The index lists `atomic-vec2u-min-max`; I did not verify its semantics or support. | [WebGPU features](https://gpuweb.github.io/gpuweb/#feature-index) |
| Subgroups | `subgroups` shipped in Chrome 134 (February 2025). `subgroup-size-control` had a Chrome intent to ship pending TAG review as of June 2026. Safari and Firefox status is unclear. | Optional. Do not depend on a particular subgroup size. | [Chrome 134](https://developer.chrome.com/blog/new-in-webgpu-134); [intent](https://groups.google.com/a/chromium.org/g/blink-dev/c/Lx06y9Rdzvs) |
| Feature naming | TypeGPU docs list `subgroup-operations`; the spec feature is `subgroups` | Check the string before use | [TypeGPU docs](https://docs.swmansion.com/TypeGPU/advanced/enabling-features/) vs. [Chrome 134](https://developer.chrome.com/blog/new-in-webgpu-134) [unverified] |
| Storage binding | Default `maxStorageBufferBindingSize` is 128 MiB; `maxBufferSize` is 256 MiB | Chunk buffers above that, or request higher limits if the adapter allows | [MDN limits](https://developer.mozilla.org/en-US/docs/Web/API/GPUSupportedLimits) |
| Compute limits | 256 invocations per workgroup; 256 in X, 256 in Y, 64 in Z; 16 KiB workgroup storage; 65535 workgroups per dimension | Use 32 or 64-thread strand workgroups. Use 2D dispatch for large strand counts. | [MDN limits](https://developer.mozilla.org/en-US/docs/Web/API/GPUSupportedLimits) |
| Vertex storage | 8 storage buffers per stage by default in core | Enough for vertex-pulled ribbon quads | [WebGPU limits](https://gpuweb.github.io/gpuweb/#limits) |
| Indirect work | Indirect dispatch and draw are part of the core API | Lipp uses indirect dispatch for LOD-driven strand counts. Not re-verified here. | [WebGPU spec](https://gpuweb.github.io/gpuweb/) [from knowledge] |
| Timestamp queries | Optional feature. Chrome quantizes to 100 microseconds. MDN lists limited availability. | Use for development profiling only | [Chrome docs](https://developer.chrome.com/docs/web-platform/webgpu/developer-features); [MDN](https://developer.mozilla.org/en-US/docs/Web/API/GPUQuerySet) |
| Float formats | `float32-blendable` and `float32-filterable` are optional features | Needed for WBOIT or float G-buffers | [WebGPU features](https://gpuweb.github.io/gpuweb/#feature-index) |
| f16 | `shader-f16` is optional | Not needed for the first version | [Chrome 120](https://developer.chrome.com/blog/new-in-webgpu-120) |

## 8. Recommended rendering architecture for 120 fps on WebGPU

### 8.1 Targets and honest assessment

- Primary target 1080p; 1440p as a stretch. 100k to 150k visible strands after culling. 120 fps is an 8.33 ms GPU frame. Give hair about 6.5 ms and keep about 1.8 ms for the rest of the engine. Baseline is a high-end desktop GPU.
- Lipp's native numbers on an RTX 5080 put compute strand rasterization at about 2 to 3 ms for 127k strands at 1080p, before the filter. Our two-pass visibility and WebGPU overhead will add cost. Reaching 120 fps on a mid-range card at 100k+ strands is unlikely. Reaching it on a high-end card is plausible only with LOD and amortized shadows. Measure this in week one.

### 8.2 Architecture choices

- **Representation.** Guide strands in storage buffers. Render strands generated on the GPU each frame, never stored. Bundles carry LOD state.
- **Visibility.** Compute software rasterizer at one sample per pixel. Default to exact two-pass visibility: pass A writes a u32 depth key with atomicMin, pass B writes payload for the winning strands. Test a packed single-pass variant as an experiment.
- **Anti-aliasing.** Lipp-style center and conservative buffers with a bilateral reconstruction filter. Bundle LOD for the far field. Optional temporal filtering.
- **Shadows.** One deep opacity map for the key light, opt-in per light, with a half-rate update option.
- **Shading.** Chiang-style lobes with precomputed azimuthal terms, a dual-scattering multiple-scattering term, Karis-style wrapped diffuse for short hair, and fake normals.
- **Transparency.** Hair depth buffer and compositing for transparent effects (the Veilguard approach). No hair-internal OIT by default.
- **Far field.** Strand LOD, then bundle primitives, then cards or shells for body fuzz.

### 8.3 Per-frame pass list and budgets

Estimates, not measurements. They are anchored on Lipp's native timings and UE and Frostbite guidance.

| # | Pass | What it does | Est. ms (1080p, ~100–130k strands) | Notes |
|---|---|---|---|---|
| P0 | Frame setup | Update camera, light and LOD uniforms; clear visibility buffers | 0.05–0.10 | Clears are cheap at 1080p |
| P1 | Guide simulation | Verlet or PBD on guides (~1–2k guides, 25 points), 2 to 3 substeps, collisions with proxy capsules | 0.5–0.9 | Sim cost scales with guide count, not render strand count |
| P2 | Culling and LOD | Per-bundle frustum and coverage tests; write strand and control-point counts; build indirect dispatch args | 0.1–0.2 | Also drives P3 and P4 |
| P3 | Key-light deep opacity map | Strand rasterization from the light into depth-layered opacity | 0.5–0.9 | Half-rate update is the main lever |
| P4a | Visibility pass A | Compute raster; atomicMin u32 depth key; center and conservative buffers | 1.2–2.0 | Dominant cost; contention in near field |
| P4b | Visibility pass B | Payload write by depth-equal winners: strand id, u, v, tangent | 0.6–1.0 | Doubles raster work versus 64-bit atomics |
| P5 | Reconstruction and AA | 11x11 bilateral reconstruction; coverage alpha | 0.3–0.5 | Compute, tiled |
| P6 | Hair shading | BSDF, dual scattering, shadow lookup, environment light | 0.8–1.2 | Scales with pixel count, so 1440p costs more here |
| P7 | Composite | Write hair colour, alpha and depth; blend with scene; transparent effects test against hair depth | 0.1–0.3 | |
| P8 | Optional fuzz | Shells or cards for distant body hair | 0–0.3 | Optional |

Total without P8: about 4.2 to 7.1 ms. With P8: up to about 7.4 ms. The high end exceeds the 6.5 ms hair ceiling, so the fallbacks below come into play.

Levers if over budget, in order:

1. Half-rate deep opacity map updates.
2. Stronger strand LOD thresholds for mid-distance bundles.
3. Lower control-point caps (for example 63 instead of 127).
4. Drop P8 fuzz.

### 8.4 Risks and mitigations

- **No 64-bit atomics.** The two-pass visibility doubles raster work. Mitigation: test packed single-pass encodings and measure.
- **Atomic contention in the near field.** Lipp reports this. Mitigation: per-workgroup reduction, or the hardware ribbon path for strands wider than one pixel.
- **Shimmer during motion.** Mitigation: reconstruction filter, optional temporal filtering with motion vectors.
- **Storage limits above about 500k strands.** Mitigation: chunked buffers.
- **Subgroup size varies across vendors.** Mitigation: fixed 32 or 64-thread workgroups with no subgroup assumptions. Subgroups stay optional.

### 8.5 Adopt, defer, reject

- **Adopt.** UE-style stage separation and per-light shadow opt-in. Lipp-style compute rasterization, reconstruction AA and LOD formulas. Chiang BSDF with dual scattering. Deep opacity maps. Veilguard-style hair depth compositing.
- **Defer.** Voxel transmittance (UE). TAA integration. WBOIT or PPLL, only if fuzz needs them. Neural hair denoising (2026 work I found but did not evaluate).
- **Reject.** Mesh shaders and tessellation (unavailable in WebGPU). The Spark.js renderer (WebGL2). Full Gaussian splat representation of strands. Deep shadow maps (not GPU-friendly). Per-strand ray-traced hair.

### 8.6 Next steps

1. Build a compute rasterizer spike with a synthetic 100k-strand groom at 1080p. Measure with timestamp queries where available, and with wall-clock time otherwise.
2. Compare two-pass visibility with a packed variant.
3. Add the key-light deep opacity map.
4. Add shading and the reconstruction filter.
5. Tune LOD thresholds against the budget.

## 9. Open questions and verification list

- Read the full Frostbite 2019 slides and the Taillandier and Valdes 2020 material. Both were unavailable here.
- Read Karis 2016 slide text. The PDF was binary here.
- Read Epic's 2020 blog directly (HTTP 403 here), and check current UE5 hair visibility internals in engine source.
- Confirm WebGPU's primitive state and line rasterization in the spec (section 10.3.2), and the semantics of `atomic-vec2u-min-max`.
- Confirm subgroup support in Safari and Firefox, and the correct feature string used by TypeGPU.
- Check Spark's release history on GitHub Releases, and whether a WebGPU backend is on its roadmap.
- Treat all Lipp, Veilguard and Spark performance numbers as vendor or author claims until we reproduce them.
- Check the current status of HairWorks and TressFX.
