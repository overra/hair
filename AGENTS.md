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

## Repository layout

- `docs/research/` — research reports produced by agents (atlas & parameters, rendering, simulation & grooming, TypeGPU reference).
