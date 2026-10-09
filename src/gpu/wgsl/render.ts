// Strand ribbons (vertex-pulled triangle strips, one instance per strand),
// skin, and shadow passes.
//
// Hair shading follows Karis 2016 ("Physically Based Hair Shading in Unreal"),
// an approximation of Marschner's R / TT / TRT lobes, with absorption derived
// from eumelanin / pheomelanin (d'Eon 2011, Chiang 2016) and a cheap
// deep-shadow transmittance from a front-most-hair depth map.
export const shadeCommonWgsl = /* wgsl */ `
/** Light visibility: body occlusion (PCF) times transmittance through hair. */
fn lightVisibility(world: vec3f, nrm: vec3f) -> f32 {
  let bias = F.$.frame.shadow.y;
  let lp = F.$.frame.lightViewProj * vec4f(world + nrm * bias, 1.0);
  let uv = vec2f(lp.x * 0.5 + 0.5, 0.5 - lp.y * 0.5);
  let z = lp.z;
  if (any(uv < vec2f(0.0)) || any(uv > vec2f(1.0)) || z > 1.0) { return 1.0; }
  let size = F.$.frame.shadow.z;
  let texel = 1.0 / size;
  var body = 0.0;
  var hairDepth = 0.0;
  for (var k = 0; k < 4; k++) {
    let o = vec2f(f32(k & 1) - 0.5, f32(k >> 1) - 0.5) * texel * 1.5;
    body += textureSampleCompareLevel(Sh.$.bodyShadow, Sh.$.cmp, uv + o, z - 0.0008);
    let px = vec2i(clamp((uv + o) * size, vec2f(0.0), vec2f(size - 1.0)));
    hairDepth += max(0.0, z - textureLoad(Sh.$.hairShadow, px, 0));
  }
  // Depth is linear for the orthographic light; shadow.w is its range in meters.
  let thickness = hairDepth * 0.25 * F.$.frame.shadow.w;
  return body * 0.25 * exp(-F.$.frame.shadow.x * thickness);
}

fn tonemap(c: vec3f) -> vec3f {
  // ACES fit (Narkowicz) + gamma for a non-sRGB swapchain.
  let x = c * 0.8;
  let m = clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), vec3f(0.0), vec3f(1.0));
  return pow(m, vec3f(1.0 / 2.2));
}

fn sky(n: vec3f) -> vec3f {
  return mix(vec3f(0.18, 0.16, 0.15), vec3f(0.35, 0.42, 0.55), n.y * 0.5 + 0.5);
}
`;

export const hairRenderWgsl = /* wgsl */ `
struct HairOut {
  @builtin(position) pos: vec4f,
  @location(0) tangent: vec3f,
  @location(1) world: vec3f,
  @location(2) @interpolate(flat) strand: u32,
  @location(3) t: f32,
  @location(4) coverage: f32,
  @location(5) side: f32,
}

struct Ribbon { p: vec3f, tangent: vec3f, width: f32 }

fn ribbonPoint(s: u32, j: u32) -> Ribbon {
  let M = D.$.params.counts.w;
  let base = s * M;
  let r = D.$.render[base + j];
  let a = D.$.render[base + max(j, 1u) - 1u].xyz;
  let b = D.$.render[base + min(j + 1u, M - 1u)].xyz;
  var t = b - a;
  t = select(vec3f(0.0, 1.0, 0.0), normalize(t), dot(t, t) > 1e-14);
  return Ribbon(r.xyz, t, r.w);
}

@vertex
fn hairVS(@builtin(vertex_index) vid: u32, @builtin(instance_index) s: u32) -> HairOut {
  let M = D.$.params.counts.w;
  let j = vid / 2u;
  let side = select(-1.0, 1.0, (vid & 1u) == 1u);
  let rb = ribbonPoint(s, j);
  let view = normalize(F.$.frame.camPos.xyz - rb.p);
  var perp = cross(rb.tangent, view);
  perp = select(anyPerp(rb.tangent), normalize(perp), dot(perp, perp) > 1e-10);
  let clip = F.$.frame.viewProj * vec4f(rb.p, 1.0);
  // World size of one pixel at this depth (camPos.w = projection[1][1]).
  let pixel = clip.w * 2.0 / (F.$.frame.viewport.y * F.$.frame.camPos.w);
  let w = max(rb.width, pixel * 0.85);
  var out: HairOut;
  let world = rb.p + perp * (w * 0.5 * side);
  out.pos = F.$.frame.viewProj * vec4f(world, 1.0);
  out.tangent = rb.tangent;
  out.world = world;
  out.strand = s;
  out.t = f32(j) / f32(M - 1u);
  out.coverage = clamp(rb.width / w, 0.0, 1.0);
  out.side = side;
  return out;
}

fn hairG(b: f32, x: f32) -> f32 {
  return exp(-0.5 * x * x / (b * b)) / (sqrt(2.0 * PI) * b);
}
fn fresnelSchlick(f0: f32, c: f32) -> f32 {
  return f0 + (1.0 - f0) * pow(1.0 - c, 5.0);
}

/** Absorption coefficient from pigments (d'Eon 2011 / Chiang 2016 spectral fit). */
fn pigmentSigma(eu: f32, pheo: f32) -> vec3f {
  return eu * vec3f(0.419, 0.697, 1.37) + pheo * vec3f(0.187, 0.4, 1.05);
}

struct HairLook { color: vec3f, roughness: f32 }

fn strandLook(s: u32, t: f32) -> HairLook {
  let st = D.$.statics[s];
  let P = D.$.params;
  let seed = st.ids.x;
  let jitter = 1.0 + 0.18 * hash31(seed).x;
  var sigma = pigmentSigma(P.look0.x * jitter, P.look0.y * jitter);
  if ((st.ids.z & FLAG_GREY) != 0u) { sigma *= 0.04; }
  // Sun bleaching toward the tip.
  sigma *= mix(1.0, 0.35, P.look0.z * t * t);
  // Per-pass transmittance through the fiber (path ≈ one diameter = 2 radii,
  // sigma in PBRT/Chiang radius-normalised units). Karis' lobes take this color.
  var color = exp(-2.0 * sigma);
  color = mix(color, P.look1.xyz, P.look0.w);
  // Wetness darkens (water fills cuticle gaps) and smooths.
  let wet = P.look2.w;
  color = pow(color, vec3f(1.0 + wet * 0.8));
  var rough = P.look1.w * mix(1.0, 0.55, wet) * mix(1.0, 0.75, P.look3.x);
  return HairLook(color, clamp(rough, 0.05, 1.0));
}

fn shadeHair(T: vec3f, V: vec3f, Lt: vec3f, look: HairLook, ior: f32, tilt: f32) -> vec3f {
  let sinL = clamp(dot(Lt, T), -1.0, 1.0);
  let sinV = clamp(dot(V, T), -1.0, 1.0);
  let cosThetaD = cos(0.5 * abs(asin(sinV) - asin(sinL)));
  let lp = Lt - T * sinL;
  let vp = V - T * sinV;
  let cosPhi = dot(lp, vp) * inverseSqrt(dot(lp, lp) * dot(vp, vp) + 1e-4);
  let cosHalfPhi = sqrt(clamp(0.5 + 0.5 * cosPhi, 0.0, 1.0));
  let f0 = pow((1.0 - ior) / (1.0 + ior), 2.0);
  let b2 = look.roughness * look.roughness;
  let shift = tilt;
  var S = vec3f(0.0);
  // R
  let mR = hairG(max(b2, 0.02), sinL + sinV + 2.0 * shift);
  S += vec3f(mR * 0.25 * cosHalfPhi * fresnelSchlick(f0, sqrt(clamp(0.5 + 0.5 * dot(V, Lt), 0.0, 1.0))));
  // TT
  let mTT = hairG(max(b2 * 0.5, 0.01), sinL + sinV - shift);
  let a = 1.0 / (1.19 / cosThetaD + 0.36 * cosThetaD);
  let h = cosHalfPhi * (1.0 + a * (0.6 - 0.8 * cosPhi));
  let fTT = fresnelSchlick(f0, cosThetaD * sqrt(clamp(1.0 - h * h, 0.0, 1.0)));
  let tTT = pow(look.color, vec3f(0.5 * sqrt(clamp(1.0 - h * h * a * a, 0.0, 1.0)) / cosThetaD));
  S += mTT * exp(-3.65 * cosPhi - 3.98) * (1.0 - fTT) * (1.0 - fTT) * tTT;
  // TRT
  let mTRT = hairG(max(b2 * 2.0, 0.04), sinL + sinV - 4.0 * shift);
  let fTRT = fresnelSchlick(f0, cosThetaD * 0.5);
  let tTRT = pow(look.color, vec3f(0.8 / cosThetaD));
  S += mTRT * exp(17.0 * cosPhi - 16.78) * (1.0 - fTRT) * (1.0 - fTRT) * fTRT * tTRT;
  // Multiple scattering approximation (Kajiya-Kay style diffuse).
  let kk = sqrt(clamp(1.0 - sinL * sinL, 0.0, 1.0));
  S += look.color * kk * (0.35 / PI) * mix(1.0, 0.5, sinL * sinV * 0.5 + 0.5);
  return S;
}

struct HairFrag {
  @location(0) color: vec4f,
  @builtin(sample_mask) mask: u32,
}

/**
 * Stochastic coverage: a sub-pixel strand covers round(coverage * MSAA) samples,
 * rounded stochastically and placed at random sample positions, so many thin
 * strands sum to the right average opacity (stochastic transparency).
 */
fn coverageMask(frag: vec4f, strand: u32, coverage: f32) -> u32 {
  let h = pcg((u32(frag.x) * 73856093u) ^ (u32(frag.y) * 19349663u) ^ (strand * 83492791u));
  let r = f32(h & 0xffffu) / 65535.0;
  let n = u32(clamp(floor(coverage * 4.0 + r), 0.0, 4.0));
  if (n == 0u) { return 0u; }
  let m = 0xfu >> (4u - n);
  let rot = (h >> 16u) & 3u;
  return ((m << rot) | (m >> (4u - rot))) & 0xfu;
}

@fragment
fn hairFS(in: HairOut) -> HairFrag {
  let mask = coverageMask(in.pos, in.strand, in.coverage);
  if (mask == 0u) { discard; }
  let T = normalize(in.tangent);
  let V = normalize(F.$.frame.camPos.xyz - in.world);
  let Lt = normalize(F.$.frame.lightDir.xyz);
  let look = strandLook(in.strand, in.t);
  let vis = lightVisibility(in.world, vec3f(0.0));
  let direct = shadeHair(T, V, Lt, look, D.$.params.look2.z, D.$.params.look2.y) * F.$.frame.lightDir.w * vis;
  // Ambient: hemisphere light filtered by the fiber color, darker toward the root.
  let amb = sky(normalize(V + vec3f(0.0, 0.5, 0.0))) * look.color * mix(0.35, 0.7, in.t);
  let c = direct + amb;
  return HairFrag(vec4f(tonemap(c), 1.0), mask);
}

// ---------------------------------------------------------------- shadows

@vertex
fn hairShadowVS(@builtin(vertex_index) vid: u32, @builtin(instance_index) s: u32) -> @builtin(position) vec4f {
  let j = vid / 2u;
  let side = select(-1.0, 1.0, (vid & 1u) == 1u);
  let rb = ribbonPoint(s, j);
  let Lt = normalize(F.$.frame.lightDir.xyz);
  var perp = cross(rb.tangent, Lt);
  perp = select(anyPerp(rb.tangent), normalize(perp), dot(perp, perp) > 1e-10);
  // Widen to a light-space texel so thin hair still registers.
  let texelWorld = F.$.frame.shadow.w / F.$.frame.shadow.z;
  let w = max(rb.width, texelWorld * 0.5);
  return F.$.frame.lightViewProj * vec4f(rb.p + perp * (w * 0.5 * side), 1.0);
}
`;

export const bodyRenderWgsl = /* wgsl */ `
struct BodyOut {
  @builtin(position) pos: vec4f,
  @location(0) world: vec3f,
  @location(1) normal: vec3f,
}

@vertex
fn bodyVS(@location(0) position: vec3f, @location(1) normal: vec3f) -> BodyOut {
  var out: BodyOut;
  let w = (F.$.frame.model * vec4f(position, 1.0)).xyz;
  out.world = w;
  out.normal = qrot(F.$.frame.modelRot, normal);
  out.pos = F.$.frame.viewProj * vec4f(w, 1.0);
  return out;
}

@fragment
fn bodyFS(in: BodyOut) -> @location(0) vec4f {
  let N = normalize(in.normal);
  let V = normalize(F.$.frame.camPos.xyz - in.world);
  let Lt = normalize(F.$.frame.lightDir.xyz);
  let skin = vec3f(0.62, 0.42, 0.33);
  let ndl = dot(N, Lt);
  // Wrapped diffuse with a reddish terminator as a cheap subsurface hint.
  let wrap = clamp((ndl + 0.3) / 1.3, 0.0, 1.0);
  let sss = vec3f(1.0, 0.45, 0.3) * clamp((ndl + 0.5) / 1.5, 0.0, 1.0) * (1.0 - wrap) * 0.25;
  let vis = lightVisibility(in.world, N);
  let H = normalize(Lt + V);
  let spec = pow(max(dot(N, H), 0.0), 40.0) * 0.08 * step(0.0, ndl);
  let direct = (skin * wrap + sss + spec) * F.$.frame.lightDir.w * vis;
  let c = direct + skin * sky(N) * 0.6;
  return vec4f(tonemap(c), 1.0);
}

@vertex
fn bodyShadowVS(@location(0) position: vec3f, @location(1) normal: vec3f) -> @builtin(position) vec4f {
  let w = (F.$.frame.model * vec4f(position, 1.0)).xyz;
  return F.$.frame.lightViewProj * vec4f(w, 1.0);
}
`;
