# Contact, mechanics and optics reading list (finger interaction)

Provided by the project owner. Summary of the key points, kept verbatim where it matters.

For a realistic character that can run fingers through its hair, the most important topic is **contact**:
making strands separate around fingers, slide with friction, preserve their curl, and avoid passing through
each other. The literature splits into four connected problems: strand mechanics, hair–hand interaction,
different hair geometries, and light scattering.

## 1. Most directly useful

- **Interactive Hair Simulation on the GPU Using ADMM** — Gilles Daviet, SIGGRAPH 2023.
  GPU solver for Discrete Elastic Rods with Coulomb friction; real-time for several thousand contacting rods;
  validated against cantilever, bend–twist and stick–slip experiments; has an interactive grooming application.
  Caveat: "several thousand rods" ≠ every visible hair + full character + detailed hands in one frame budget.
  https://research.nvidia.com/publication/2023-08_interactive-hair-simulation-gpu-using-admm
- **Stable Cosserat Rods** — Hsu, Wang, Wu, Yuksel, SIGGRAPH 2025.
  Split position/rotation optimization with a closed-form orientation update; stable at high stiffness and
  large time steps; parallel. Project page reports 1,464,704 hair vertices in 7 ms/frame on an RTX 3090
  (deformation only — evaluate contact cost separately).
  https://graphics.cs.utah.edu/research/projects/stable-cosserat-rods/
- **Discrete Elastic Rods** — Bergou et al., SIGGRAPH 2008. Centerline + material frames, bending, twisting,
  inextensibility. Foundation for the ADMM work. https://www.cs.columbia.edu/cg/pdfs/143-rods.pdf

## 2. Hair types: geometry and mechanics, not shader presets

- **Super-Helices** — Bertails et al., SIGGRAPH 2006. Piecewise helical inextensible Kirchhoff rods; validated
  against real hair; encodes preferred rest shape; curly hair needs bend–twist behavior, not positional springs.
  https://dl.acm.org/doi/10.1145/1141911.1142012
- **The physics of curly hair** — Physical Review Letters 2014 (MIT). Curvature, length, weight and stiffness
  control transitions between planar hooks, localized helices, and full helices; root carries more load than
  tip. Use as validation: after a finger stretches a curl, does it return to a plausible gravity-loaded shape?
  https://meche.mit.edu/news-media/physics-curly-hair
- **Curly-Cue: Geometric Methods for Highly Coiled Hair** — 2024. High-frequency helices need different visual
  treatment from low-frequency curves. https://dl.acm.org/doi/10.1145/3680528.3687641
- **Curly Hair Simulation using Curly Finite Elements** — Pei et al., 2026 preprint. Rod base configuration +
  analytic high-frequency waves/helices; coarse collision proxies for the base with analytic treatment of detail;
  guide interpolation that preserves fine structure. Very close to this project's macro-curl (simulated) /
  micro-coil (rendered) split. https://arxiv.org/abs/2607.22103

## 3. Strings, ropes, knots

- **C-IPC (Codimensional Incremental Potential Contact)** — unified frictional, thickness-aware,
  intersection-free contact for rods, shells, volumes; braids and knot tests. Robustness / offline ground truth.
  https://ipc-sim.github.io/C-IPC/file/paper_small.pdf
- **A Fully Implicit Method for Robust Frictional Contact Handling in Elastic Rods** — implicit penalty contact
  for rod assemblies, knots and hair. https://arxiv.org/html/2205.10309v3
- **A Hybrid Iterative Solver for Robustly Capturing Coulomb Friction in Hair** — 2011. Non-penetration answers
  "can strands overlap?"; friction answers "will they slide?" — finger combing needs both.
  https://gdaviet.fr/files/hairContactSiggraphAsia2011.pdf

## 4. Appearance

- **Light Scattering from Human Hair Fibers** — Marschner et al., SIGGRAPH 2003 (R / TT / TRT).
  https://graphics.stanford.edu/papers/hair/hair-sg03final.pdf
- **A Practical and Controllable Hair and Fur Model for Production Path Tracing** — Chiang et al., 2016.
  Energy-conserving, near-field, physically meaningful controls; reference for what a real-time approximation
  should preserve (PBRT documents an implementation).
  https://media.disneyanimation.com/uploads/production/publication_asset/152/asset/eurographics2016Fur_Smaller.pdf

## 5. Proposed R&D architecture (owner's synthesis)

- Separate visible strands from mechanically resolved strands, but let interaction change the mapping:
  sparse rod sim away from the hand; more detailed strand/contact resolution near fingers; a render-strand
  mapping that respects which side of a finger a strand is on; controlled transition back after the hand leaves.
  Key hypothesis to test: does interpolation create visible hair that crosses a finger even when guides don't?
- Treat friction and non-intersection as first-class. Test scenarios: sliding along a finger; catching then
  releasing (stick–slip); a lock dividing between fingers; curls stretched and recovering; tangles persisting.
- Parameterize hair types continuously: rest curvature and twist, bending and torsional stiffness, length and
  mass distribution, thickness, contact/friction, optical absorption and roughness — mechanics/geometry and
  optics remain independently controllable.

## Reading order

1. ADMM (Daviet 2023) 2. DER 3. Stable Cosserat Rods 4. Super-Helices 5. C-IPC
6. Curly-Cue + Curly Finite Elements 7. Marschner + Chiang

Central question: *can the reduced representation preserve strand separation, curl, and friction specifically
where the fingers interact?*
