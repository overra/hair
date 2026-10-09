// Groom kernels: grow rest shapes from roots, initialise guide state,
// and the interactive cut / shave / comb tools that edit rest shapes.
//
// restS layout is point-major: restS[i * S + s] = (body-space xyz, arc length).
export const groomWgsl = /* wgsl */ `
const GROW_SUB: u32 = 4u;

fn S() -> u32 { return L.$.params.counts.x; }
fn G() -> u32 { return L.$.params.counts.y; }
fn NP() -> u32 { return L.$.params.counts.z; }

fn helixShrink(r: f32, p: f32) -> f32 {
  if (r <= 0.0) { return 1.0; }
  let k = 2.0 * PI * r / max(p, 1e-5);
  return 1.0 / sqrt(1.0 + k * k);
}

/** Push a point out of the body so it sits at least 'shell' above the skin. */
fn keepOutside(p: vec3f, shell: f32) -> vec3f {
  let sd = bodySdf(p);
  if (sd < shell) { return p + bodyNormal(p) * (shell - sd); }
  return p;
}

@compute @workgroup_size(64)
fn grow(@builtin(global_invocation_id) gid: vec3u) {
  let s = gid.x;
  if (s >= S()) { return; }
  let st = L.$.statics[s];
  let n = NP();
  let flags = st.ids.z;
  let isLash = (flags & FLAG_LASH) != 0u;

  let coilShrink = helixShrink(st.coil.x, st.coil.y);
  let macroR = select(st.curl.x, 0.0, isLash);
  let macroP = st.curl.y;
  let Lc = st.root.w * coilShrink;           // centerline (macro curve) length
  let Lb = Lc * helixShrink(macroR, macroP); // backbone length
  let steps = (n - 1u) * GROW_SUB;
  let ds = Lb / f32(steps);

  let nrm = st.normal.xyz;
  let lift = st.normal.w;
  var p = st.root.xyz;
  var dir = normalize(st.flow.xyz * cos(lift) + nrm * sin(lift));
  var side = normalize(cross(dir, nrm));
  if (dot(side, side) < 0.5) { side = anyPerp(dir); }
  let shell = st.misc.z;
  let follow = st.misc.w;
  let droop = L.$.params.growth.x;
  let phase = st.coil.w;
  let down = vec3f(0.0, -1.0, 0.0);
  var arc = 0.0;
  var prevPt = p;

  for (var k = 0u; k <= steps; k++) {
    if (k % GROW_SUB == 0u) {
      let i = k / GROW_SUB;
      let b = cross(dir, side);
      var pt = p;
      if (macroR > 0.0) {
        // Ramp the helix in over the first few mm so the root stays on the skin.
        let ramp = smoothstep(0.0, 0.01, f32(k) * ds);
        let th = 2.0 * PI * f32(k) * ds / max(macroP, 1e-4) + phase;
        pt += (side * cos(th) + b * sin(th) - side) * macroR * ramp;
      }
      if (st.curl.z > 0.0) {
        let ramp = smoothstep(0.0, 0.01, f32(k) * ds);
        pt += side * st.curl.z * sin(2.0 * PI * f32(k) * ds / max(st.curl.w, 1e-4) + phase) * ramp;
      }
      if (i > 0u && !isLash) { pt = keepOutside(pt, shell * 0.5 + 0.0003); }
      if (i > 0u) { arc += distance(pt, prevPt); }
      prevPt = pt;
      L.$.restS[i * S() + s] = vec4f(pt, arc);
    }
    if (k == steps) { break; }

    if (isLash) {
      // Planar arc curling toward the flow direction (up for upper lashes).
      let bend = normalize(st.flow.xyz - dir * dot(st.flow.xyz, dir));
      dir = normalize(dir + bend * ds / max(st.curl.x, 1e-3));
    } else {
      let sd = bodySdf(p);
      if (sd < shell + 0.02) {
        let nb = bodyNormal(p);
        // Long hair only lies on skin that supports it against gravity
        // (upward-facing); it falls free past the underside of the head.
        let support = mix(1.0, smoothstep(-0.35, 0.25, nb.y), smoothstep(0.02, 0.08, st.root.w));
        let near = (1.0 - smoothstep(shell, shell + 0.015, sd)) * support;
        var tang = dir - nb * dot(dir, nb);
        if (dot(tang, tang) > 1e-8) { tang = normalize(tang); } else { tang = dir; }
        dir = normalize(dir + ds * (near * follow * 80.0 * (tang - dir) + down * droop * (1.0 - near * follow)));
        // Collide: never head into the skin inside the shell.
        if (sd < shell && dot(dir, nb) < 0.0) { dir = normalize(dir - nb * dot(dir, nb) + nb * 0.05); }
      } else {
        dir = normalize(dir + ds * down * droop);
      }
    }
    // Parallel-transport the side vector.
    side = side - dir * dot(side, dir);
    side = select(anyPerp(dir), normalize(side), dot(side, side) > 1e-8);
    p += dir * ds;
  }
}

/** Reset guide simulation state to the rest pose under the current model transform. */
@compute @workgroup_size(64)
fn initGuides(@builtin(global_invocation_id) gid: vec3u) {
  let g = gid.x;
  if (g >= G()) { return; }
  let s = L.$.guideStrand[g];
  for (var i = 0u; i < NP(); i++) {
    let r = L.$.restS[i * S() + s];
    let w = (F.$.frame.model * vec4f(r.xyz, 1.0)).xyz;
    L.$.gPos[i * G() + g] = vec4f(w, r.w);
    L.$.gPrev[i * G() + g] = vec4f(w, r.w);
    L.$.gQ[i * G() + g] = F.$.frame.modelRot;
  }
}

// ---------------------------------------------------------------- tools

fn projectToScreen(w: vec3f) -> vec3f {
  let c = F.$.frame.viewProj * vec4f(w, 1.0);
  let ndc = c.xyz / c.w;
  return vec3f((ndc.x * 0.5 + 0.5) * F.$.frame.viewport.x, (0.5 - ndc.y * 0.5) * F.$.frame.viewport.y, ndc.z);
}

/** Brush weight (0..1) for a world point, with occlusion against the scene depth. */
fn brushWeight(w: vec3f) -> f32 {
  let sp = projectToScreen(w);
  let d = distance(sp.xy, F.$.frame.brush.xy);
  let r = F.$.frame.brush.z;
  if (d > r || sp.z < 0.0 || sp.z > 1.0) { return 0.0; }
  let px = vec2i(clamp(sp.xy, vec2f(0.0), F.$.frame.viewport.xy - 1.0));
  let sceneZ = textureLoad(T.$.depth, px, 0);
  if (sp.z > sceneZ + 0.0015) { return 0.0; }
  let soft = F.$.frame.brush3.y;
  return 1.0 - smoothstep(r * (1.0 - soft), r, d);
}

var<private> tmp: array<vec4f, 64>;

/** Resample strand s's rest curve (and its guide state, if it is a guide) to a new length. */
fn resampleStrand(s: u32, newLen: f32) {
  let n = NP();
  let oldArc = L.$.restS[(n - 1u) * S() + s].w;
  if (oldArc <= 1e-6) { return; }
  let st = L.$.statics[s];
  let frac = clamp(newLen / st.root.w, 0.0, 1.0);
  let isGuide = L.$.guideStrand[st.ids.w] == s;
  for (var which = 0u; which < select(1u, 3u, isGuide); which++) {
    for (var i = 0u; i < n; i++) {
      if (which == 0u) { tmp[i] = L.$.restS[i * S() + s]; }
      else if (which == 1u) { tmp[i] = L.$.gPos[i * G() + st.ids.w]; }
      else { tmp[i] = L.$.gPrev[i * G() + st.ids.w]; }
    }
    // Arc lengths of this polyline (guide state stores rest arc in w; recompute).
    var acc = 0.0;
    tmp[0].w = 0.0;
    for (var i = 1u; i < n; i++) { acc += distance(tmp[i].xyz, tmp[i - 1u].xyz); tmp[i].w = acc; }
    let goal = acc * frac;
    var j = 1u;
    for (var i = 0u; i < n; i++) {
      let a = goal * f32(i) / f32(n - 1u);
      while (j < n - 1u && tmp[j].w < a) { j++; }
      let seg = max(tmp[j].w - tmp[j - 1u].w, 1e-9);
      let t = clamp((a - tmp[j - 1u].w) / seg, 0.0, 1.0);
      let p = mix(tmp[j - 1u].xyz, tmp[j].xyz, t);
      let restArc = oldArc * frac * f32(i) / f32(n - 1u);
      if (which == 0u) { L.$.restS[i * S() + s] = vec4f(p, restArc); }
      else if (which == 1u) { L.$.gPos[i * G() + st.ids.w] = vec4f(p, restArc); }
      else { L.$.gPrev[i * G() + st.ids.w] = vec4f(p, restArc); }
    }
  }
  L.$.statics[s].root.w = st.root.w * frac;
}

/**
 * Cut tool. Mode 1 (scissors): cut where the strand first enters the brush.
 * Mode 2 (clipper): trim strands rooted in the brush to the guard length.
 */
@compute @workgroup_size(64)
fn cut(@builtin(global_invocation_id) gid: vec3u) {
  let s = gid.x;
  if (s >= S()) { return; }
  let mode = u32(F.$.frame.brush.w);
  let M = L.$.params.counts.w;
  let len = L.$.statics[s].root.w;
  let minLen = 0.0003;
  if (mode == 1u) {
    for (var j = 0u; j < M; j++) {
      let w = brushWeight(L.$.render[s * M + j].xyz);
      if (w > 0.5) {
        let t = f32(j) / f32(M - 1u);
        let newLen = max(len * t, minLen);
        if (newLen < len * 0.999) { resampleStrand(s, newLen); }
        return;
      }
    }
  } else if (mode == 2u) {
    let w = brushWeight(L.$.render[s * M].xyz);
    if (w > 0.0) {
      let guard = max(F.$.frame.brush3.x, minLen);
      // Feather the guard toward the brush edge for blended fades.
      let goal = mix(len, min(len, guard), w);
      if (goal < len * 0.999) { resampleStrand(s, goal); }
    }
  }
}

/**
 * Comb tool: rotates rest segments inside the brush toward the drag direction,
 * carrying the rest of the strand (and its curl) rigidly with them.
 */
@compute @workgroup_size(64)
fn comb(@builtin(global_invocation_id) gid: vec3u) {
  let s = gid.x;
  if (s >= S()) { return; }
  let n = NP();
  let M = L.$.params.counts.w;
  let st = L.$.statics[s];
  let drag = F.$.frame.brush2.xyz;
  let strength = F.$.frame.brush2.w;
  if (dot(drag, drag) < 1e-10) { return; }
  let dragDir = normalize(drag);

  var hit = false;
  for (var i = 0u; i < n; i++) {
    tmp[i] = L.$.restS[i * S() + s];
    let j = (i * (M - 1u)) / max(n - 1u, 1u);
    let w = brushWeight(L.$.render[s * M + j].xyz);
    tmp[i].w = w; // reuse w as the brush weight; arc is rebuilt below
    hit = hit || w > 0.0;
  }
  if (!hit) { return; }
  let shell = st.misc.z * 0.5 + 0.0003;
  var q = vec4f(0.0, 0.0, 0.0, 1.0);
  var prevOld = tmp[0].xyz;
  var prevNew = tmp[0].xyz;
  var arc = 0.0;
  for (var i = 1u; i < n; i++) {
    let old = tmp[i].xyz;
    var seg = qrot(q, old - prevOld);
    let segLen = length(seg);
    let w = tmp[i - 1u].w;
    if (w > 0.0 && segLen > 1e-7) {
      let sd = seg / segLen;
      // Combing pulls toward the drag direction, never into the skin.
      let r = qPartial(sd, normalize(sd + dragDir * 2.0), clamp(w * strength, 0.0, 1.0));
      q = qmul(r, q);
      seg = qrot(r, seg);
    }
    var p = keepOutside(prevNew + seg, shell);
    p = prevNew + normalize(p - prevNew) * segLen;
    arc += segLen;
    L.$.restS[i * S() + s] = vec4f(p, arc);
    prevOld = old;
    prevNew = p;
  }
}
`;
