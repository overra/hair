# Scientific Literature for Real-Time, Finger-Interactive Human Hair

## Direct answer

Yes. There is a deep literature spanning **hair-fiber biomechanics, elastic rods, frictional contact, entanglement and combing, dense-hair simulation, reduced-order real-time methods, and physically based hair optics**. No single paper provides a production-ready “run fingers through any hairstyle at 60 FPS” solution; the strongest R&D path combines strand-level rod mechanics, a scalable collective-contact approximation, locally refined hand contact, and a strand-aware optical model.[^1][^2][^3]

The closest paper to the exact interaction is the 2025 **Augmented Mass-Spring Model for Real-Time Dense Hair Simulation**, which explicitly demonstrates hair–hand interaction with 15,000 strands and reports other dense-hair cases above real-time rates. For foundational hand/object contact, **Adaptive Skinning for Interactive Hair-Solid Simulation** and the older haptic-hair literature are still unusually relevant.[^4][^5][^6][^1]

## Problem decomposition

A realistic system has five coupled but separable research problems:

| Layer | What must be modeled | Most useful literature |
|---|---|---|
| Single fiber | Rest curvature, torsion, inextensibility, anisotropic bending, damping | Super-Helices; Discrete Elastic Rods; hair-fiber biomechanics[^7][^8][^9] |
| Hair assembly | Volume preservation, strand–strand collision, friction, clumping and coherence | Continuum/FLIP hair; Coulomb-friction solver; hybrid DER–MPM[^10][^11][^2] |
| Hand interaction | Fast strand–solid collision, frictional sliding, trapping between fingers, local loss of guide coherence | Adaptive Skinning; AMS; haptic hairstyling[^1][^6][^5] |
| Appearance | Fiber scattering, multiple scattering, self-shadowing, transparency and antialiasing | Marschner; d’Eon; Dual Scattering; Deep Opacity Maps[^12][^13][^14][^15] |
| Runtime scaling | Guide strands, physically guided interpolation, contact correction, LOD | Reduced Model; Neural Interpolation; Physically Guided Interpolation; Hair LOD[^16][^17][^18][^19] |

The central difficulty is that **guide-strand coherence fails precisely where fingers divide, lift, squeeze, or comb the groom**. A system can interpolate most distant hair cheaply, but contact regions need adaptive refinement or full-strand correction because nearby hairs can end up on opposite sides of a finger.[^1]

## Highest-priority papers

### Augmented Mass-Spring Model for Real-Time Dense Hair Simulation

Herrera et al., ICCV 2025. This is the first paper to evaluate for a new desktop-GPU prototype because it combines edge, bend, and torsional behavior with a stabilizing ghost rest shape and a hybrid Eulerian/Lagrangian interaction stage. Its demonstrations include 14,718 strands under wind at 67 FPS, 7,528 strands in face contact at 156 FPS, 10,298 strands interacting with complex objects at 114 FPS, and a separate hair–hand demonstration using 15,000 strands.[^6]

**R&D value:** It is unusually close to the requested operating point: dense, strand-level, contact-rich and real time. Investigate whether its reported hand test includes persistent friction, finger separation and true topology-changing partition of locks, rather than primarily nonpenetration.

### Adaptive Skinning for Interactive Hair-Solid Simulation

Chai, Zheng and Zhou. The paper starts from the observation that ordinary guide-hair reduction breaks under solid contact because neighboring strands cease moving coherently. It adaptively changes the guide relationships and applies two-way collision correction; the reported system handles more than 150,000 rendered strands interacting with complex solids while simulating 400 guides.[^1]

**R&D value:** This is probably the most directly transferable architectural idea for fingers. Treat each finger as a moving collider, detect follower strands whose interpolation would cross or penetrate it, then change their guide set or promote them into a locally corrected simulation group.

### Towards Realtime: A Hybrid Physics-Based Method for Hair Animation on GPU

Li et al., 2023. This system uses semi-implicit Discrete Elastic Rods for individual strands and explicit Material Point Method for strand–strand interaction and volume. It reports up to 260 FPS with more than 2,000 simulated strands on an RTX 3080.[^2]

**R&D value:** It cleanly separates accurate fiber mechanics from collective interaction, which maps well to a GPU compute design. A hand-contact pass can sit between or after the DER and MPM stages, while the background grid transmits displacement into the surrounding hair volume.

### Discrete Elastic Rods

Bergou et al., SIGGRAPH 2008. DER supplies a discrete geometric model for thin rods with arbitrary cross sections and undeformed configurations, including bending–twisting coupling and efficient handling of stiff stretching and twisting modes. The work was validated with buckling, stability, coupled-mode and qualitative knot-tying experiments.[^8]

**R&D value:** This is the most important mathematical foundation if the simulator must distinguish straight, wavy, curly and highly coiled fibers through rest curvature, rest twist and anisotropic cross-sectional stiffness. It is more complex than position-only PBD, but it gives principled parameters and a path to knot/contact literature.

### Super-Helices for Predicting the Dynamics of Natural Hair

Bertails et al., SIGGRAPH 2006. The model applies Kirchhoff rod equations to hair and represents each strand as a piecewise helical rod, explicitly accounting for nonlinear bending and twisting. The authors validated it against real smooth and wavy hair-clump experiments and demonstrated straight, wavy and curly types.[^7][^20]

**R&D value:** Read this before designing a curl model. It explains why curl is not merely a visual displacement texture: intrinsic curvature and torsion change the strand’s force response, motion and equilibrium shape.

### A Hybrid Iterative Solver for Coulomb Friction in Hair Dynamics

Daviet, Bertails-Descoubes and Boissieux, SIGGRAPH Asia 2011. The solver targets tightly packed elastic fibers, resolving many exact Coulomb-friction contacts and reproducing collective effects such as transient coherent motion and stick–slip behavior. Reported examples contain up to roughly 2,000 fibers and tens of thousands of contacts.[^21][^11]

**R&D value:** Finger-combing will look wrong if contact is only repulsive. This paper explains the missing phenomena—static sticking, sliding thresholds and abrupt release—that create drag, lock formation and lock separation.

### Light Scattering from Human Hair Fibers

Marschner et al., SIGGRAPH 2003. This foundational optical model replaces a generic anisotropic highlight with physically motivated surface reflection and transmission/internal-reflection paths through the fiber. It is the basis of the familiar R, TT and TRT lobe decomposition used by later production and real-time models.[^12][^22]

**R&D value:** Use it as the appearance ground truth and parameter vocabulary. A simplified real-time BCSDF can preserve the characteristic primary and secondary highlights without reproducing the full offline derivation.

### Dual Scattering Approximation for Fast Multiple Scattering in Hair

Zinke et al., SIGGRAPH 2008. Dual scattering divides multiple-fiber scattering into local and global components, reaching real-time GPU rates while retaining the broad brightness, color and softness missing from single-fiber shading. Multiple scattering is especially important for light-colored hair.[^14][^23]

**R&D value:** Marschner-like single-fiber shading alone often produces dark, hard-looking blond or gray hair. Dual scattering or a modern descendant should be in the 60-FPS rendering plan, not treated as optional polish.

## Hair type and material science

### Systems Approach to Human Hair Fibers

This 2019 review links geometry, viscoelasticity, tensile behavior, bending stiffness, torsion and friction. It emphasizes that an elliptical fiber responds differently from a circular one and that curvature cannot be divorced from bending and torsional properties.[^9]

**R&D value:** Build hair presets from coupled physical dimensions rather than a single “curliness” slider. At minimum, parameterize cross-sectional axes, rest curvature, rest torsion, bend stiffness about two axes, twist stiffness, damping and friction.

### Worldwide Diversity of Hair Curliness

Loussouarn et al., 2007. The study measured curve diameter, curl index, wave count and twist count in 2,449 subjects from 22 countries and produced eight shape groups without relying on ethnicity.[^24][^25]

**R&D value:** This provides a defensible morphology space for authoring and test coverage. Prefer continuous geometric descriptors, with the eight groups used as validation bins, instead of hard-coding racially labeled material types.

### Shape Variability and Classification of Human Hair

De la Mettrie et al., 2007. A related worldwide study used curve diameter, curl index and wave count to classify hair geometry into eight categories from samples covering 1,442 subjects in 18 countries.[^26]

**R&D value:** The descriptors map naturally to procedural strand generation: low-frequency curvature, curl diameter or wavelength, and local torsion/kinks.

### Quantifying Whole Human Hair Scalp Fibres of Varying Curl

This 2024 study quantifies changing major and minor diameters and ellipticity along whole fibers. It reports more circular-to-oval sections for straighter Type II samples and flatter, more variable sections for curlier Type VI samples, while emphasizing that cross section affects bending, twisting, extension and fracture.[^27]

**R&D value:** A single circular rod is a useful performance approximation, but an ellipse with a transported material frame better explains preferred bend direction and twist–curl coupling. For hero hair, store two bend stiffnesses; for distant hair, collapse to an isotropic average.

### Hair Friction and Tribology

A 2025 perspective reviews friction, lubrication and wear of human hair. It notes directional friction from overlapping cuticle edges, increased friction as the protective 18-MEA surface layer is lost, and effects from humidity, cleanliness, damage and conditioners.[^28]

**R&D value:** Consider separate friction presets for healthy/conditioned, dry/damaged and wet hair. Direction-dependent strand friction is scientifically justified, although an isotropic coefficient is a reasonable first real-time approximation.

## Combing, tangles and touch

### Combing a Double Helix

Plumb-Reyes, Charles and Mahadevan, Soft Matter 2022. Experiments and simulation reduce a curl tangle to two homochiral entwined helices and study a stiff tine moving through them. The work connects combing force to the amount and spatial extent of topological link density and supports short strokes beginning near the free ends as the effective detangling strategy.[^29][^30]

**R&D value:** This is the closest clean physics model of fingers or comb teeth moving through curled hair. It suggests measuring and propagating local entanglement rather than treating every collision as independent.

### Measurement of Combing Forces

Kamath and Weigmann, 1986. Their double-comb experiments distinguish midlength force from end-peak force and conclude that fiber–fiber interactions dominate over direct comb–hair friction, while end peaks arise from entangled ends. Wetting drastically changes the force profile because liquid films add surface-tension effects.[^31][^32]

**R&D value:** A hand should not merely experience or create local contact drag. Its motion must transfer through a network of neighboring fibers and may gather entanglements toward the ends.

### The Biomechanics of Splitting Hairs

This 2024 mechanics paper explains that tangles force fibers into very high local curvature and generate complex tensile, compressive and shear stresses; combing transports these stressed configurations along the shaft until they resolve.[^33]

**R&D value:** Even if breakage is out of scope, local curvature is a useful threshold for visual strain, snagging and solver refinement. Extreme bends around finger edges should trigger smaller substeps or local contact refinement.

### Virtual Hair Handle and Haptic Hairstyling

Bonanni and Kmoch, 2008. This work adapts Super-Helices to real-time haptic interaction, modeling the forces produced when touching and styling virtual hair.[^5]

**R&D value:** The paper is old and not a modern dense GPU method, but it directly addresses hair contact as a two-way interaction rather than one-sided collision. It is useful if fingers must respond physically, if a controller needs haptic output, or if believable hand animation should be driven by estimated drag.

## Simulation and scaling

### Detail Preserving Continuum Simulation of Straight Hair

McAdams et al., 2009. This hybrid Eulerian/Lagrangian method uses a FLIP-like continuum solve for bulk interaction and volume preservation, plus detailed Lagrangian self-collision for fine contacts.[^10][^34]

**R&D value:** It supplies the conceptual model for a scalable “hair volume” that transmits the effect of a hand beyond the strands it directly touches. It is strongest for straight hair; highly coiled styles need intrinsic rod geometry and stronger friction/contact treatment.

### A Mass-Spring Model for Hair Simulation

Selle, Lentine and Fedkiw, SIGGRAPH 2008. The approach targets full hair geometry and includes a computationally inexpensive torsion model, semi-implicit springs, object collision, self-collision, sticking and clumping.[^35][^36]

**R&D value:** This is a pragmatic alternative when DER complexity is too high. Compare it directly with AMS, which updates the mass–spring family with stronger stability and real-time dense interaction.[^6]

### A Reduced Model for Interactive Hairs

Chai, Zheng and Zhou, SIGGRAPH 2014. Offline full simulations are clustered by local motion similarity to select guide strands and fit interpolation weights. At runtime, guides are simulated, full hair is reconstructed and a parallel position-based correction resolves detailed collisions.[^37][^16]

**R&D value:** This is a good baseline architecture for a fixed library of groom assets and animation envelopes. Its dependency on precomputed motion makes it less robust to arbitrary finger paths unless paired with adaptive contact or local strand promotion.

### Real-Time Hair Simulation With Neural Interpolation

Lyu et al., 2022. This method uses a convolutional network for dynamic guide interpolation and a second network for fine displacement, producing interactive results across multiple hairstyles.[^17]

**R&D value:** Neural interpolation can restore secondary detail cheaply, but it should not be trusted as the sole contact mechanism. Enforce hand nonpenetration and friction physically, then use the network only outside contact or as a prediction corrected by constraints.

### Real-Time Physically Guided Hair Interpolation

Hsu et al., SIGGRAPH 2024. Rather than interpolating positions, the method interpolates internal forces from guide hairs and solves for follower shapes, reporting visually plausible results at about 20% additional computation over conventional linear interpolation.[^18]

**R&D value:** This is likely preferable to pure geometric interpolation for finger interaction because followers preserve a more plausible mechanical relationship to their guides. It still needs explicit contact correction where a hand breaks local coherence.

### Quaffure

Quaffure predicts quasi-static drape from hairstyle, body shape and pose in a few milliseconds, using self-supervised learning rather than stored simulation trajectories.[^38]

**R&D value:** It can provide rapid equilibrium targets after slow body or head pose changes, but “quasi-static” means it is not a replacement for dynamic finger–hair contact. It is better used for initialization, background LOD or slowly varying pose response.

## Appearance and rendering

### An Energy-Conserving Hair Reflectance Model

d’Eon et al., 2011. This model extends dielectric-cylinder hair scattering with energy conservation, multiple internal-reflection orders, azimuthal roughness, caustics and more accurate color prediction.[^13]

**R&D value:** Use this as a more physically disciplined reference than the original Marschner model when generating LUTs or validating shader energy. A real-time implementation can preintegrate expensive terms.

### Deep Opacity Maps

Yuksel and Keyser. Deep opacity maps place a small set of opacity layers adaptively behind the first hair depth, enabling dynamic semitransparent hair shadows with far fewer layers than uniform opacity maps.[^15]

**R&D value:** This remains a practical shadow/transmittance structure and is used with dual-scattering implementations. It is especially relevant when finger movement continuously deforms the shadowing volume.

### Strand-Based Hair Rendering in Frostbite

The Frostbite implementation combines strand rendering, dual scattering and four-layer deep opacity maps, emphasizing that multiple scattering is crucial for color saturation and the depth/volume of light hair.[^39]

**R&D value:** This is an excellent production-oriented bridge from papers to a modern real-time engine. It shows where physically based terms can be approximated without abandoning their perceptual role.

### Real-Time Level-of-Detail Strand-Based Rendering

Huang et al. replace projected clusters with thick strands and use an aggregated BCSDF that approximates both single and multiple scattering. The paper reports negligible overhead close up, about 2× speedup at medium distance and up to 13× at far distance.[^40][^19]

**R&D value:** LOD should depend on projected width and distance from interaction. Keep actual thin strands near the fingers and camera while aggregating untouched distant regions.

### Transparency and Antialiasing

Hair strands are often subpixel, partially transparent geometry, so ordinary opaque rasterization aliases and loses density. Real-time hybrid work uses analytic pixel coverage and per-pixel linked lists, while newer work investigates stochastic or neural reconstruction when full order-independent transparency is too expensive.[^41][^42]

**R&D value:** Contact quality can be physically correct yet visually fail if strands pop, shimmer or change density as fingers move. Temporal stability of coverage, tangent and transmittance belongs in the core design.

## Strings, rods and knots

### STRANDS: Interactive Simulation of Thin Solids Using Cosserat Models

Pai, 2002. STRANDS treats hair, ropes, sutures, catheters and vegetation as thin elastic solids whose centerlines alone are insufficient because twist matters.[^43]

**R&D value:** This is a useful conceptual bridge between hair simulation and the broader Cosserat-rod literature. It supports designing one reusable rod kernel for hair, strings, wires and other slender objects.

### Implicit Contact Model for Discrete Elastic Rods in Knot Tying

Choi et al., 2021. The paper introduces a differentiable segment–segment contact potential whose force and Jacobian can be integrated implicitly, allowing larger timesteps in complex knot contact.[^44][^45]

**R&D value:** It is not a dense-hair algorithm, but its contact formulation is valuable for local “hero” strands, braids, locks and severe tangles where explicit penalty forces become unstable.

### A Fully Implicit Method for Frictional Contact in Elastic Rods

Tong et al., 2023. This DER-based work targets robust sticking and sliding among rod-like structures including knots and hair, using implicit frictional contact and validating knot behavior against theory.[^46]

**R&D value:** It supplies a high-quality offline or local-reference solver against which a faster real-time approximation can be validated.

### Anisotropic Elastoplasticity for Cloth, Knit and Hair Frictional Contact

Jiang, Gast and Teran, 2017. This hybrid Lagrangian/Eulerian MPM framework models anisotropic fiber contact and is demonstrated on knit, hair and other fibrous materials.[^47]

**R&D value:** It is useful when moving beyond independent strand contacts toward a continuum model that can preserve directional structure, friction and densely packed behavior.

### Adaptive Contact Model for Robust Knot Simulation

Spillmann and Teschner, 2008. The method adaptively introduces rod control points around complex contacts and uses nonlinear energy minimization to improve robustness.[^48]

**R&D value:** The same principle suggests contact-driven strand refinement around finger gaps, nails and pinches while leaving free hair coarse.

## Recommended 60-FPS architecture

For a desktop GPU, the most defensible design is a **hybrid adaptive strand system**, not all-DER and not pure guide interpolation:

1. Represent each simulated guide as 12–32 particles or rod vertices with rest curvature and torsion, inextensibility, anisotropic bending where needed, damping and root attachment. DER gives the cleanest model; AMS or compliant PBD/XPBD is easier to parallelize and tune.[^8][^6]
2. Simulate several thousand active guides globally. Generate the much denser visible groom through physically guided interpolation rather than simple position interpolation.[^2][^18]
3. Maintain a low-resolution moving grid or density field for volume preservation and long-range force transfer. This avoids quadratic all-pairs collision while retaining collective motion.[^10][^2]
4. Represent palms and fingers with animated capsules or swept tapered segments, plus higher-resolution signed-distance geometry near fingertips and finger gaps. Perform continuous collision detection or conservative substeps so fast fingers cannot tunnel through strands.
5. Promote strands near the hand from follower status to locally simulated/contact-corrected status. Reassign or split guide clusters when a finger passes between neighboring hairs, following the rationale of adaptive skinning.[^1]
6. Apply nonpenetration first, then frictional tangential impulses or constraints with static and kinetic regimes. Add limited adhesion/clumping as a separate, breakable effect; do not fake all hair cohesion by increasing friction.[^11][^36]
7. Keep persistent contact IDs for finger–strand and strand–strand pairs. This is required for stable sticking, release and reduced jitter across frames.
8. Render explicit strands close to the camera and hand, aggregated strands at distance, using a Marschner/d’Eon-derived BCSDF, approximate multiple scattering, deep-opacity or equivalent transmittance, analytic coverage and temporally stable transparency.[^19][^12][^13][^39]

A practical split at 60 FPS is approximately: global rod solve; volume/grid interaction; hand broad phase; local contact and friction refinement; follower reconstruction; contact correction; strand rasterization; transparency/shadows; shading. The exact strand count and substep budget will depend heavily on hairstyle, screen coverage, hand speed, GPU and whether two-way hand dynamics are required.

## Parameter model

Avoid a single categorical `hairType`. A useful asset schema should include:

| Parameter group | Suggested fields | Scientific basis |
|---|---|---|
| Geometry | Length distribution, root density, major/minor diameter, ellipticity, rest curvature, rest torsion, wave/curl wavelength, curl radius | Worldwide morphology and whole-fiber geometry[^24][^27] |
| Elasticity | Stretch compliance, bend stiffness around two material axes, twist stiffness, damping, root angular compliance | Rod mechanics and coupled fiber properties[^7][^8][^9] |
| Contact | Strand radius, static/kinetic friction, optional directional friction, adhesion/clump strength, break threshold | Hair tribology and Coulomb-contact simulation[^28][^11] |
| Environment | Wetness, humidity response, product/conditioner state, damage/weathering | Combing experiments and tribology[^28][^32] |
| Optics | Absorption or melanin proxy, longitudinal/azimuthal roughness, cuticle tilt proxy, index of refraction, multiple-scattering density | Marschner and d’Eon models[^12][^13] |
| Runtime | Guide assignment, active-contact radius, simulation LOD, render LOD, solver iterations and substeps | Reduced and adaptive real-time methods[^1][^16][^19] |

## Validation suite

A useful R&D benchmark should test behaviors rather than only screenshots:

- **Single-strand cantilever:** equilibrium sag and oscillation decay at several lengths.
- **Twist–bend coupling:** straight, wavy and helical rest shapes under extension and release.
- **Bundle swing:** compare phase coherence and damping for low- and high-friction presets.
- **Finger sweep:** one finger crosses a hanging curtain of hair at multiple speeds; measure penetration, dragged mass and recovery.
- **Finger separation:** two fingers enter together and spread apart; check whether a lock divides without explosive guide interpolation.
- **Pinch and release:** trap a small lock between finger colliders, move it, then release; evaluate static-to-kinetic transition.
- **Comb stroke:** use a row of capsule teeth and compare qualitative force peaks, end gathering and detangling direction with combing studies.[^32][^29]
- **Curl preservation:** pull and release wavy, curly and coiled strands; verify recovery of rest curvature and torsion.[^7]
- **Contact stress:** force strands through narrow finger gaps at increasing velocity to reveal tunneling and solver instability.
- **Rendering:** rotate blond, brown, black and gray grooms under area and directional lights; compare highlight shifts, transmission, multiple scattering, self-shadowing and temporal shimmer.[^12][^14]

## Important gaps

The literature is strong on the ingredients but thinner on complete, perceptually validated **bare-hand finger-combing of dense, diverse hairstyles at game frame rates**. Many systems demonstrate rigid-object collision but not persistent multi-finger trapping, fingernail contact, skin friction, two-way hand response, topology-aware lock splitting or transition from free hair into tight tangles.

Consequently, the likely research contribution is not inventing another basic strand integrator. It is the **adaptive interaction layer**: detecting where guide coherence fails; promoting and repartitioning strands around the fingers; maintaining persistent frictional contact; transmitting forces into the bulk groom; and returning those strands smoothly to reduced simulation after contact.[^6][^1]

## Suggested reading order

1. Ward et al., **A Survey on Hair Modeling: Styling, Simulation, and Rendering**, for the field map.[^3]
2. Bergou et al., **Discrete Elastic Rods**, and Bertails et al., **Super-Helices**, for strand mechanics.[^7][^8]
3. Daviet et al., **Coulomb Friction in Hair Dynamics**, for collective contact.[^11]
4. McAdams et al., **Detail Preserving Continuum Simulation**, for scalable hair–hair interaction.[^10]
5. Chai et al., **Adaptive Skinning for Interactive Hair-Solid Simulation**, for finger-induced coherence failure.[^1]
6. Herrera et al., **Augmented Mass-Spring Model**, for the newest directly relevant real-time baseline.[^6]
7. Hsu et al., **Physically Guided Hair Interpolation**, for modern follower reconstruction.[^18]
8. Marschner et al., d’Eon et al. and Zinke et al., for single-fiber and multiple-fiber appearance.[^13][^14][^12]
9. Loussouarn et al. and the whole-fiber morphology study, for a diverse geometric parameter space.[^24][^27]
10. **Combing a Double Helix** and the comb-force literature, for tangles and interaction behavior.[^29][^32]

---

## References

1. [JOURNAL OF XXXX, VOL. XX, NO. X, AUGUST XXXX](https://www.cs.columbia.edu/~cxz/publications/hair_collision.pdf)

2. [Towards Realtime: A Hybrid Physics-based Method for Hair Animation on GPU](https://dl.acm.org/doi/10.1145/3606937) - This paper introduces a hair simulator optimized for real-time applications, including console and c...

3. [A Survey on Hair Modeling: Styling, Simulation, and Rendering](https://hal.science/hal-00171407/document)

4. [[PDF] Augmented Mass-Spring Model for Real-Time Dense Hair Simulation](https://openaccess.thecvf.com/content/ICCV2025/papers/H._Augmented_Mass-Spring_Model_for_Real-Time_Dense_Hair_Simulation_ICCV_2025_paper.pdf)

5. [EUROGRAPHICS 2008 / K. Mania and E. Reinhard](https://cgg.mff.cuni.cz/~kmoch/downloads/BK08.pdf)

6. [Augmented Mass-Spring Model for Real-Time Dense Hair ...](https://graphics.cs.yale.edu/sites/default/files/ams_iccv25_1.pdf) - We propose a novel Augmented Mass-Spring (AMS) model for real-time simulation of dense hair at the s...

7. [Super-Helices for Predicting the Dynamics of Natural Hair](https://inria.hal.science/inria-00384718/file/sigFinalHair06.pdf)

8. [Discrete Elastic Rods - Columbia CS](https://www.cs.columbia.edu/cg/rods/)

9. [Systems Approach to Human Hair Fibers: Interdependence Between ...](https://pmc.ncbi.nlm.nih.gov/articles/PMC6393780/) - Contextual interpretation of hair fiber data is often blind to the effects of the dynamic complexity...

10. [Detail Preserving Continuum Simulation of Straight Hair](https://math.ucdavis.edu/~jteran/papers/MWSST09.pdf)

11. [A Hybrid Iterative Solver for Robustly Capturing Coulomb Friction in Hair Dynamics](https://elan.inrialpes.fr/people/bertails/Papiers/PDF/hairContactSiggraphAsia2011.pdf)

12. [Light Scattering from Human Hair Fibers - Stanford University](https://graphics.stanford.edu/papers/hair/hair-sg03final.pdf)

13. [An Energy‐Conserving Hair Reflectance Model - d&#x27;Eon ...](https://onlinelibrary.wiley.com/doi/10.1111/j.1467-8659.2011.01976.x)

14. [Dual Scattering Approximation](https://www.cemyuksel.com/research/dualscattering/)

15. [Advanced Techniques in Real-time Hair](https://developer.download.nvidia.com/presentations/2010/SIGGRAPH/HairCourse_SIGGRAPH2010.pdf)

16. [A Reduced Model for Interactive Hairs](https://www.cs.columbia.edu/~cxz/publications/reduced_hair.pdf)

17. [Real-Time Hair Simulation With Neural Interpolation](https://www.computer.org/csdl/journal/tg/2022/04/09220808/1nRLElyFvfG)

18. [Real-Time Physically Guided Hair Interpolation](https://graphics.cs.utah.edu/research/projects/physically-guided-hair-interpolation/hairinterp-siggraph2024.pdf)

19. [Real-time Level-of-detail Strand-based Rendering](https://kuiwuchn.github.io/hairlod/hairlod.pdf)

20. [Super-helices for predicting the dynamics of natural hair | ACM Transactions on Graphics](https://dl.acm.org/doi/10.1145/1141911.1142012) - Simulating human hair is recognized as one of the most difficult tasks in computer animation. In thi...

21. [A hybrid iterative solver for robustly capturing coulomb friction in hair dynamics | Proceedings of the 2011 SIGGRAPH Asia Conference](https://dl.acm.org/doi/10.1145/2024156.2024173)

22. [Modeling and Rendering a Nighttime Bear and River Scene](https://graphics.stanford.edu/courses/cs348b-competition/cs348b-16/grand_report.pdf)

23. [[PDF] Dual Scattering Approximation for Fast Multiple Scattering in Hair](http://www.cemyuksel.com/research/dualscattering/dualscattering.pdf)

24. [Worldwide diversity of hair curliness: a new method ...](https://onlinelibrary.wiley.com/doi/abs/10.1111/j.1365-4632.2007.03453.x)

25. [Worldwide diversity of hair curliness: a new method ...](https://pubmed.ncbi.nlm.nih.gov/17919196/) - by G Loussouarn · 2007 · Cited by 181 — This study has shown that it is possible to classify the var...

26. [Shape variability and classification of human hair](https://pubmed.ncbi.nlm.nih.gov/18078200/) - Human hair has been commonly classified according to three conventional ethnic human subgroups, that...

27. [Quantifying whole human hair scalp fibres of varying curl - PMC - NIH](https://pmc.ncbi.nlm.nih.gov/articles/PMC11733847/) - Scalp hair is a key feature of humans and its variability has been the subject of a broad range of s...

28. [Understanding and controlling the friction of human hair](https://pubmed.ncbi.nlm.nih.gov/40782659/) - Pleasant sensory perception when touching, brushing, and combing hair is largely determined by hair ...

29. [arXiv:2103.05211v1 [cond-mat.soft] 9 Mar 2021](https://arxiv.org/pdf/2103.05211v1.pdf)

30. [Tear-free hair brushing? All you need is math - ScienceDaily](https://www.sciencedaily.com/releases/2022/04/220413203128.htm) - Scientists explore the mathematics of combing and explain why the brushing technique used by so many...

31. [Volume 37 No 3 page 13](https://library.scconline.org/v037n03/13)

32. [Volume 37 No 3 page 1](https://library.scconline.org/v037n03/1)

33. [The biomechanics of splitting hairs - PMC - NIH](https://pmc.ncbi.nlm.nih.gov/articles/PMC11285785/) - Splitting of hair, creating ‘split ends’, is a very common problem which has been extensively docume...

34. [[PDF] Detail Preserving Continuum Simulation of Straight Hair](https://pages.cs.wisc.edu/~sifakis/papers/hair-mcadams.pdf)

35. [A mass spring model for hair simulation](https://dl.acm.org/doi/10.1145/1399504.1360663)

36. [[PDF] A mass spring model for hair simulation | Semantic Scholar](https://www.semanticscholar.org/paper/A-mass-spring-model-for-hair-simulation-Selle-Lentine/aad3f246c97962540cfcb1a0e1e58ac285b998e6) - A new altitude spring model for preventing collapse in the simulation of volumetric tetrahedra and a...

37. [Changxi Zheng's Homepage - Columbia University](http://www.cs.columbia.edu/~cxz/publications.htm)

38. [Quaffure: Real-Time Quasi-Static Neural Hair Simulation](https://arxiv.org/html/2412.10061v1)

39. [Strand-based hair rendering in Frostbite](https://advances.realtimerendering.com/s2019/hair_presentation_final.pdf)

40. [Real-time Level-of-detail Strand-based Hair Rendering](https://arxiv.org/html/2405.10565v2)

41. [Real-Time Hybrid Hair Rendering - Erik S. V. Jansson](https://eriksvjansson.net/papers/rthhr.pdf)

42. [Real-Time Hair Filtering with Convolutional Neural Networks](https://research.chalmers.se/publication/530524/file/530524_Fulltext.pdf)

43. [Interactive Simulation of Thin Solids using Cosserat Models](https://graphics.stanford.edu/courses/cs468-03-winter/Papers/pai02strands.pdf)

44. [Implicit Contact Model for Discrete Elastic Rods in Knot Tying](https://par.nsf.gov/servlets/purl/10292349)

45. [Snap Buckling in Overhand Knots](https://par.nsf.gov/biblio/10422931-snap-buckling-overhand-knots)

46. [[PDF] arXiv:2205.10309v2 [cs.GR] 31 Oct 2022 - SciSpace](https://scispace.com/pdf/a-fully-implicit-method-for-robust-frictional-contact-3k4jd1kt.pdf)

47. [Anisotropic Elastoplasticity for Cloth, Knit and Hair Frictional Contact](https://math.ucdavis.edu/~jteran/papers/JGT17.pdf)

48. [EUROGRAPHICS 2008 / G. Drettakis and R. Scopigno](https://cg.informatik.uni-freiburg.de/publications/2008_EG_rods.pdf)

