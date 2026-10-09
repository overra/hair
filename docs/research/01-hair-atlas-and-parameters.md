# Hair Atlas and Parameter Spec

Status: research draft, 2026-10-09
Purpose: give a graphics engineer the body-region atlas, hair-type taxonomy, appearance and physics parameters, and grooming operations needed to build a parametric data model for a real-time procedural hair simulator (WebGPU, 120 fps target).
Scope: research only. No code is included.

---

## 0. How to read this document

Evidence tags used throughout:

| Tag | Meaning |
|---|---|
| [V] | Verified against a page, abstract or documentation text fetched in this pass. URL given. |
| [S] | Secondary. Search snippet, review, clinic blog, patent or popular source. Use as a lead, not a constant. |
| [D] | Derived here by arithmetic or standard physics from cited inputs. The derivation is mine. |
| [H] | Engineering heuristic or background knowledge not sourced in this pass. Calibrate before use. |
| [?] | Sources conflict, or the value could not be resolved. |

**Primary papers not accessed in this pass (their numbers are NOT verified here):**
- d'Eon et al. 2011 full text. The PDF returned HTTP 403. Only the abstract was retrieved.
- Chiang et al. 2016 full text. The Disney-hosted PDF could not be parsed. Only the abstract and implementation docs were retrieved.
- Marschner et al. 2003 full text.
- Franbourg et al. 2003, "Current research on ethnic hair" (paywalled; no ellipticity values retrieved).
- De La Mettrie et al. 2007 full text (paywalled; abstract only).
- Loussouarn et al. 2007 hair-diameter study.
- Lasisi 2016 (DOI 10.1002/ajpa.22971). The PDF text layer was not extractable.
- Robbins, *Chemical and Physical Behavior of Human Hair* (no tables retrieved).
- Bertails et al. 2006 Super-Helices (paper parameter table not retrieved).

Verify these before locking any constant that depends on them.

---

## 1. Key findings

1. **The body atlas is mostly a scalp atlas.** Published counts, diameters and anagen durations are thin for trunk, limbs, genitals and hands. The model should allow every body-region value to be overridden, and should carry a confidence tag per value.
2. **Scalp density is about 120 to 230 terminal follicles per cm² in most studies.** One large cohort reports 170 to 584. Method changes the answer by roughly 30 percent: occipital trichoscopy gave 163 per cm² versus 215 per cm² by biopsy in one Chinese cohort [S].
3. **Walker 1A to 4C is a vocabulary, not a measurement.** De La Mettrie et al. 2007 gives a measurable basis (curve diameter, curl index, number of waves). Its full definitions were not retrieved, so treat the mapping to procedural parameters as provisional.
4. **Cross-section ellipticity sets bending anisotropy.** Reported values run from about 1.2 to 1.3 (Asian), about 1.35 (European) and about 1.75 (African-American) in one secondary summary [S]. Ellipticity also changes with humidity. One study reports 1.895 for African-American hair at 65 percent RH [S].
5. **Melanin has a usable working model.** Blender's Principled Hair documentation [V] gives a melanin-to-absorption mapping with eumelanin and pheomelanin RGB vectors. Those vectors trace back to d'Eon et al. 2011 section 6.1, but Blender says it adjusted them for a 0 to 1 input range. Unverified against the paper.
6. **Scale angle and IOR have defaults.** Omniverse gives scale angles of 2.3 to 3.7 degrees by hair origin and an IOR default of 1.55 [V]. Its roughness default is 0.2 [V].
7. **Young's modulus is the least settled mechanical input.** One patent-derived estimate gives about 0.4 GPa wet [S]. A secondary review says dry modulus is 2 to 3 times wet [S], which conflicts with the commonly quoted dry value of 3 to 4 GPa that I could not verify here. Treat E as a calibrated range, not a constant.
8. **Friction is directional only after wear, in one study.** A Birmingham study found direction-dependent friction only after cuticle lifting from wear [S]. Another study found no hysteresis for native hair and clear hysteresis for damaged hair [S].
9. **Humidity drives curl through hydrogen bonds.** Disulfide bonds are fixed, while hydrogen bonds reform on drying. Elongation at break was roughly constant at 55 to 60 percent between 50 and 79 percent RH, then rose sharply above about 80 percent RH [S].
10. **Heat setting has a practical window.** Typical curling-iron ranges reported are 130 to 170 °C [S]. Above about 180 °C there is little extra hold and damage risk rises [S].
11. **Greying has a stress pathway in mice.** Acute stress depletes melanocyte stem cells through sympathetic noradrenaline release [S, Nature 2020 summary]. Human mechanism not verified here.

---

## 2. Full-body hair atlas

### 2.1 Scalp and sub-regions

| Sub-region | Density (follicles/cm²) | Terminal vs vellus | Diameter (µm) | Notes and confidence |
|---|---|---|---|---|
| Crown / vertex | Folliscope study (239 adults, 79 men, 160 women): 162.9 ± 15.7 [S] | Terminal dominant; miniaturization common in androgenetic alopecia [S] | Terminal 60–80 typical [S] | Crown whorl is the directional anchor (see 2.5). Digital-microscope study (n=49) reports vertex densest in women, parietal in men [S]. |
| Temples | 133.7 ± 14.6 (same study) [S]; 123.6 ± 64.8 (Indian men, dermoscopy) [S] | Terminal dominant; lowest density across studies | Terminal 60–80 [S] | Lowest-density scalp zone in most data. Hairline recession appears here first in androgenetic alopecia [H]. |
| Nape / occipital | 160.2 ± 15.3 [S]; 156.3 ± 97.8 (Indian men) [S] | Terminal | Terminal 60–80 [S] | Occipital counts are method-sensitive: 163 by trichoscopy vs 215 by biopsy in one cohort [S]. |
| Hairline / frontal | 154.3 ± 12.8 [S]; 160.1 ± 86.9 (Indian men) [S] | Terminal, with vellus at the margin [H] | Terminal 60–80 [S] | Frontal density is the most-quoted value in clinical trichoscopy. |
| Sideburns | Regional total about 1,200 follicles across the sideburns (1 cm² sampling, 58 Caucasian men) [S] | Terminal | Not verified | Region totals only; no per-cm² value found. |
| Whole scalp (reference) | About 223 per cm², range 175 to 300 (1965 trichogram, via BioNumbers) [S] | Terminal | 60–80 [S] | Oldest study in the set. Nigerian cohort gave 170 to 584 (frontal mean 376) [S]. Treat as an outlier. |

Scalp notes:
- Scalp terminal diameters are commonly given as 60 to 80 µm [S, Donovan clinic], with about 70 µm from Altmeyer's reference [S]. Hairs under 30 µm are classed as vellus [S].
- Scalp density declines with age, and men show higher counts than women in the Nigerian cohort [S].
- Cross-section area by ancestry is reported as about 4,804 µm² (Asian), 4,274 µm² (African) and 3,857 µm² (Caucasian) [S, 2020 review]. Area cannot be converted to diameter without the cross-section shape.

### 2.2 Face and head

| Site | Terminal vs vellus | Density | Typical length | Growth and anagen | Diameter | Flow, curl, clumping | Confidence |
|---|---|---|---|---|---|---|---|
| Eyebrows | Terminal | No normal-population per-cm² value found. Sparse-brow cohort (17 women, 5 men): baseline about 17/cm², shaft about 34 µm [S] | Single brow count 200–400, typically 225–265 [S] | Growth about 0.15 mm/day [S]. Anagen 1 to 6 months (study-prep page), 2 to 4 months (popular) [S] | Sparse baseline about 34 µm; about 70 µm after treatment in the same study [S]. Tail is thinnest and sparsest in a 48-patient cohort [S] | Brow hairs grow outward from the nose and along the superciliary arch [H]. Clumping is low, but hairs align with brow direction [H]. | Low for density; medium for counts |
| Eyelashes, upper | Terminal | Upper lid: 90–160 lashes in 5–6 rows [S] | 7–8 mm typical; 3–10 mm range [S]. Lash length tracks about one-third of eye width [S] | Growth about 0.16 mm/day [S]. Anagen 4 to 8 weeks [S] | Asian 71.7 µm vs Caucasian 61.0 µm [S] | Curl at the tip; clumps at the tip [H] | Medium for counts and length |
| Eyelashes, lower | Terminal | Lower lid: 75–80 lashes in 3–4 rows [S] | 5–6 mm mean [S] | As upper, shorter anagen expected [H] | Not found | Shorter, straighter [H] | Medium for counts |
| Eyelash follicle depth | — | Upper follicles 2.4 mm deep, lower 1.4 mm; active fraction 41 percent upper vs 15 percent lower [S] | — | — | — | — | Low to medium |
| Beard, cheek and chin | Terminal | Donor zone below jawline: 49.7 follicular units/cm² vs 78.2 on the scalp (580 men, hair restoration context) [S] | Not verified; long beards exist, see anagen conflict | Growth about 0.38 mm/day [S]. Anagen conflict: 4 to 14 weeks in a beard alopecia review [S] vs 2 to 6 years in consumer guides [S] | Not verified | Androgen-dependent [H]. Flow outward and downward on the cheek [H] | Low; anagen unresolved [?] |
| Mustache | Terminal | Regional total above 1,340 follicles (1 cm² sampling, 58 Caucasian men) [S] | Not verified | Not verified | Not verified | Flow outward from the midline [H] | Low |
| Ear hair | Terminal in older men [H] | No quantitative source found | Not verified | Not verified | Not verified | Not verified | No data |
| Nose hair | Terminal [H] | No quantitative source found | Not verified | Not verified | Not verified | Not verified | No data |

Face notes:
- Beard and mustache are androgen-dependent [H]. Beard donor-zone density is much lower than scalp density [S].
- Beard anagen is the largest unresolved conflict in the atlas (see 2.6).

### 2.3 Trunk, limbs, hands, pelvis and feet

| Site | Terminal vs vellus | Density | Typical length | Growth and anagen | Diameter | Flow, curl, clumping | Confidence |
|---|---|---|---|---|---|---|---|
| Chest | Terminal in men; vellus or sparse terminal in women [H] | Trunk combined: about 270 per cm² (older Szabo abstract; method and units unclear) [S] | Not verified | Not verified | Not verified | Flows outward from the sternum and downward [H]. Clumping low. | Low |
| Abdomen ("happy trail") | Terminal in men [H] | Not verified | Not verified | Not verified | Not verified | Flows downward toward the pubic region [H] | Low |
| Back | Terminal in men, vellus in women [H] | Trunk combined as above [S] | Not verified | Not verified | Not verified | Flow pattern in Kidd (1902) map [S, see 2.5] | Low |
| Shoulders | Terminal and vellus [H] | Not verified | Not verified | Not verified | Not verified | Flows toward the arm [H] | Low |
| Axilla (armpit) | Terminal [H] | Not verified | Not verified | Growth about 0.4 mm/day [S] | Not verified | Coarse; clumps naturally [H] | Low |
| Upper arm | Terminal and vellus [H] | Sex-independent in a 1985 study, no absolute count given [S] | Not verified | Anagen 28 days (male), 22 days (female) [S, 1985 study] | Not verified | Flows toward the elbow [H] | Low |
| Forearm | Terminal and vellus [H] | Not verified | Not verified | Not verified | Not verified | Flow direction in Kidd map [S] | Low |
| Hands, dorsum | Vellus to terminal [H] | Not verified | Not verified | Not verified | Not verified | Finger segments show short, fine hair [H] | No data |
| Palms and soles | No terminal follicles [S, Cleveland Clinic] | 0 | 0 | 0 | 0 | 0 | High (absence) |
| Pubic | Terminal, coarse [H] | Not verified | Not verified | Growth about 0.3 mm/day [S] | Not verified | Tight coil typical [H] | Low |
| Buttocks | Vellus to sparse terminal [H] | Not verified | Not verified | Not verified | Not verified | Not verified | No data |
| Thigh | Terminal and intermediate [S] | Sex-independent in 1985 study, no absolute count [S]. Szabo leg combined about 190/cm² [S] | Not verified | Anagen 54 days (male), 22 days (female) [S, 1985 study] | Intermediate fibers "thicker than vellus, thinner than terminal" [S] | Flows downward toward the knee [H] | Low |
| Shin / calf | Intermediate and terminal [S] | Not verified | Not verified | Not verified | Intermediate in the 30 to 60 µm band [S] | Flows downward [H] | Low |
| Feet and toes | Vellus to sparse terminal [H] | Not verified | Not verified | Not verified | Not verified | Not verified | No data |

Trunk and limb notes:
- The only per-site absolute counts found are from one old Szabo abstract. Its combined head, trunk, arm and leg values (980, 270, 250, 190 per cm²) appear to mix follicles and sweat glands and use unclear units [S]. Use these only as a ranking, not as absolute counts.
- The 1985 thigh and upper arm study is the only source with anagen durations for limbs [S]. Its sample was 11 women and 9 men aged 20 to 30 [S].

### 2.4 Vellus and lanugo

| Class | Diameter | Length | Notes |
|---|---|---|---|
| Vellus | Under 30 µm [S, Donovan clinic; patent] | Under 2 mm in one definition [S] | Lacks the central medullary layer present in terminal shafts [S, Merriam-Webster]. Covers most of the skin surface. |
| Intermediate | About 30 to 60 µm [S] | Variable | Miniaturized hairs in androgenetic alopecia and thigh or calf hairs [S]. Clinical cutoffs vary by ethnicity [S]. |
| Terminal | About 60 to 80 µm, typical [S] | Up to the anagen limit | Long, coarse, pigmented [S]. |
| Lanugo | Not verified | Not verified | Fetal hair. Onset about 16 to 20 weeks; shed around 33 to 36 weeks; about 30 percent of newborns keep some [S, StatPearls; Cleveland Clinic]. Covers nearly the whole body except palms, soles, lips, nails and genitals [S]. Replaced by vellus [S]. |

### 2.5 Flow patterns, whorls and hair-direction maps

- **Hair-direction map.** The widely reproduced body hair-flow chart is attributed to Walter Kidd (1902), with the book *The Direction of Hair in Animals and Man* (1903) [S, kottke.org; Paris Review]. Use it as the reference for region flow fields. I did not view the chart in this pass, so region directions below are background [H].
- **Voigt lines** is an overloaded term. The pigment line named after Voigt runs along the lateral biceps [S]. Do not use it for hair flow.
- **Blaschko lines** are developmental patterns, not hair tracts [S, Wikipedia].
- **Crown whorl.** Whorls are patches of hair rotating around a center. Clockwise is the usual scalp direction [S]. One study of about 500 men reported 75 percent clockwise and 11 percent anticlockwise whorls [S, publication year inconsistent between sources]. About 5 percent of people have a double whorl [S, NHGRI via secondary].
- **Fetal whorls.** Lanugo forms whorl patterns on the scalp and trunk, which merge along the midline [S, Wikipedia].

Flow-field recommendation: store a per-region direction field on UV space, with a sharp discontinuity line at the midline and a whorl singularity at the crown. Calibrate against the Kidd chart.

### 2.6 Anagen-limited length (derived)

Maximum natural length is approximately growth rate times anagen duration. Growth rate and duration values come from the sources above.

| Site | Growth v (mm/day) | Anagen T | Derived L_max (= v × T) | Check against observation |
|---|---|---|---|---|
| Scalp | 0.30 to 0.35 [S] | 2 to 7 years [S] | About 22 to 89 cm [D] | Upper bound is below the "a metre or more" popular claim. Either some follicles stay in anagen longer, or growth is faster. [?] |
| Eyebrow | 0.15 [S] | 2 to 6 months (60 to 180 days) [S] | About 9 to 27 mm [D] | Plausible. |
| Eyelash, upper | 0.16 [S] | 4 to 8 weeks (28 to 56 days) [S] | About 4.5 to 9 mm [D] | Matches the observed 7 to 8 mm typical length. Good consistency check. |
| Beard | 0.38 [S] | 4 to 14 weeks (28 to 98 days) [S] | About 11 to 37 mm [D] | Conflicts with the observed long-beard lengths of 10 cm or more. Suggests a heavy-tailed anagen distribution. [?] |
| Thigh (male) | Not verified; assume 0.2 to 0.3 [H] | 54 days [S] | About 11 to 16 mm [D] | Growth rate is an assumption. |
| Upper arm (male) | Not verified; assume 0.2 to 0.3 [H] | 28 days [S] | About 6 to 8 mm [D] | Growth rate is an assumption. |

Modeling implications:
- Use per-region anagen distributions, not single values.
- Use heavy-tailed distributions for beard and scalp so that long strands exist.
- Thicker hair grows faster. One review reports about 11.4 mm/month for hairs over 60 µm vs about 7.6 mm/month for hairs of 20 to 30 µm [S].

### 2.7 Variation by sex, age and ethnicity

| Factor | Finding | Confidence |
|---|---|---|
| Scalp growth rate, sex | Korean phototrichogram (42 volunteers): men 300 to 319 µm/day, women 289 to 327 µm/day, overlapping [S] | Medium |
| Scalp growth rate, age | Older Korean men show slower vertex growth and thinner vertex hairs [S]. Infant growth about 0.22 mm/day rising to 0.38 mm/day by age 3 [S]. | Medium |
| Scalp growth rate, ethnicity | Conflicting. Popular claims of 5 mm/month (African) and up to 20 mm/month (Asian) are clinical impressions [S]. Korean data suggest slower growth than Caucasians [S]. | Low [?] |
| Scalp density, sex | Men higher in the Nigerian cohort; men show higher density in several cohorts [S]. Facial follicle distribution did not differ by sex in one Szabo-based abstract [S]. | Low to medium |
| Limb density, sex | No sex difference in 1985 thigh and upper-arm study [S] | Medium |
| Limb anagen, sex | Male thigh 54 days vs female 22 days; male upper arm 28 days vs female 22 days [S] | Low (n=20) |
| Diameter, ethnicity | Eyelash Asian 71.7 µm vs Caucasian 61.0 µm [S]. Scalp cross-section areas ordered Asian > African > Caucasian [S]. | Low to medium |
| Cross-section shape, ethnicity | See section 3.4 | Medium |
| Medulla, ethnicity | Medulla most common in Asian hair [S] | Low to medium |
| Greying, age | Greying fraction rises with age [H]. Mechanism in section 4.2. | Medium |

---

## 3. Hair-type taxonomies

### 3.1 Andre Walker system (1A to 4C)

- **Structure.** Numbers 1 to 4 for pattern family (straight, wavy, curly, coily). Letters A, B, C for curl width or tightness, from loose to tight [S, origenere.com]. Subtypes 3C and 4C were added later [S].
- **Extremes.** 1A is fine and straight. 4C is tightly coiled, with shrinkage up to about 75 percent and fragile strands [S].
- **Origin.** Popularized by Andre Walker's book *Andre Talks Hair!*. Generally dated to the 1990s [S].
- **Criticisms.** Curl pattern is only one factor. Porosity, density and diameter are ignored, so two 3B heads can need different care [S, afrocenchix.com]. The scheme implies a ranking [S]. The example photos show well-defined curls and may misclassify cottony or frizzy textures [S]. It is not a scientific standard [S].
- **Use.** Shared vocabulary for stylists and product marketing. Not usable as a physical measurement.

### 3.2 LOIS

- Less widely known than Walker. Originally published by the former OurHair.net site [S].
- Classifies by strand shape and texture rather than curl size, and avoids a ranking structure [S].
- Method: start with one freshly washed strand of the most common texture on the head [S].
- The acronym was not expanded in any source retrieved. Source quality is blog-level [S]. Do not build parameters on it without primary material.

### 3.3 De La Mettrie et al. 2007 (eight curl types)

Source: [V] abstract at https://bioone.org/journals/human-biology/volume-79/issue-3/hub.2007.0045/Shape-Variability-and-Classification-of-Human-Hair--A-Worldwide/10.1353/hub.2007.0045.full

- **Sample.** 1,442 subjects from 18 countries [V, abstract]. A secondary summary cites 2,449 subjects from 22 regions [?]. I could not reconcile these.
- **Method.** Three descriptors of hair shape, sorted into eight classes [V]. The abstract says the method "requires the measurement of only three easily accessible descriptors of hair shape" and produces "a worldwide coherent classification of hair in eight well-defined categories" [V].
- **Descriptors (from secondary summaries; verify against the Methods section):**
  - Curve diameter (CD): the smallest diameter of a curl, read with a gauge [S].
  - Curl index (i): a ratio. A secondary summary gives 6 cm divided by l1, with l1 the measured length [S]. Confirm whether 6 cm is the fully extended length and l1 the relaxed end-to-end span.
  - Number of waves (w): natural constrictions along a 5 cm extended fiber, or the number of waves present when a 5 cm extended fiber shrinks to 4 cm end-to-end [S].
  - A later follow-up added a number of twists. Some summaries list this as a fourth descriptor [S].
- **Classes.** Classes I to VIII via segmentation tree on the averaged values [S]. In one dataset, classes ranged from IV to VIII, with VI most common, and US samples looser than Kenyan samples [S].
- **Critiques.** The original researchers did not compare the properties of each type. The classes are not based on consumer or stylist terms [S]. A 2017 PLOS ONE study found a six-group version more reliable [S]. A 2023 review argues the eight types may be too complex to reproduce [S].
- **Related.** Loussouarn and colleagues (2007, Int J Dermatol) assessed curliness with over 2,000 individuals [S]. Physically, thicker fibers tend toward looser curls, and more elliptical fibers curl more [S].

### 3.4 Cross-section shape by ancestry

| Ancestry / group | Ellipticity (major/minor) | Source and notes |
|---|---|---|
| Asian | About 1.25 (literature summary); 1.16 (Chinese, own measurement) | [S] Journal of Cosmetic Science summary; Chinese values from the same work |
| Indian | 1.44 (own measurement) | [S] |
| European | About 1.35 (literature summary); 1.46 to 1.52 (own, light to dark brown) | [S] |
| African / African-American | About 1.75 (literature summary); 1.6 (African, own); 1.895 at 65 percent RH (another study) | [S] RH dependence is a warning sign |
| Franbourg et al. 2003 | Not retrieved | [?] Paywalled. Values needed. |

Blender's Huang model gives an aspect ratio (minor/major) range of 0.8 to 1.0 (Asian), 0.65 to 0.9 (Caucasian), and 0.5 to 0.65 (African) [V, Blender docs]. These are the reciprocal of the ellipticity values above, and they agree roughly [D].

### 3.5 Mapping hair-type descriptors to procedural parameters

These mappings are my derivations, not published mappings. Calibrate with reference photographs or measured strands.

**Geometry identities used**

- Ideal helix, radius R, pitch p (axial advance per turn). Fiber length per turn is the square root of (2πR)² + p². End-to-end per turn is p.
- If the curl index is defined as extended length over end-to-end length (the reading I am assuming for De La Mettrie's i), then i = sqrt(1 + (2πR/p)²) [D]. Rearranged: 2πR/p = sqrt(i² − 1) [D].
- Number of waves w over a 5 cm extended fiber gives an approximate pitch p ≈ 50 mm / w for wave-type hair [D, heuristic].

**Walker class to procedural mapping (heuristic)**

| Class | Curl index i (heuristic) | Implied 2πR/p [D] | Procedural form [H] | Example helix radius with p = 5 mm [D] |
|---|---|---|---|---|
| 1A to 1C (straight) | 1.00 to 1.05 | 0 to 0.32 | Near-straight strand, small noise | Not applicable |
| 2A to 2C (wave) | 1.05 to 1.30 | 0.32 to 0.83 | Planar sinusoid, amplitude set from w | About 0.3 to 0.7 mm |
| 3A to 3C (curl) | 1.30 to 2.00 | 0.83 to 1.73 | Helix, radius and pitch from i and w | About 0.7 to 1.4 mm |
| 4A to 4C (coil) | 2.00 to 4.00 | 1.73 to 3.87 | Tight helix with radius below 1 mm | About 1.4 to 3.1 mm |
| 4C zig-zag | Not defined | Not defined | Piecewise helix with kink events | Kink angle and kink spacing [H] |

Other descriptor mappings:

| Descriptor | Procedural parameter | Notes |
|---|---|---|
| Curve diameter | Helix diameter (2R) | Direct, if CD matches the helix diameter. Verify. |
| Curl index | Helix aspect ratio 2πR/p | Derived above. |
| Number of waves | Pitch or kink density | Set frequency variance from wave-count spread. |
| Ellipticity | Bending anisotropy ratio (see 5.2) | Derived: stiffness ratio = e². |
| Kink (4C) | Kink events per cm, kink angle | Heuristic. |
| Frequency variance | Per-strand jitter in R and p | Use a distribution, not one value. |
| Twist | Rotation of cross-section about the axis | Only if a twist descriptor is retained. |

---

## 4. Appearance variables

### 4.1 Melanin and absorption

**Blender's implementation (verified against docs) [V]:**
- Artist melanin input M in [0, 1] is converted to an optical quantity by q = −ln(max(1 − M, 0.0001)).
- Redness r in [0, 1] is the pheomelanin fraction. Eumelanin share = M × (1 − r). Pheomelanin share = M × r.
- Absorption vectors (RGB), labeled as adjusted for a 0 to 1 input: eumelanin (0.506, 0.841, 1.653); pheomelanin (0.343, 0.733, 1.924).
- Blender states these trace back to section 6.1 of d'Eon et al. 2011 (not verified; PDF inaccessible).
- Direct coloring is also supported. Color converts to absorption through a radial-roughness polynomial: σa = (ln(Color) / (5.969 − 0.215βN + 2.532βN² − 10.73βN³ + 5.574βN⁴ + 0.245βN⁵))². Here βN is the radial roughness after randomization [V, Blender docs; attributed to Chiang et al. 2016].

**Recommended mapping [D from above]:**
- σa(λ) = q × [(1 − r) × E(λ) + r × P(λ)], with E and P the eumelanin and pheomelanin RGB vectors.
- Store eumelanin and pheomelanin as separate concentrations internally. Expose redness as the ratio.

**Open items:** the units of q and σa are not stated in the documentation. Blender's coefficients may differ from the paper. Calibrate against a reference strand.

**Dyes and tints:** Blender's Tint is applied after melanin, is not randomized, and adds to the melanin absorption [V]. Use a separate tint absorption vector. Do not multiply it into melanin.

### 4.2 Greying and white hair

- Mouse study (Nature, 2020): acute stress drives hair greying through sympathetic nerve release of noradrenaline, which pushes melanocyte stem cells into division and loss [S, chiulab.med.harvard.edu summary]. Stopping stem-cell division prevented stress-induced greying in those mice [S].
- Oxidative stress review (2013): falling catalase lets hydrogen peroxide reach millimolar levels in the bulb, killing pigment cells [S, PubMed 24033376]. Oxidative stress also depletes melanocyte stem cells [S].
- A 2021 human follicle study (Experimental Dermatology) measured ectopic pigmentation under stress signals [S]. It is not a Nature paper.
- **Model implication:** greying is a per-follicle or per-strand probability that sets eumelanin and pheomelanin to near zero. The grey state probably changes scattering too, but I did not verify how [H]. Use a grey fraction per region that rises with age.

### 4.3 Cuticle scale angle, roughness, IOR, medulla and eccentricity

| Parameter | Value or range | Source and confidence |
|---|---|---|
| Scale angle (cuticle tilt) by origin | Piedmont 2.8 ± 0.2; light brown European 2.9 ± 0.3; dark brown European 3.0 ± 0.2; Indian 3.7 ± 0.3; Japanese 3.6 ± 0.3; Chinese 3.6 ± 0.4; African-American 2.3 ± 0.4 degrees | [V] Omniverse OmniHair Specular table. Tilt by origin is the same concept. |
| Shift (highlight offset) default | 3.0 degrees (Omniverse). Positive moves highlights away from root; negative moves them toward root. | [V] Omniverse |
| Houdini Chiang shift | Input range −1 to 1 maps internally to −90 to 90 degrees. A 3 degree tilt is entered as 3/90. | [V] Houdini docs |
| Longitudinal roughness (Omniverse) | Default 0.2; near 0 sharp, near 1 rough | [V] Omniverse |
| Azimuthal roughness (Omniverse) | Default 0.2 when anisotropic is on | [V] Omniverse |
| Longitudinal and azimuthal (Chiang) | Chiang: longitudinal roughness per lobe (R, TT, TRT) and azimuthal per lobe (R_s, TT_s, TRT_s). Azimuthal distribution is logistic (abstract). Blender describes the longitudinal lobe as Gaussian. | [V] Houdini docs; [S] Chiang abstract |
| Index of refraction | Default 1.55 (Blender, Omniverse, Houdini example). Lower gives more forward scattering and a muted look; higher gives stronger reflection and a wet look. Omniverse lists wet-hair IOR presets. | [V] |
| Medulla | Present in some hair, most common in Asian hair [S]. Houdini Chiang Fur exposes medulla_diffuse and medulla_henyeygreenstein functions [V, names only]. Parameter ranges not retrieved. | [?] |
| Cuticle modulating Fresnel | Houdini Chiang Fur exposes a cuticle input that modulates the outer layer Fresnel [S] | [S] |
| Cross-section eccentricity | Realistic aspect ratio cited as 0.85 to 1.0 in RenderMan docs (search summary) | [S] Not verified against docs |

Parametric note: the rendering scale angle is a shading control and is not a direct measurement of cuticle geometry. Marschner et al. 2003 used a tilted-scale model, but I did not retrieve its exact angle values [?].

### 4.4 Wetness, oil, damage, frizz and porosity

| Variable | Observation | Confidence |
|---|---|---|
| Wet look | Higher IOR, lower roughness and clumping. Omniverse includes wet-hair IOR presets [V]. | Medium |
| Wet hair darkens | Commonly reported; no quantified source found | Low [H] |
| Clumping when wet | Capillary bridging is the mechanism commonly cited [H]. No quantified source found. | Low [H] |
| Oil and sebum | Sebum or conditioner lowered initial friction by at least 25 percent relative to hexane-cleaned hair [S, Birmingham] | Medium |
| Damage and porosity | Tip porosity exceeds root porosity. Tip fluorescence fell 27 percent after 10 hours of UV versus 13 percent at the root [S] | Low to medium |
| Frizz | Cuticle lifting increases directional friction after wear [S]. Humidity swelling disrupts the cuticle [S]. Razor cuts that bevel remove cuticle layers, making hair more humidity-sensitive [S]. | Medium |
| Static | Not researched | No data [H] |

### 4.5 Sun bleaching and root-to-tip gradient

- **Mechanism.** Visible lightening is photo-oxidized melanin, the same chemistry used in professional bleaching [S]. Pheomelanin is more UV-sensitive than eumelanin, while both are similarly visible-light sensitive [S].
- **Hair color changes.** Black and dark brown hair (mostly eumelanin) change less than light brown hair (a mix) under simulated sunlight [S, 1995 study].
- **Degradation markers.** Wakamatsu et al. 2012 (Pigment Cell & Melanoma Research) reports that free/total PTCA and TTCA/4-AHP ratios rise with age and UV exposure and serve as photodegradation markers [S].
- **Contested points.** One account argues UV mainly damages surrounding protein, so granules wash out on rinsing. Another reports visible light affects melanin most [S]. Measurement method (isolated granules vs in-hair) matters [S].
- **Root-to-tip gradient.** No controlled study of a root-to-tip gradient in sun-bleached hair was found [?]. Indirect evidence: tip porosity and fluorescence loss [S]. Inference: pigment lost from the shaft does not regrow, and older tip segments carry more exposure [H].
- **Model implication.** Use a per-strand lightening function L(s) that increases with arc length s from root to tip, scaled by an exposure parameter. Apply it by reducing eumelanin and pheomelanin concentrations, with pheomelanin decaying faster.

---

## 5. Physics variables

### 5.1 Summary table

| Variable | Value or range | Confidence and source | Simulation note |
|---|---|---|---|
| Young's modulus, dry | Commonly quoted 3 to 4 GPa [brief; not verified in this pass]. Derived from a 2 to 3 times wet ratio: about 0.8 to 1.2 GPa if wet is 0.4 [S, D]. | [?] Conflicting. | Treat as a calibrated parameter with a wide range. |
| Young's modulus, wet | About 0.4 GPa [S, patent-derived estimate] | [S] | Use for wet state. |
| Dry-to-wet ratio | 2 to 3 times [S, review]. Another source says 200 to 1000 percent greater (3 to 11 times) [S]. | [?] | Expose as a ratio parameter. |
| Wool analogy | Wool in water 1.7 to 2.0 GPa; dry wool about 2.7 times wet [S] | Analogy only | Supports the ratio being large. |
| Density | About 1.3 g/cm³ (patent default, Super-Helix context) [S]. Wool specific gravity 1.305 (1940 study) [S]. | [S] Not verified for human hair. Density also depends on moisture [S]. | Mass per length m' = ρ π d²/4. For d = 70 µm and ρ = 1,300 kg/m³, m' ≈ 5 mg/m [D]. |
| Bending stiffness | EI = E × I, with I depending on d⁴ for a circle [D] | [D] Standard | Strongly sensitive to diameter. |
| Elongation to break, dry, undamaged | Up to about 50 percent (patent background) [S]. Elongation at break about 55 to 60 percent at 50 to 79 percent RH [S]. | [S] | Strain limit. |
| Extensibility vs RH | Sharp rise above about 80 percent RH [S] | [S] | Humidity-driven plasticity. |
| Wet strength | Wet hair is weaker than dry hair [S]. Cuticle-cortex boundary weak when wet [S]. | [S] | Lower failure stress in wet state. |
| Friction, with-cuticle vs against-cuticle | Not settled. One study: no hysteresis for native hair, clear hysteresis for damaged hair [S, Mizuno et al. 2013 as cited]. Another: directional only after wear [S, Birmingham]. | [?] | Use anisotropic friction with a damage-scaled gap. |
| Friction coefficient values | Toward-root sliding: 0.47 to 0.54 for straight, curly and wavy hair [S, JOS]. Patent claim static 0.75, dynamic 0.15 (unclear source) [S]. | [?] | Tune within 0.1 to 0.6 pending primary data. |
| Hair friction, wet vs dry | Capstan study (2025): friction coefficient higher in wet than dry conditions, and falls with load [S]. Hair-on-hair wet friction not found. | [S] | Wet state raises friction. |
| Hydrogen bonds and curl | Hydrogen bonds set temporary shape and reform on drying. Disulfide bonds are fixed and set strength [S]. | [S] | Use a humidity-coupled curl state. |
| Hair length vs humidity | Hair length changes with moisture, which is the basis of hygrometers [S] | [S] | Use a humidity-dependent swelling strain. |
| Plasticity (set) | Heat sets shape through hydrogen bond reformation on cooling [S]. Cooling rate reported to affect permanence (anecdotal) [S]. | [S] | Model a set state with decay. |
| Heat set window | 130 to 170 °C typical [S]. Above about 180 °C, little extra hold and more damage [S]. | [S] | Use a set threshold and damage function. |
| Damping, collisions, hair-hair contact | Not researched in this pass | No data | Use standard strand models with contact radius of about d; see Bertails et al. 2006 for super-helix dynamics [S]. |

### 5.2 Bending anisotropy from ellipticity (derived)

For an ellipse with semi-axes a (major) and b (minor), e = a/b.
- Second moment about the axis for bending in the minor direction: I_x = π a b³ / 4 [D].
- Second moment for bending in the major direction: I_y = π a³ b / 4 [D].
- Ratio of stiffnesses (major-direction bending over minor-direction bending) = I_y / I_x = e² [D].

So an ellipticity of 1.35 gives a stiffness ratio of about 1.8, and 1.75 gives about 3.1 [D]. This is a strong argument for storing ellipticity per strand and computing two bending stiffnesses.

Diameter scaling for circular cross-sections: stiffness ratio = (d₁/d₂)⁴ [D]. Examples: 80 vs 60 µm gives 3.2; 70 vs 60 µm gives 1.9 [D].

### 5.3 Humidity and curl

- Disulfide bonds are fixed and do not respond to humidity [S]. Hydrogen bonds respond to water and reform on drying [S]. Swelling disrupts the cuticle [S].
- Wu's work on hair volume found that below about 75 percent RH the volume increase is smaller than the absorbed water volume. Above that, they are equal [S]. Density is therefore not a fixed constant and depends on RH [S].
- Recommendation: make a humidity state H in [0, 1] that drives (a) hydrogen-bond-governed curl relaxation, (b) swelling strain and ellipticity change, (c) extensibility above about 80 percent RH, and (d) wet E reduction.

---

## 6. Grooming and styling operations

### 6.1 Cutting

| Operation | Real-world technique | Typical DCC parameter names | Proposed engine parameters |
|---|---|---|---|
| Blunt cut | Straight across with shears; crisp, sharp edge; for structured ends [S, jatai.net] | Cut plane, length; Blender trim and smooth nodes exist [V, index] | Cut plane (normal, offset), tip thickness, hard length clamp |
| Point cut | Shears angled into the ends; soft, piecey, more movement [S] | Point depth, tip spread [H] | Tip-taper fraction per strand, random |
| Razor cut | Bevels the ends; more movement; frizz risk on fine or damaged hair [S, scissortec] | Taper amount [H] | Taper fraction, frizz coefficient; raised by damage state D |
| Thinning shears | Remove bulk while keeping length; typically 25 to 40 teeth [S] | Removal probability [H] | Strand-removal probability by region |
| Texturizing shears | Remove chunks; 5 to 24 teeth; chunkier texture [S] | Chunk size [H] | Removal chunk length and probability |
| Layering | Outcome of blunt or point technique, not a separate method [S, jatai.net] | Layer offset [H] | Layer lengths as a per-region length field |

### 6.2 Length and trim

| Operation | Real-world technique | Typical DCC parameter names | Proposed engine parameters |
|---|---|---|---|
| Clipper guard trim | Wahl guard lengths: #1 3 mm, #2 6 mm, #3 10 mm (9.5 exact), #4 13 mm (12.7 exact), #5 16 mm, #6 19 mm, #7 22 mm, #8 25 mm [S, wahl.co.uk; Battleborn chart]. Guard systems vary by brand [S]. | Length cap [H] | Per-region length clamp |
| Fade | Gradual change of guard length toward the nape or temples [H] | Length gradient [H] | 2D length field over the scalp |
| Shave | Length zero; leaves follicle stubble [H] | Length zero | Length zero with stubble mode (short, vellus-like diameter) |

### 6.3 Shape and direction

| Operation | Real-world technique | Typical DCC parameter names | Proposed engine parameters |
|---|---|---|---|
| Comb or brush direction | Sets flow; comb lines and brush pressure [H] | Direction field, smoothing [H] | Direction field on UV plus smoothing and root-lift |
| Part line | Seam with roots pushed to each side [H] | Seam curve, displacement falloff [H] | Seam curve and root displacement with falloff |
| Curl or straighten | Heat set (hydrogen bonds) or chemical perm (disulfide) [S]. Heat window in 5.1. | Blender Curl Hair Curves node exists [V, index]; no parameter list retrieved | Helix radius and pitch targets from curl index and wave count; set strength and humidity sensitivity |
| Braid | Three-strand interweave | Blender Braid Hair Curves node exists [V, index]; no parameter list retrieved | Bundle constraint chain |
| Twist and locs | Twisted sections matted into locs by felting [H] | None retrieved [H] | Clump with high cohesion, low tip spread |
| Ponytail and bun | Gather point with length constraint [H] | XGen Preserve Length (0 to 100) [S] | Gather constraint with length preservation and root tension |

### 6.4 Clumping, frizz, noise and gel

| Operation | Real-world technique | Typical DCC parameter names | Proposed engine parameters |
|---|---|---|---|
| Clumping (Blender) | Groups strands around guide strands [V, 3.5 manual] | Factor; Shape (0 constant, 0.5 linear); Tip Spread; Clump Offset; Distance Falloff; Distance Threshold; Seed; Preserve Length; Guide Distance; Guide Mask; Existing Guide Map [V] | Clump count, radius, tip spread, offset, falloff, length preservation |
| Clumping (XGen) | Strands pulled toward clump centers [S, Autodesk docs] | Clump Effect; Clump Scale (root to tip); Clump Volumize; Clump Variance; Preserve Length (0 to 100); Clump Points density; Seed; Noise; Noise Scale [S] | Same, plus volumize and variance; root-to-tip scale |
| Frizz | Small high-frequency displacement; frizz increases with humidity and damage [S] | Blender Frizz Hair Curves node exists [V, index]; no parameter list retrieved | Frizz amplitude and frequency as functions of H and D |
| Noise | Three-dimensional noise along strands [S, XGen] | XGen Noise: Frequency (per unit length); Magnitude; Magnitude Scale; Correlation (between neighbors); Preserve Length (0 to 100) [S]. Blender Hair Curves Noise node exists [V, index]. | Frequency, magnitude, magnitude scale, correlation, length preservation |
| Scraggle | Stacked noise layers at different frequencies [S, forum] | Not retrieved from docs [?] | Two noise layers at different frequencies |
| Gel and wax (wet look) | Clumps and smooth surface; higher IOR and lower roughness [H] | Coat (Blender): reduces roughness on the first diffuse bounce, 0 to 1 [V] | Wet look: IOR up toward wet preset, roughness down, clump up, coat |

Houdini Groom, Ornatrix and Yeti parameter names were not retrieved in this pass. Recheck those before building a mapping for them.

---

## 7. Recommended parametric data model

Organized by level. Each field needs a unit, a range, a default, a confidence tag and a source.

### 7.1 Population level (per body region R)

| Field | Units | Notes |
|---|---|---|
| Follicle density ρ_R | per cm² | Method tag required (trichoscopy, biopsy, dermoscopy). |
| Terminal fraction f_term | 0 to 1 | Remainder is vellus. |
| Vellus diameter | µm | Under 30 µm. |
| Terminal diameter distribution | µm, mean and SD | Conditioned on ancestry. |
| Growth rate v_R | mm/day | Scalp 0.30 to 0.35; eyebrow 0.15; eyelash 0.16; beard 0.38; axilla 0.4; pubic 0.3. |
| Anagen duration distribution T_R | days | Heavy-tailed for scalp and beard. Derive L_max = v × T. |
| Curl descriptor (i, w, CD) distribution | index, count, mm | Conditioned on ancestry and class. |
| Flow field F_R | unit vector on UV | From Kidd map (verify). |
| Clumping defaults | count, radius, cohesion | Per region. |
| Grey fraction g_R(age) | 0 to 1 | Rises with age. |
| Sex, age, ancestry modifiers | multipliers | Apply to density, diameter, anagen, growth. |

### 7.2 Strand level

| Field | Units | Default and range |
|---|---|---|
| Root position, length | mm | Length clamped by L_max. |
| Diameter d | µm | 60 to 80 terminal; 30 to 60 intermediate; under 30 vellus. |
| Ellipticity e (major/minor) | ratio | Ancestry-conditioned. Asian about 1.25; European about 1.35; African-American about 1.75 (secondary). |
| Medulla fraction m | 0 to 1 | Ancestry-conditioned, low confidence. |
| Scale angle α | degrees | 2.3 to 3.7 by origin (Omniverse). Default 3.0. |
| Curl: helix radius R, pitch p | mm | From i and w (section 3.5). |
| Kink events (4C) | per cm, angle | Heuristic. |
| Taper or cut state | fraction | From cutting ops. |
| Damage D | 0 to 1 | Raises porosity, frizz and friction anisotropy gap; lowers wet strength. |

### 7.3 Optical level

| Field | Units | Default and range |
|---|---|---|
| Eumelanin concentration | Artist 0 to 1 | Maps to q = −ln(max(1 − M, 0.0001)). |
| Pheomelanin redness r | 0 to 1 | Pheomelanin share. |
| Tint (dye) | RGB absorption | Added after melanin, not randomized. |
| Grey state | 0 to 1 | Greying suppresses eumelanin and pheomelanin. |
| Sun-bleaching L(s) | 0 to 1 along arc length | Pheomelanin decays faster. |
| Longitudinal roughness β_M | 0 to 1 | Default 0.2 (Omniverse). |
| Azimuthal roughness β_N | 0 to 1 | Default 0.2 when anisotropic. |
| IOR η | unitless | Default 1.55; wet preset higher. |
| Coat | 0 to 1 | Reduces first-bounce roughness. |
| Medulla scattering | Parameter | Unknown range. |
| Random factor per strand | Scalar | Blender uses randomFactor = 1 + 2 × (Random − 0.5) × RandomColor. |

### 7.4 State level (per simulation frame)

| Field | Range | Effects |
|---|---|---|
| Relative humidity H | 0 to 1 | Curl relaxation, swelling, ellipticity change, extensibility above about 80 percent RH. |
| Wetness W | 0 to 1 | E reduction, friction increase, IOR and clump increase. |
| Damage D | 0 to 1 | Porosity, frizz, friction gap, wet strength. |
| Set state S | 0 to 1 | Curl hold and decay. |
| Product P | Type and amount | Gel or wax: clump, IOR and roughness changes. |

### 7.5 Mechanics

| Field | Units | Notes |
|---|---|---|
| E_dry | GPa | Calibrated; range about 0.8 to 4 (unverified). |
| E_wet | GPa | About 0.4 (patent-derived). |
| Density ρ | g/cm³ | About 1.3 (patent default; verify). |
| Bending stiffness EI_major, EI_minor | N·m² | Derived from e and d (section 5.2). |
| Torsion stiffness GJ | N·m² | Not researched. |
| Friction μ_with, μ_against | unitless | Anisotropic; gap scales with D. Range 0.1 to 0.6 pending data. |
| Cohesion (wet) | model-specific | Capillary term from W; heuristic. |
| Elongation at break | strain | About 0.5 dry; higher when wet. |
| Set threshold and decay | °C, time | Heat window 130 to 170 °C. |

### 7.6 Calibration targets

Make these the acceptance tests before tuning appearance or physics:
1. Scalp counts by sub-region within the stated ranges for a chosen method.
2. Anagen-limited lengths match observed lengths for eyelash (4.5 to 9 mm), scalp (22 to 89 cm), and beard (11 to 37 mm for 4 to 14 weeks).
3. Bending anisotropy ratio matches e² for a set of strands with known ellipticity.
4. Humidity curl relaxation shows the 55 to 60 percent elongation plateau between 50 and 79 percent RH.
5. Heat-set holds with a threshold near 130 to 170 °C.

---

## 8. Open items and verification list

Priority order for a graphics engineer:

1. **d'Eon et al. 2011 section 6.1.** Confirm the eumelanin and pheomelanin absorption vectors and their units. Source: https://diglib.eg.org/items/a62ba8bb-e415-4395-9be6-9c9186ededfa (PDF link returned HTTP 403).
2. **Chiang et al. 2016 section 4.** Confirm roughness definitions, azimuthal logistic scale, and the absorption equation. Source: https://diglib.eg.org/handle/10.1111/cgf12830.
3. **Franbourg et al. 2003.** Obtain per-ancestry ellipticity values. Source: https://www.em-consulte.com/article/530401/article/current-research-on-ethnic-hair (paywalled listing).
4. **De La Mettrie et al. 2007 Methods section.** Confirm the definitions of CD, curl index and w, the class thresholds, and the sample. Source: https://bioone.org/journals/human-biology/volume-79/issue-3/hub.2007.0045/Shape-Variability-and-Classification-of-Human-Hair--A-Worldwide/10.1353/hub.2007.0045.full
5. **Young's modulus, dry and wet.** Obtain Robbins' tables. Resolve the dry value (3 to 4 GPa claimed vs about 1 GPa implied). Resolve the dry-to-wet ratio (2 to 3 times vs 3 to 11 times).
6. **Friction, directional.** Obtain Mizuno et al. 2013 (Langmuir) and Bhushan's *Biophysics of Human Hair* (Springer, 2010) chapter on tribology.
7. **Hair density.** Confirm 1.3 g/cm³ from Robbins or a primary measurement. Wool value is a stand-in only.
8. **Body-site counts and diameters.** Obtain the full Szabo 1967 paper (DOI 10.1098/RSTB.1967.0029, record: https://wikidp.org/Q29012971). Obtain modern trichoscopy or biopsy studies for trunk and limbs. None found in this pass.
9. **Beard anagen.** Resolve 4 to 14 weeks vs 2 to 6 years with a primary study.
10. **Kidd (1902) hair-direction chart.** Replace my background flow directions with values read from the chart.
11. **Blender deformation nodes.** Retrieve parameters for Frizz Hair Curves, Hair Curves Noise, Curl Hair Curves, Trim Hair Curves and Set Hair Curve Profile. The Blender 4.1 hair index only listed names in this pass. Source: https://docs.blender.org/manual/en/4.1/modeling/geometry_nodes/hair/index.html
12. **Houdini Groom, Ornatrix and Yeti.** Retrieve parameter lists for frizz, scraggle, curl and cut.
13. **Medulla parameters.** Retrieve Houdini medulla_diffuse and medulla_henyeygreenstein parameter lists. Source: https://www.sidefx.com/docs/houdini/vex/functions/chiang.html (names only in this pass).
14. **Sun-bleach gradient.** Obtain sectioned-hair photobleaching studies that measure lightness along the shaft.

---

## 9. Sources

Documentation and abstracts retrieved directly [V]:
- Blender Principled Hair BSDF manual: https://docs.blender.org/manual/en/latest/render/shader_nodes/shader/hair_principled.html
- Blender Clump Hair Curves (3.5 manual): https://docs.blender.org/manual/en/3.5/modeling/geometry_nodes/hair/guides/clump_hair_curves.html
- Blender Hair Nodes index (4.1 manual): https://docs.blender.org/manual/en/4.1/modeling/geometry_nodes/hair/index.html
- Houdini Chiang BSDF (VEX): https://www.sidefx.com/docs/houdini/vex/functions/chiang.html
- Omniverse OmniHair Specular parameters: https://docs-prod.omniverse.nvidia.com/materials-and-rendering/latest/templates/parameters/OmniHair_Specular.html
- De La Mettrie et al. 2007, Human Biology abstract: https://bioone.org/journals/human-biology/volume-79/issue-3/hub.2007.0045/Shape-Variability-and-Classification-of-Human-Hair--A-Worldwide/10.1353/hub.2007.0045.full
- d'Eon et al. 2011, abstract page: https://diglib.eg.org/items/a62ba8bb-e415-4395-9be6-9c9186ededfa

Abstracts, secondary summaries and search results [S]:
- Chiang et al. 2016, record: https://diglib.eg.org/handle/10.1111/cgf12830
- Marschner et al. 2003, record: https://graphics.stanford.edu/papers/hair/
- Hair ethnicity and ellipticity (preliminary study): https://www.cosmeticsandtoiletries.com/testing/invitro/premium-Hair-Ethnicity-and-Ellipticity--A-Preliminary-Study-201457141.html
- Franbourg et al. 2003 listing: https://www.em-consulte.com/article/530401/article/current-research-on-ethnic-hair
- Andre Walker system explainer: https://origenere.com/blogs/the-more-you-know-the-more-you-grow/the-andre-walker-hair-typing-system-explained
- Criticism of hair typing: https://afrocenchix.com/blogs/news/why-hair-typing-is-unscientific
- Scalp density (BioNumbers, 1965 trichogram): https://bionumbers.hms.harvard.edu/bionumber.aspx?id=116431
- Terminal hair reference: https://altmeyers.org/en/dermatology/terminal-hair-121389
- Vellus hair (Donovan clinic): https://donovanmedical.com/hair-blog/2017/8/28/vellus-hairs-on-the-scalp
- Thigh and upper arm hair cycle (1985): https://pubmed.ncbi.nlm.nih.gov/4015973/
- Eyelash counts and dimensions: https://en.wikipedia.org/wiki/Eyelash
- Lanugo (StatPearls): https://statpearls.com/sp/sr/92/36586/
- Lanugo (Cleveland Clinic): https://my.clevelandclinic.org/health/body/22487-lanugo
- Hair whorl: https://en.wikipedia.org/wiki/Hair_whorl
- Kidd body hair-flow maps: https://kottke.org/15/07/human-body-hair-flow-maps
- Blaschko lines: https://en.wikipedia.org/wiki/Blaschko%27s_lines
- Human hair growth (general): https://en.wikipedia.org/wiki/Human_hair_growth
- Korean phototrichogram (scalp growth by sex): https://search.bvsalud.org/gim/resource/en/wpr-67711
- 2026 growth-rate review (Spanish; body-site rates): https://www.medigraphic.com/pdfs/cosmetica/dcm-2026/dcm261q.pdf
- Szabo 1967 bibliographic record: https://wikidp.org/Q29012971
- IMCAS 2023 facial-hair abstract: https://www.imcas.com/zh/attend/imcas-world-congress-2023/program/session/54372
- Greying and sympathetic nerves (Nature 2020 summary): https://chiulab.med.harvard.edu/publications/hyperactivation-sympathetic-nerves-drives-depletion-melanocyte-stem-cells
- Age-induced greying and oxidative stress (review): https://pubmed.ncbi.nlm.nih.gov/24033376/
- Hair melanin content and photodamage (SCC library): https://library.scconline.org/is-cacheable/1708708695958/Hair-Melanin-Content-Photodamage.pdf
- Friction and wear of human hair fibres (Birmingham): https://research.birmingham.ac.uk/en/publications/friction-and-wear-of-human-hair-fibres/
- Friction, toward-root values (Journal of Oleo Science): https://www.jstage.jst.go.jp/article/jos/73/5/73_ess23245/_article
- Nanoscale tribology of hair fibres (Open University): https://oro.open.ac.uk/99735
- Heat styling effects on hair fiber (curling iron, 2004): https://pubmed.ncbi.nlm.nih.gov/15037918/
- Thermal styling trade-offs (SCC library): https://library.scconline.org/is-cacheable/Thermal-Styling-Efficacy-Convenience-Damage-Tradeoffs.pdf
- Haircut techniques: blunt vs point (Jatai): https://www.jatai.net/jataiacademy/blunt-cutting-vs-point-cutting-a-technical-deep-dive/
- Thinning vs texturizing shears (Scissor Tech): https://scissortec.com/blogs/news/the-difference-between-thinning-and-texturizing-shears
- Razor vs shear cutting (Scissor Tech): https://scissortec.com/blogs/news/is-there-a-difference-with-shear-hair-cutting-and-razor-hair-cutting
- Clipper cutting lengths (Wahl UK): https://www.wahl.co.uk/clipper-cutting-lengths/
- Clipper blade sizes chart (Battleborn): https://www.battlebornbladesharpening.com/technical-journal/clipper-blade-sizes-chart-complete-guide-for-all-brands-andis-oster-wahl
- XGen Clumping modifier (Autodesk, Maya 2017 help): https://help.autodesk.com/cloudhelp/2017/ENU/Maya/files/GUID-C3CDB895-8108-4A67-B96A-4EA306077D63.htm
- XGen Noise modifier (Autodesk, Maya 2017 help): https://help.autodesk.com/cloudhelp/2017/ENU/Maya/files/GUID-033AB4A2-DF63-4966-8052-DCF93F91C178.htm
- Super-Helices for predicting the dynamics of natural hair (SIGGRAPH history record): https://history.siggraph.org/?p=113612
- Super-Helix patent literature (search results, not opened; value-to-document mapping unverified): https://image-ppubs.uspto.gov/dirsearch-public/print/downloadPdf/8743124 , https://image-ppubs.uspto.gov/dirsearch-public/print/downloadPdf/8379015 , https://image-ppubs.uspto.gov/dirsearch-public/print/downloadPdf/8026911
- Lasisi 2016 (not extracted): https://www.amnh.org/content/download/410511/5944743/file/Lasisi - 2016 - Quantifying variation in human scalp hair.pdf
