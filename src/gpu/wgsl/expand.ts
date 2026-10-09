// Render-strand generation (every frame, one thread per strand):
//  1. carry the strand's rest curve with its guide (single-guide interpolation,
//     rest offsets rotated by the guide's per-segment frames),
//  2. clump toward the clump leader,
//  3. Catmull-Rom up-sample from N sim points to M render points,
//  4. add micro coils (with kinks), frizz, and width taper.
// render[s * M + j] = (world xyz, ribbon width in m).
export const expandWgsl = /* wgsl */ `
var<private> base: array<vec3f, 64>;
var<private> lead: array<vec3f, 64>;

fn S() -> u32 { return L.$.params.counts.x; }
fn G() -> u32 { return L.$.params.counts.y; }
fn NP() -> u32 { return L.$.params.counts.z; }

/** Deformed sim-resolution point i of strand s, driven by its guide. */
fn carried(s: u32, i: u32) -> vec3f {
  let n = NP();
  let g = L.$.statics[s].ids.w;
  let gs = L.$.guideStrand[g];
  let r = L.$.restS[i * S() + s];
  let lg = L.$.restS[(n - 1u) * S() + gs].w;
  let u = select(0.0, r.w / lg * f32(n - 1u), lg > 1e-7);
  var j = u32(floor(u));
  var f = u - f32(j);
  if (j >= n - 1u) { j = n - 2u; f = 1.0; }
  let ia = j * G() + g;
  let ib = (j + 1u) * G() + g;
  let gp = mix(L.$.gPos[ia].xyz, L.$.gPos[ib].xyz, f);
  let gq = qnlerp(L.$.gQ[ia], L.$.gQ[ib], f);
  let gr = mix(L.$.restS[j * S() + gs].xyz, L.$.restS[(j + 1u) * S() + gs].xyz, f);
  var off = r.xyz - gr;
  if (u > f32(n - 1u)) {
    // Strand longer than its guide: continue rigidly past the guide tip.
    off = r.xyz - L.$.restS[(n - 1u) * S() + gs].xyz;
  }
  return gp + qrot(gq, off);
}

fn catmull(p0: vec3f, p1: vec3f, p2: vec3f, p3: vec3f, t: f32) -> vec3f {
  let t2 = t * t;
  let t3 = t2 * t;
  return 0.5 * ((2.0 * p1) + (-p0 + p2) * t + (2.0 * p0 - 5.0 * p1 + 4.0 * p2 - p3) * t2 + (-p0 + 3.0 * p1 - 3.0 * p2 + p3) * t3);
}

fn sampleBase(u: f32) -> vec3f {
  let n = NP();
  let i = min(u32(floor(u)), n - 2u);
  let t = u - f32(i);
  let p1 = base[i];
  let p2 = base[i + 1u];
  let p0 = select(2.0 * p1 - p2, base[max(i, 1u) - 1u], i > 0u);
  let p3 = select(2.0 * p2 - p1, base[min(i + 2u, n - 1u)], i + 2u < n);
  return catmull(p0, p1, p2, p3, t);
}

/** Kinked coil profile: blends a circle toward a zig-zag as kink → 1. */
fn coilShape(th: f32, kink: f32) -> vec2f {
  let c = cos(th);
  let s = sin(th);
  let tri = vec2f(1.0 - 4.0 * abs(fract(th / (2.0 * PI) + 0.25) - 0.5), 1.0 - 4.0 * abs(fract(th / (2.0 * PI)) - 0.5));
  return mix(vec2f(c, s), tri, kink);
}

@compute @workgroup_size(64)
fn expand(@builtin(global_invocation_id) gid: vec3u) {
  let s = gid.x;
  if (s >= S()) { return; }
  let n = NP();
  let M = L.$.params.counts.w;
  let st = L.$.statics[s];
  let len = st.root.w;
  let seed = st.ids.x;

  for (var i = 0u; i < n; i++) { base[i] = carried(s, i); }

  // Clumping: pull toward the leader, increasingly toward the tip.
  let leader = st.ids.y;
  let clump = st.misc.y * (1.0 + L.$.params.look2.w * 1.5 + L.$.params.look3.x * 0.5);
  if (leader != s && clump > 0.0) {
    for (var i = 0u; i < n; i++) { lead[i] = carried(leader, i); }
    let profile = L.$.params.growth.y;
    let rootL = lead[0];
    let rootS = base[0];
    for (var i = 1u; i < n; i++) {
      let u = f32(i) / f32(n - 1u);
      // Compare shapes relative to roots so clumps don't drag roots together.
      let goal = lead[i] - rootL + rootS;
      base[i] = mix(base[i], mix(goal, lead[i], 0.8), clamp(clump * pow(u, profile), 0.0, 1.0));
    }
  }

  let coilR = st.coil.x;
  let coilP = max(st.coil.y, 1e-4);
  let kink = st.coil.z;
  let frizz = st.misc.x;
  let diameter = st.flow.w * L.$.params.look3.z;
  let tipTaper = max(L.$.params.look3.y, 0.02);
  let seg = len / f32(M - 1u);

  var prev = base[0];
  var tan = normalize(base[1] - base[0]);
  var side = anyPerp(tan);
  var th = st.coil.w;
  for (var j = 0u; j < M; j++) {
    let t = f32(j) / f32(M - 1u);
    let c = sampleBase(t * f32(n - 1u));
    if (j > 0u) {
      let nt = c - prev;
      if (dot(nt, nt) > 1e-14) {
        let ntn = normalize(nt);
        side = side - ntn * dot(side, ntn);
        side = select(anyPerp(ntn), normalize(side), dot(side, side) > 1e-8);
        tan = ntn;
      }
    }
    prev = c;
    var p = c;
    if (coilR > 0.0) {
      // Coil arc length per render step uses the true fiber length.
      th += 2.0 * PI * seg * (1.0 / sqrt(1.0 + pow(2.0 * PI * coilR / coilP, 2.0))) / coilP;
      let jitter = 1.0 + 0.25 * kink * hash31(seed + j).x;
      let ramp = smoothstep(0.0, 0.004, t * len);
      let cs = coilShape(th, kink) * coilR * jitter * ramp;
      p += side * cs.x + cross(tan, side) * cs.y;
    }
    if (frizz > 0.0) {
      p += hash31(seed * 7u + j * 13u) * frizz * 0.004 * t * t * min(len / 0.05, 1.0);
    }
    let tipT = clamp((1.0 - t) / tipTaper, 0.0, 1.0);
    let width = diameter * mix(0.15, 1.0, sqrt(tipT));
    L.$.render[s * M + j] = vec4f(p, width);
  }
}
`;
