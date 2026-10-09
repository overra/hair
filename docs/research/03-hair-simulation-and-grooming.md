# Real-time strand hair simulation and grooming: research for a 120 fps WebGPU groom

## Summary (for the caller)

Recommended v1 architecture:

- **Strand solver:** XPBD (Macklin 2016) for stretch and shear. Bend and twist come from Kugelstadt-style rest-Darboux quaternion constraints, so the rest curl is stored per segment. Add a TressFX-style root-attached global shape term, and optionally a local-shape term for tight curls.
- **Simulated guides:** about 4,096 guides with 16 points each (24 to 32 for long hair), giving about 65k sim points. Use 2 substeps at 120 Hz with 4 Gauss-Seidel iterations per substep, colored even/odd. Run each workgroup of 16 strands by 16 points with the strand state in shared memory.
- **Render strands:** about 120k strands generated on the GPU by barycentric interpolation from the 3 nearest guides, with curl, frizz and clump offsets stored in each guide's local frame.
- **Hair-hair interaction:** one 64^3 fixed-point (i32) grid per frame, using McAdams-style FLIP transfer (xi = 0.95) and a density target from the rest pose. Friction comes from grid velocity blending.
- **Head collision:** a baked SDF 3D texture plus capsules for the neck and shoulders, with Coulomb friction.
- **Data model:** rest shape is authored and persistent. Sim state is derived and ephemeral. Cutting is a rest-shape resample plus a per-strand `activeCount`, with a render-time clamp used as preview during a drag.
- **Estimated GPU sim budget:** about 1.2 ms (range 0.9 to 1.8 ms) for this configuration. This is my estimate, not a measurement.

Largest uncertainties: the DFTL algorithm details (only the abstract was read), the Unreal and Unity solver internals (docs are high-level only), the grid cost under real WebGPU drivers, and the budget numbers, which need profiling.

Confidence tags used below: **[S]** primary text or fetched doc was read, **[A]** only an abstract or search snippet was seen, **[M]** my synthesis or estimate.

---

## 1. Strand dynamics

### 1.1 PBD and XPBD

PBD (Müller et al. 2007) solves position constraints with Gauss-Seidel using mass-weighted corrections. Its stiffness depends on iteration count and timestep. XPBD (Macklin, Müller, Chentanez, MIG 2016) fixes this with a compliance term and a total Lagrange multiplier. [S] [paper PDF](https://matthias-research.github.io/pages/publications/XPBD.pdf), DOI 10.1145/2994258.2994272

The per-constraint update, from Eqs. 17 and 18 of the paper, is the standard form below. The extracted PDF text was garbled, so I reconstructed it from the surrounding derivation and it should be checked against the PDF:

- α̃ = α / Δt²
- Δλ = (−C − α̃·λ) / (∇C·M⁻¹·∇Cᵀ + α̃)
- Δx = M⁻¹·∇Cᵀ·Δλ, and λ accumulates across iterations.

Relevant facts from the paper:

- With α = 0 it reduces to PBD with k = 1. Low iteration counts still produce artificial compliance, so iterations still matter for convergence.
- Per-iteration overhead was under 2% in the cloth benchmark (Table 1: 0.95 vs 0.97 ms at 20 iterations).
- The accumulated λ gives a constraint-force estimate, which is useful for friction and impulse readout.

### 1.2 Follow-the-leader family

**DFTL (Müller, Kim, Chentanez, VRIPHYS 2012).** The abstract claims inextensibility with one solver iteration per frame, real-time for thousands of strands. [A] [abstract](https://diglib.eg.org/items/11db9962-07b8-46a1-ab46-ecc9ee05086d). I could not read the algorithm section, so I cannot confirm its exact sweep. Secondary sources say it does not preserve shape. A 2015 CEIG paper extends it with shape preservation and couples it with a Lagrangian hair-hair model. [A] [Sánchez-Banderas et al. 2015](https://diglib.eg.org/handle/10.2312/ceig20151194)

**Han and Harada 2013 (tridiagonal).** Distance constraints along a chain form a symmetric, diagonally dominant tridiagonal system. It is solved directly per strand, matrix-free, with much less numerical damping than DFTL. The paper includes a GPU port. [A] [abstract](https://diglib.eg.org/items/1ceb4fdc-a053-4c17-b8f7-ebb83a5911bd)

**[M]** This is a good fit for one thread per strand with P ≤ 32, since the solve is O(P). It only covers distance constraints, so bend and twist need a separate iterative pass.

### 1.3 Cosserat rods in XPBD (Kugelstadt and Schömer, SCA 2016)

Each rod has positions plus one orientation quaternion per segment. Stretch and shear couple position and quaternion. Bend and twist compare neighbouring quaternions with the rest discrete Darboux vector Ω0, which is per-component stiffness. Quaternions are treated as 4-vectors and renormalized. [S] [paper PDF](https://animation.rwth-aachen.de/media/papers/2016-SCA-Cosserat-Rods.pdf)

Benchmarks from the paper, reported on CPU:

- 50-element rod, 10 iterations: 0.14 ms (ours) vs 1.65 ms (PBER) vs 0.16 ms (PBD).
- Slinky with 1000 elements, 50 iterations: 7 ms on one core of an i5, without collision.

The authors say stiffness still depends on timestep, iteration count and sampling density, and they point to projective dynamics as the fix. [S]

Rest curl lives in Ω0. A curled rest state is one quaternion per segment, which is why this model suits curly hair. Blender's XPBD curves solver uses the same lineage, with rest length L0 and rest orientation Ω0, and solves the constraints in a fixed Gauss-Seidel order. [S] [Blender docs](https://developer.blender.org/docs/features/nodes/xpbd_solver/xpbd_method/)

### 1.4 What shipping systems do

**AMD TressFX** [S for README, A for pass order]. The README says the 4.0 release added SDF collision, that 4.1 simplified local shape constraints and sped up velocity shock propagation, and that the simulation is compute-shader based. [repo](https://github.com/GPUOpen-Effects/TressFX) The 1.0 pass order from a 2013 slide deck is gravity, integrate, global shape, local shape, wind, edge length, collision. [slides](https://www.slideshare.net/slideshow/hair-intombraider-final/20208628)

- Global shape constraints: goal positions equal the initial positions, rigidly attached to the head.
- Local shape constraints: goals are in local frames, which preserves curls.
- An informal note on a DX12 compute demo reports about 0.7 ms for integrate, global and local together. [A, informal] [forum](https://forum.taichi.graphics/t/taichi-tressfx/1453)

**Unreal Engine groom physics** [S]. The solver options are Groom Rods, Groom Springs and Custom Solver. Iteration Count sets the XPBD iterations. Sub Steps are per frame, and solver calls run at 24 Hz. Strands Size sets the number of particles per simulation guide. The fetched docs do not name Cosserat, and "Groom Rods" is a name-only inference that it is rod-based. [docs](https://dev.epicgames.com/documentation/unreal-engine/enabling-physics-simulation-on-grooms-in-unreal-engine)

**Unity demoteam hair** [S for README only]. Constraints are boundary collision with friction, soft and hard particle distance, root distance, local bend limiter, local shape, global position and global rotation. Volume uses density and pressure from strand diameter and margin. There is hierarchical clustering and LOD by viewport coverage. The README does not cover solver order, guides, substeps or GPU structure, and it has no benchmarks. [README](https://github.com/Unity-Technologies/com.unity.demoteam.hair)

**Frostbite** [S, SIGGRAPH 2019 course slides]. Strands are point chains with constraints. Each point is integrated individually, then constraints and colliders are iterated. Strand-strand interaction runs on an Eulerian grid for friction, volume preservation and aerodynamics. [slides](https://www.advances.realtimerendering.com/s2019/hair_presentation_final.pdf)

**Blender curves** [S]. Rod stretch, bend-twist, contacts with friction angle, and damping as a velocity constraint. [Blender docs](https://developer.blender.org/docs/features/nodes/xpbd_solver/xpbd_method/)

### 1.5 Keeping curls and rest shape

| Mechanism | Where it runs | Cost | Notes |
|---|---|---|---|
| Rest Darboux and rest length per segment (Kugelstadt, Blender) | Per-iteration constraint | Cheap | Primary curl memory |
| Local shape goals in local frames (TressFX LSC, Han & Harada 2012) | Per-iteration constraint | Cheap | Stiffer curls; can look rubbery if overstiff [M] |
| Global shape or root cage (TressFX GSC, Unity global position/rotation) | Per-iteration constraint | Cheap | Limits drift from the scalp |
| Sag-free rest shape (Takahashi and Batty 2024) | Offline, at edit time | 11.2 s for 1.9k strands, 8-core CPU | Prevents sag at t=0 [S] [arXiv](https://arxiv.org/html/2409.12362v1) |
| Gravity preloading (Pixar, Liu SIGGRAPH) | Offline | Not measured | [A] Pixar TazTalk paper was not readable; the summary came from search |
| Plasticity (Houdini Vellum) | Per frame, cheap | Cheap | Threshold and rate; updates rest lengths [S] |

Takahashi and Batty's method is a one-time Gauss-Newton solve over rest length, curvature and twist. The paper does not claim real-time performance, and its forward simulation takes 3.3 s per frame without collision. [S]

### 1.6 Recommendation for strands

- Use XPBD for stretch and shear.
- Use Kugelstadt rest-Darboux for bend and twist. This is the main curl mechanism.
- Use a TressFX-style root cage for the global shape term.
- Add local-shape goals only if curls cannot hold their shape.
- Consider the Han & Harada tridiagonal solve for guides as an alternative to iterative stretch, and benchmark it.

---

## 2. Hair-hair interaction

**McAdams et al. 2009** [S]. This is a hybrid. A FLIP fluid handles bulk motion and volume, and Lagrangian self-collision handles contact. [PDF](https://math.ucdavis.edu/~jteran/papers/MWSST09.pdf)

- Segments are rasterized to the grid with weight w = max(0, r − d), where r ≈ 1.5 Δx.
- Pressure comes from a Poisson solve by PCG. Density control is a divergence source term toward a target density.
- Separation control is a face-level test that stops hair from sticking.
- FLIP blend ξ = 0.95.
- The paper's own timings are minutes per frame on CPU, so it is a method reference, not a cost reference.

**Petrovic et al. 2005** (cited in McAdams). Eulerian velocity and a level set for simple styles. Friction came from repeated averaging. [A, via McAdams text]

**Frostbite** [S]. A grid handles friction, volume preservation and aerodynamics between strands. The slides give no grid resolution.

**Unity** [S]. Pressure is computed from density, and the density target can be the initial pose's density.

**Neuralocks** [S]. Its training loss uses SPH density for self-collision. This is not a runtime path. [arXiv](https://arxiv.org/html/2507.05191v1)

**[M] Recommendation.** One grid of 64^3 per frame, with an ablation at 48^3 and 96^3. Splat segments with McAdams weights. Use FLIP xi = 0.95. Target density comes from the rest pose. Use Jacobi with Chebyshev acceleration, since Wang 2015 reports Jacobi as the best GPU pairing. [A] [DOI 10.1145/2816795.2818063](https://dl.acm.org/doi/10.1145/2816795.2818063) Friction is grid velocity blending. Skip separation control in v1.

---

## 3. Body collision, guides versus interpolated strands, and guide counts

### 3.1 Body collision

- **SDF texture.** Unity's mesh-to-SDF package produces a 3D SDF texture each frame for deforming meshes. [A] [mirror](https://source-hub.etos-pro.ru/Unity-Technologies/com.unity.demoteam.mesh-to-sdf) One arXiv paper uses a precomputed head SDF and a head velocity field to flag particles that would enter the head. [A] [arXiv 2412.17144](https://arxiv.org/pdf/2412.17144)
- **Friction.** Blender uses a static friction angle and a dynamic friction velocity constraint. [S]
- **[M]** Use a baked SDF (128^3, R16F, about 4 MB) for the head, plus capsules for neck and shoulders. Apply Coulomb friction on contact.

### 3.2 Guides versus interpolated strands

The Yuksel and Tariq SIGGRAPH 2010 course notes [S] give the key result. Multi-guide barycentric interpolation can push strands through the head, because averaging guide positions carries no collision guarantee. Single-guide interpolation stays closer to a guide. The fix is a pre-pass that finds penetrating interpolated strands and switches those vertices to single-guide interpolation. [PDF](https://developer.download.nvidia.com/presentations/2010/SIGGRAPH/HairCourse_SIGGRAPH2010.pdf)

Hsu et al. 2024 interpolate internal forces from simulated guides rather than positions. The abstract reports about 20% more cost than linear skinning and fewer kinks and zigzags. [S, abstract] [TOG 43(4)](https://par.nsf.gov/biblio/10541589-real-time-physically-guided-hair-interpolation)

Frostbite reports that in early experiments, simulating 1/10 of strands and interpolating gave a 5x speedup. [S]

Unreal's groom interpolation docs define "Hair to Guide Density" as the ratio of strands used as guides. They give no range. [S] [docs](https://dev.epicgames.com/documentation/unreal-engine/groom-interpolation-in-unreal-engine) The "5 to 10%" figure from a search summary is not supported by that page, so do not rely on it.

### 3.3 Guide counts from published data

- Frostbite: long hair, 10k strands with 240k points (24 per strand), 4.7 ms physics on PS4 at 900p (2019). Short hair, 15k strands with 75k points (5 per strand), 0.4 ms. [S]
- Han & Harada 2012: about 20k strands, 0.22M vertices (about 11 per strand), under 1 ms on the GPU of their time. [A]
- Neuralocks: trained on 3k strands, inferred on 120k strands. [S]
- Hsu et al.: 128 guides for 106k rendered strands. [A, from search summary only; unverified]

**[M] Recommendation.** 2k to 4k sim guides at 16 points (24 to 32 for long hair), with 100k to 150k render strands interpolated on the GPU.

---

## 4. GPU parallelization and WebGPU constraints

### 4.1 Mapping strands to threads

- **One thread per point, Jacobi.** The TressFX style: one dispatch per pass. Simple, but needs many dispatches and converges slowly.
- **One thread per strand, serial.** Han & Harada's tridiagonal solve. No intra-strand synchronization. Good for P ≤ 32.
- **One workgroup per strand group, with shared memory.** **[M]** My recommendation: 16 strands by 16 points = 256 threads per workgroup. Load the strand state into shared memory once per substep, run all K iterations with `workgroupBarrier()` between even and odd color passes, then write back. Shared memory is about 12 KB at 48 B per point, which fits the 16 KB default workgroup-storage limit.

### 4.2 Ordering

- Gauss-Seidel within a strand is done by even/odd coloring. Yuksel and Tariq use two index buffers: (0,1),(2,3),… then (0,0),(1,2),(3,4),… [S]
- Jacobi with Chebyshev acceleration is preferred for global solves like the grid pressure. [A]

### 4.3 Substeps versus iterations

XPBD decouples stiffness from iteration count. So iterations control convergence accuracy, and substeps control stability and collision response. **[M]** Default to 2 substeps with 4 iterations, then measure.

### 4.4 WebGPU limits

From the W3C limits table [S partial; the fetch summary restated values from my prompt, so verify at runtime with `adapter.limits`]:

- maxComputeInvocationsPerWorkgroup 256 (compat 128)
- maxComputeWorkgroupSizeX/Y 256, Z 64
- maxComputeWorkgroupStorageSize 16384 bytes
- maxStorageBufferBindingSize 128 MiB
- maxBufferSize 256 MiB
- maxComputeWorkgroupsPerDimension 65535
- maxStorageBuffersPerShaderStage 8

[spec](https://www.w3.org/TR/webgpu/#limits)

**Plan around the 8-storage-buffer limit.** Pack `restLen` into the `w` component of `restDarboux`, and pack `activeCount` with per-guide parameters.

### 4.5 Atomics

WGSL atomics are i32 and u32 only. There is no float atomicAdd. [A] [TypeGPU atomic docs](https://docs.swmansion.com/TypeGPU/api/typegpu/data/functions/atomic) A compare-and-swap loop over u32 bit patterns works but can be very slow under contention. One forum report shows a 52x slowdown. [A]

**[M] Use fixed-point i32 for grid splatting.** Choose the scale from the expected range. For example, with a scale of 1e4 and a velocity range of ±5 m/s, the per-cell sum stays well within i32 for a few hundred splats. Fixed-point addition is also order-independent, which helps determinism. [A] for determinism claim.

### 4.6 Subgroups

Chrome 134 shipped WebGPU subgroups (`subgroupAdd`, `subgroupShuffle`, `subgroupBallot`) behind the `subgroups` feature, with `enable subgroups;` in WGSL. Firefox and Safari status was not found. [A] [Chrome blog](https://developer.chrome.com/blog/new-in-webgpu-134)

### 4.7 Readbacks

Do not read GPU results back into JS in the frame loop. Keep `activeCount`, cut results and grid state GPU-side. Encode all passes in one command buffer per frame.

---

## 5. Cutting and shaving

Published sources on cutting are sparse. Summary:

- DeepSketchHair cuts strands with a user stroke, discarding the portion not connected to the root. [A] [arXiv 1908.07198](https://arxiv.org/pdf/1908.07198)
- Neural Strands trims explicit strand length and lets its neural renderer infer the look. [A] [arXiv 2207.14067](https://arxiv.org/pdf/2207.14067)
- The augmented mass-spring paper compares geometric trimming with simulation-based trimming, where the shape changes with length. [A] [arXiv 2412.17144](https://arxiv.org/pdf/2412.17144)
- Softimage's resample command evens out segments. [A]
- Blender deletes whole curves when any segment falls under the brush falloff. [A] [Blender 3.3 manual](https://docs.blender.org/manual/ar/3.3/sculpt_paint/curves_sculpting/tools/index.html)

I found no source on clipper-guard implementation in games. The design below is **[M]**.

### 5.1 Representation options

1. **Physically remove points.** Breaks fixed per-strand stride, so avoid it.
2. **Logical length clamp.** Keep points and clamp the rendered tip with a length parameter t_max. Cheap, good for preview, but the simulated strand is still the full length.
3. **Resample on commit (recommended).** Keep P slots per strand. Resample the cut rest curve by arc length to the new uniform segment length, recompute `restLen` and rest Darboux, and set `activeCount`.

Important: discrete rest curvatures are per-edge angles. Changing the segment length changes them, so recompute Ω0 from the resampled rest curve. Do not just truncate Ω0.

### 5.2 Clipper shell

**[M]** Model the guard as a distance shell from the scalp, using the head SDF or a per-groom distance field, rather than a plane. For each strand, walk from the root, find the first point outside the shell, interpolate the crossing, drop the rest, and resample. Strands already inside the shell are untouched.

### 5.3 Fades and regrowth

Use the root-to-tip parameter t to taper width and alpha near the cut tip. Regrowth can animate t_max or the resample length over time, with the same resample path.

---

## 6. Styling tools and plasticity

### 6.1 Reference DCC tools

**Blender curves sculpt** (3.3 manual) [A, version-specific]:

- Comb moves control points and preserves each segment's length.
- Puff aligns strands to the surface normal.
- Pinch pulls points toward the brush center.
- Smooth straightens strands individually, keeping root and tip fixed.
- Slide moves roots over the surface.
- Density adds or removes strands. It oversamples the surface and rejects candidates closer than a minimum distance to existing roots.

**Houdini** [S for Vellum plasticity; A for guide tools]. Vellum plasticity uses a threshold that decides whether the material returns to its original shape or adopts the new one. A rate controls how quickly it moves to the new rest lengths. It also works with Shape Match. [docs](https://www.sidefx.com/docs/houdini/vellum/plasticity.html) Houdini 22 adds Guide Reduce and Guide Deform. [A] [docs](https://www.sidefx.com/docs/houdini/nodes/lop/configureguidedeform.html)

### 6.2 Mapping tools to data

- **Comb.** Move rest positions in rest space, preserve segment length, recompute rest Darboux, and blend the sim toward the new rest.
- **Curl.** Scale the magnitude of rest Darboux toward a target radius, keeping the twist. Store a per-guide curl scalar.
- **Straighten.** Set the curvature scalar to zero.
- **Puff.** Adjust the root-frame direction toward the surface normal.
- **Plasticity.** **[M]** Where strain exceeds a threshold, update `rest ← slerp(rest, current, rate·dt)`, with a cap on total drift and the authored rest kept for reset. Houdini's model updates rest lengths and does not confirm rest bend. [S]
- **Gravity set.** Run gravity preloading as a background CPU job. Takahashi and Batty's 11.2 s for 1.9k strands is an upper bound for that setup. [S]
- **Gel and hold.** Raise plasticity rate or stiffness for the selected group. [M]
- **Part lines.** Discontinuity in root-frame direction along a brush stroke. [M]

### 6.3 Clumping and frizz

Choe and Ko's wisp model groups strands around a master strand, with a generalized-cylinder envelope. [A] [TVCG 2005](https://diglib.eg.org/items/629cbe0d-bc84-408e-b467-851d62ea41e8/full) Houdini clumping uses influence radius and clump attributes. A forum thread notes that default interpolation clumps by density, and that increasing the radius hides this but becomes unpredictable above about 0.2. [A] [forum](https://www.sidefx.com/forum/topic/86744/)

**[M]** Clump and frizz are render-time offsets in each guide's local frame, seeded per strand, so they cost nothing in the sim.

### 6.4 Braids

- Pixar's Cornrows paper describes each strand with a Lissajous-type cross-section, phase-shifted by strand index, with knot spacing set by frequency. [A] [paper](https://graphics.pixar.com/library/Cornrows/paper.pdf)
- A sinusoidal three-strand model uses a lateral sine and a double-frequency depth sine, with three phase-shifted strands. [A] [arXiv 2506.23072](https://arxiv.org/pdf/2506.23072v1)
- Unity has a patent for braids generated from a spine. [A]

**[M]** Generate three helices around a spine with phase offsets of 2π/3, and swap the outermost strand at each half-cycle to approximate over and under crossings. Use these curves as the rest shape for guides and set plasticity off, so the braid holds.

### 6.5 Ponytails, ties and buns

**[M]** A ponytail tie can be a set of attachment constraints from the ponytail root points to a tie point that follows the head, with a distance tolerance. Detaching disables the constraints. Unity's README lists "long-range attachments" only in its references, not among its constraints, so treat that feature as unconfirmed. A bun is a spiral rest shape with its root cluster attached to the head.

---

## 7. Procedural groom generation

### 7.1 Root placement

- Sik's thesis places roots from a 2D density texture. It reports up to 40x faster sampling than rejection sampling. [A] [thesis](https://cgg.mff.cuni.cz/~sik/master_thesis.pdf)
- Yuksel's sample elimination (CGF 2015) starts from a dense candidate pool, about 3 to 5 times the output size, and removes samples by weight. It gives no coverage guarantee. [A] [project page](https://cemyuksel.com/research/sampleelimination/)
- **[M]** For interactive density brushes, use dart throwing with a minimum distance, as Blender does.

### 7.2 Direction fields and whorls

- DreamWorks' volumetric grooming builds a flow field from scalp or guide tangents. Artists edit it with directional fields and noise, and streamlines from roots produce partings and cowlicks. [A] [SIGGRAPH 2013](https://research.dreamworks.com/wp-content/uploads/2018/07/SIG13_VdbGrooming-Edited.pdf)
- A scalp-manifold paper models whorls as singularities of a vector field. [A] [paper](https://vjs.ac.vn/index.php/jst/article/download/6016/6526/28574)
- DeepSketchHair traces strands from roots along an orientation grid and stops when direction change exceeds a threshold, set to 150° to keep strands continuous in noisy regions. [A]

**[M]** Build a tangent field on the scalp with a crown singularity and hairline and neck boundary conditions. Store it in a sparse grid. Trace streamlines with a loose angle threshold. Let guides override the field within a falloff radius. Fit rest Darboux to each traced guide, which gives the curl.

### 7.3 Render strands from guides

- K-nearest barycentric interpolation of 3 guides, with per-strand random weights fixed at groom time.
- Store offsets in each guide's local frame so the curl survives interpolation. This is the Hsu-style fix for linear-skinning artifacts. [S]
- Clumping and frizz as described in 6.3.

### 7.4 Strand parameterization

- Frostbite uses 24 points for long hair and 5 for short. [S]
- Unreal offers Strands Size as the sim particle count per guide. [S]
- Han & Harada use about 11 vertices per strand. [A]
- **[M]** Use 16 sim points per guide, 24 to 32 for long hair. Render at 16 to 32 vertices per strand by Catmull-Rom interpolation of sim points, which decouples render tessellation from sim cost.

---

## 8. Recommended simulation and grooming architecture for 120 fps on WebGPU

### 8.1 Reference configuration

| Item | Value | Note |
|---|---|---|
| Sim guides G | 4,096 | Ablate 2k to 8k |
| Points per guide P | 16 (24 to 32 long hair) | 15 segments at P = 16 |
| Sim points | 65,536 | |
| Render strands R | 100k to 150k | 16 to 32 verts each |
| Substeps | 2 at 120 Hz (dt = 1/240 s) | |
| Constraint iterations K | 4 per substep | Even/odd Gauss-Seidel |
| Hair grid | 64^3, once per frame | Ablate 48^3 and 96^3 |
| Head SDF | 128^3, R16F, about 4 MB | Or 96^3 |
| Sim budget | About 1.2 ms typical, hard cap 2.5 ms | Estimate |

Rough memory: sim points about 3 MB (three vec4 arrays), segment rest about 1.2 MB, grid about 5 to 6 MB, render interpolation data about 6 MB at 120k strands, SDF about 4 MB. Total under 25 MB.

### 8.2 Data layout

Use SoA, with point-major indexing `index = i * G + g`. Adjacent threads then read adjacent guides for the same point, which coalesces.

**Sim points** (index `i*G + g`):
- `pos: array<vec4<f32>>` (xyz, invMass)
- `prev: array<vec4<f32>>` (xyz, pad)
- `vel: array<vec4<f32>>` (xyz, pad)

**Segments** (index `j*G + g`, j in 0..P-2):
- `restDarboux: array<vec4<f32>>` (quaternion Ω0 in xyz, restLen in w). This packs two bindings into one.
- `quat: array<vec4<f32>>` (current segment orientation)
- Per-component stiffness packed into a small uniform or a per-guide parameter.

**Per guide** (index `g`):
- `rootXform` (position plus quaternion)
- `params` packed per guide: stiffness, damping, friction, plasticity threshold and rate, curl scalar, frizz, seed, mask
- `activeCount: array<u32>`

**Per render strand** (index `r`):
- `guideIdx: array<vec4<u32>>` (3 used plus pad)
- `weights: array<vec4<f32>>`
- `localOffset: array<vec4<f32>>` (offset in the guide's local frame)
- `seed: array<u32>`

**Grid** (cell index c):
- `gridVel: array<atomic<i32>>` (3 per cell, fixed-point)
- `gridMass: array<atomic<i32>>`
- `pressure` and `divergence` as f32 storage, double-buffered for Jacobi
- Head SDF as a sampled R16F 3D texture (not atomic), with a linear sampler.

**Uniforms:** head transform, capsule list, physics parameters, grid origin and cell size, fixed-point scale.

**Binding budget:** the strand-solve pass needs pos, prev, quat, restDarboux, activeCount, params and rootXform, which is 7 storage buffers. That leaves one slot, so pack carefully.

**Pool guides.** Pre-allocate Gmax with an alive flag, so density add and remove does not reallocate buffers.

### 8.3 Per-frame pass list

Estimates for a desktop GPU of RTX 4070 class. **[M] These are my estimates, not measurements.** Rasterization and shading of render strands are budgeted separately and excluded.

| # | Pass | Dispatch | Est. ms | Notes |
|---|---|---|---|---|
| 1 | Clear grid | 262k cells | 0.02 | i32 clear |
| 2 | Strand solve, substep 1 | 256 workgroups of 16×16 | 0.15 to 0.25 | Integrate, K=4 even/odd GS in shared memory, Darboux and shape terms, head SDF and capsule collision with friction, velocity recompute, damping. Applies grid velocity delta from last frame. |
| 3 | Strand solve, substep 2 | same | 0.15 to 0.25 | Same |
| 4 | Splat segments to grid | 61k segments, about 8 cells each | 0.15 to 0.3 | Fixed-point atomics for velocity and mass |
| 5 | Grid normalize and divergence | 262k cells | 0.02 | Density target from rest |
| 6 | Pressure solve | 16 iterations, warm-started | 0.2 to 0.4 | Jacobi with Chebyshev, or red-black |
| 7 | Grid to points gather | 65k points, 8 taps | 0.03 to 0.05 | FLIP blend xi = 0.95, friction blend; writes velocity delta for next frame |
| 8 | Plasticity and rest update | Strained guides only | 0.02 | Optional |
| 9 | Render interpolation and culling | 120k strands | 0.1 to 0.25 | Writes vertices or indirect draw args; LOD by coverage |

**Total:** about 1.2 ms (range 0.9 to 1.8 ms).

**Fallbacks if over budget:**
- Pressure above 0.4 ms: drop to 48^3, or run it every other frame.
- Strand solve above 0.3 ms per substep: reduce K to 3, or use the exact tridiagonal for stretch.
- Render interpolation above 0.25 ms: generate vertices in the vertex shader instead of writing buffers.

**Latency.** The grid velocity delta is applied one frame late. [M] Check visually at 120 Hz.

### 8.4 Editing-tool data model

Three layers:

1. **Rest shape (authored, persistent, saved with the groom).** Per-guide root frame, per-segment `restLen` and `restDarboux`, per-guide style parameters, and render-strand offsets. Edited by comb, curl, braid and similar tools.
2. **Sim state (derived, ephemeral).** Positions, previous positions, velocities, current segment quaternions, grid. Reset on demand. When rest changes, blend the sim toward the new rest over several frames rather than teleporting.
3. **Length and cut state.** `activeCount` per guide. During a drag, use a render-time t_max clamp as preview. On commit, resample the rest curve, recompute `restLen` and rest Darboux, and set `activeCount`.

**Undo.** Each operation logs the changed guide IDs with old and new rest data. These are small.

**Mapping of operations:**

| Operation | Changes |
|---|---|
| Comb | Rest positions, then rest Darboux, then blend |
| Cut or shave (commit) | Rest resample, `restLen`, Darboux, `activeCount` |
| Shave preview | Render-time t_max only |
| Curl | Rest Darboux magnitude, keeping twist |
| Plasticity (per frame) | Rest orientation toward current, within cap |
| Gravity set | Rest, computed in a background job |
| Density add or remove | Alive flag in the pool |
| Clump and frizz | Render-strand offsets only |
| Braid, bun, ponytail | Rest curves and attachment groups |

### 8.5 What not to adopt in v1

- Full Cosserat with torsion on every strand: possible, but validate the cost and the look first.
- DFTL as the main solver: no shape preservation without the CEIG extension, and I could not read its algorithm.
- McAdams-style PCG pressure: too costly at real-time rates. Use warm-started Jacobi.
- Per-frame gravity preloading: too expensive. Do it as a background job.
- Neural simulation (Neuralocks): needs training data and does not cover hand or object interaction. [S] Revisit later as an LOD path.
- Long-range attachments: unconfirmed in the sources I read.

---

## 9. Uncertainties and gaps

- **DFTL.** Only the abstract was read. The sweep details, and whether velocities are handled, are unverified.
- **Unreal solver.** Docs show Groom Rods, Groom Springs and Custom Solver. The "Cosserat" link and the solver internals are not documented in what I read.
- **Unity.** README only. Solver order, guides and GPU structure are not documented.
- **Frostbite grid.** Resolution, friction model and volume math are not in the slides. Frostbite's physics blog follow-ups were not found.
- **TressFX pass order.** From 2013 slides. Current code may differ, and the README does not give the order.
- **Pixar gravity preloading** (TazTalk 2019). The link redirected and was not read. The summary came from search.
- **Hsu et al. 2024 numbers** (128 guides, 106k strands). From search summary only.
- **Unreal "5 to 10%" guide ratio.** Not supported by the docs I read. Do not use it.
- **Tariq and Bavoil 2008** (166 strands, GPU frame rates). From search snippets of the slides; the 2010 course notes date from the same era. Integration method not confirmed.
- **Yuksel hair mesh simulation** (I3D 2016). Abstract metadata only; simulation method not read.
- **WebGPU limits.** Taken from the spec page, with values restated from my own prompt. Confirm with `adapter.limits` at runtime.
- **Subgroups.** Chrome 134 only. Firefox and Safari status not found.
- **Budgets.** All ms figures in section 8 are estimates. The Frostbite comparison (4.7 ms for 240k points on PS4, 2019) suggests roughly 0.3 to 0.6 ms for 240k points on a desktop card, which is consistent with the strand-solve estimate, but none of this has been profiled.

**Prototypes to run before committing:**
1. Grid pass at 64^3 with fixed-point atomics in WebGPU, measured on target hardware.
2. Curl retention at 120 Hz with 2 substeps and 4 iterations.
3. Visual effect of the one-frame grid latency.
4. JS dispatch overhead for about 15 passes per frame.

---

## 10. Sources

**Strand dynamics**
- Macklin, Müller, Chentanez, XPBD, MIG 2016. PDF: https://matthias-research.github.io/pages/publications/XPBD.pdf
- Müller, Kim, Chentanez, Fast Simulation of Inextensible Hair and Fur, VRIPHYS 2012: https://diglib.eg.org/items/11db9962-07b8-46a1-ab46-ecc9ee05086d
- Kugelstadt and Schömer, Position and Orientation Based Cosserat Rods, SCA 2016. PDF: https://animation.rwth-aachen.de/media/papers/2016-SCA-Cosserat-Rods.pdf
- Takahashi and Batty, Rest Shape Optimization for Sag-Free Discrete Elastic Rods, arXiv 2409.12362: https://arxiv.org/html/2409.12362v1
- Han and Harada, Real-time Hair Simulation with Efficient Hair Style Preservation, VRIPHYS 2012: https://diglib.eg.org/items/e2961634-79db-47fa-bb62-5379d8d355d0
- Han and Harada, Tridiagonal Matrix Formulation for Inextensible Hair Strand Simulation, VRIPHYS 2013: https://diglib.eg.org/items/1ceb4fdc-a053-4c17-b8f7-ebb83a5911bd
- Sánchez-Banderas et al., Real-time Inextensible Hair with Volume and Shape, CEIG 2015: https://diglib.eg.org/handle/10.2312/ceig20151194
- Blender XPBD solver docs: https://developer.blender.org/docs/features/nodes/xpbd_solver/xpbd_method/
- AMD TressFX repo: https://github.com/GPUOpen-Effects/TressFX
- TressFX 2013 slides: https://www.slideshare.net/slideshow/hair-intombraider-final/20208628
- TressFX informal timing note: https://forum.taichi.graphics/t/taichi-tressfx/1453
- Unreal, enabling physics on grooms: https://dev.epicgames.com/documentation/unreal-engine/enabling-physics-simulation-on-grooms-in-unreal-engine
- Unreal, groom interpolation: https://dev.epicgames.com/documentation/unreal-engine/groom-interpolation-in-unreal-engine
- Unity demoteam hair README: https://github.com/Unity-Technologies/com.unity.demoteam.hair
- Unity mesh-to-SDF (mirror): https://source-hub.etos-pro.ru/Unity-Technologies/com.unity.demoteam.mesh-to-sdf
- Frostbite hair, SIGGRAPH 2019 course: https://www.advances.realtimerendering.com/s2019/hair_presentation_final.pdf
- Frostbite blog Part 1: https://www.ea.com/frostbite/news/frostbite-hair-rendering-and-simulation
- Tariq and Bavoil 2008 slides: https://developer.download.nvidia.com/presentations/2008/SIGGRAPH/RealTimeHairSimulationAndRenderingOnGPU.pdf
- Yuksel and Tariq, SIGGRAPH 2010 course notes: https://developer.download.nvidia.com/presentations/2010/SIGGRAPH/HairCourse_SIGGRAPH2010.pdf
- Wu and Yuksel, Real-time hair mesh simulation, I3D 2016: https://dblp1.uni-trier.de/db/conf/si3d/si3d2016.html
- Yuksel et al., Real-time hair rendering with hair meshes, SIGGRAPH 2024: https://www.cemyuksel.com/research/hairmesh_rendering/Real-Time_Hair_Rendering_with_Hair_Meshes-SIGGRAPH24.pdf

**Hair-hair, collision and interpolation**
- McAdams, Selle, Ward, Sifakis, Teran, Detail preserving continuum simulation of straight hair, SIGGRAPH 2009: https://math.ucdavis.edu/~jteran/papers/MWSST09.pdf
- Wang, Chebyshev semi-iterative approach, TOG 2015: https://dl.acm.org/doi/10.1145/2816795.2818063
- Hsu et al., Real-time physically guided hair interpolation, TOG 2024: https://par.nsf.gov/biblio/10541589-real-time-physically-guided-hair-interpolation
- Lin et al., Neuralocks, CGF 2026 (arXiv 2507.05191): https://arxiv.org/html/2507.05191v1
- Augmented mass-spring hair, arXiv 2412.17144: https://arxiv.org/pdf/2412.17144
- Choe and Ko, statistical wisp model, TVCG 2005; Choe, Choi, Ko, Simulating complex hair with robust collision handling, SCA 2005: https://diglib.eg.org/items/629cbe0d-bc84-408e-b467-851d62ea41e8/full
- Unity Enemies and Lion coverage: https://www.cgchannel.com/2022/03/watch-enemies-unitys-gorgeous-new-tech-demo

**WebGPU**
- W3C WebGPU limits: https://www.w3.org/TR/webgpu/#limits
- TypeGPU atomic: https://docs.swmansion.com/TypeGPU/api/typegpu/data/functions/atomic
- Chrome WebGPU 134 (subgroups): https://developer.chrome.com/blog/new-in-webgpu-134

**Cutting, styling, procedural**
- DeepSketchHair, arXiv 1908.07198: https://arxiv.org/pdf/1908.07198
- Neural Strands, arXiv 2207.14067: https://arxiv.org/pdf/2207.14067
- Blender curves sculpting (3.3 manual): https://docs.blender.org/manual/ar/3.3/sculpt_paint/curves_sculpting/tools/index.html
- Houdini Vellum plasticity: https://www.sidefx.com/docs/houdini/vellum/plasticity.html
- Houdini Configure Guide Deform: https://www.sidefx.com/docs/houdini/nodes/lop/configureguidedeform.html
- Pixar, Holding the shape in hair simulation, TazTalk 2019 (not read): https://graphics.pixar.com/library/TazTalk2019/paper.pdf
- Liu, gravity preloading, SIGGRAPH: https://history.siggraph.org/?p=126861
- Houdini clumping forum thread: https://www.sidefx.com/forum/topic/86744/
- Blender geometry nodes clumps: https://digitalproduction.com/2021/12/13/prozedurales-haar-blender/
- Pixar Cornrows: https://graphics.pixar.com/library/Cornrows/paper.pdf
- Sinusoidal three-strand braid, arXiv 2506.23072: https://arxiv.org/pdf/2506.23072v1
- Sik, master's thesis on root placement: https://cgg.mff.cuni.cz/~sik/master_thesis.pdf
- Yuksel, sample elimination for Poisson disk sets, CGF 2015: https://cemyuksel.com/research/sampleelimination/
- DreamWorks, volumetric grooming, SIGGRAPH 2013: https://research.dreamworks.com/wp-content/uploads/2018/07/SIG13_VdbGrooming-Edited.pdf
- Scalp-manifold whorls paper: https://vjs.ac.vn/index.php/jst/article/download/6016/6526/28574