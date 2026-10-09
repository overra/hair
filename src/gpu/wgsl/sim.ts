// Guide strand dynamics: one thread per guide, marching root → tip.
//
// Each substep: Verlet integration, TressFX-style local shape matching in the
// parent segment's frame (keeps curls), root-anchored global shape (hold / gel),
// follow-the-leader inextensibility with DFTL velocity correction
// (Müller et al. 2012), and SDF body collision with friction.
// The rest→current rotation of every segment is written to gQ so render strands
// can be carried by their guide (including their curl offsets).
export const simWgsl = /* wgsl */ `
@compute @workgroup_size(64)
fn simulate(@builtin(global_invocation_id) gid: vec3u) {
  let g = gid.x;
  let G = L.$.params.counts.y;
  if (g >= G) { return; }
  let S = L.$.params.counts.x;
  let n = L.$.params.counts.z;
  let s = L.$.guideStrand[g];
  let st = L.$.statics[s];

  let dt = F.$.frame.time.y;
  let bend = L.$.params.sim.x;
  let hold = L.$.params.sim.y;
  let holdFalloff = L.$.params.sim.z;
  let damping = L.$.params.sim.w;
  let gravity = vec3f(0.0, -9.81 * L.$.params.sim2.x, 0.0);
  let friction = L.$.params.sim2.y;
  let dftl = L.$.params.sim2.z;
  let margin = L.$.params.sim2.w;
  let model = F.$.frame.model;
  let t = F.$.frame.time.x;

  // Per-substep stiffness from per-frame-ish user values (stable across substep counts).
  let substeps = max(F.$.frame.time.z, 1.0);
  let kLocal = 1.0 - pow(1.0 - clamp(bend, 0.0, 0.999), 1.0 / substeps);
  let keep = exp(-damping * 4.0 * dt);

  // Wind: base vector plus per-strand gusts.
  let gust = sin(t * 2.3 + hash11(st.ids.x) * 6.28) * 0.5 + sin(t * 5.1 + f32(g) * 0.37) * 0.3;
  let wind = F.$.frame.wind.xyz * (1.0 + F.$.frame.wind.w * gust);

  // Root follows the body exactly.
  let r0 = L.$.restS[s].xyz;
  let root = (model * vec4f(r0, 1.0)).xyz;
  let oldRoot = L.$.gPos[g].xyz;
  L.$.gPos[g] = vec4f(root, 0.0);
  L.$.gPrev[g] = vec4f(oldRoot, 0.0);
  var q = F.$.frame.modelRot;
  L.$.gQ[g] = q;

  var prevNew = root;
  var prevRest = r0;
  var pendIdx = 0u;           // point whose prev write is deferred (DFTL)
  var pendOld = vec3f(0.0);
  var pendValid = false;
  let total = max(L.$.restS[(n - 1u) * S + s].w, 1e-5);

  for (var i = 1u; i < n; i++) {
    let idx = i * G + g;
    let rest = L.$.restS[i * S + s];
    let restSeg = rest.xyz - prevRest;
    let segLen = length(restSeg);
    let x = L.$.gPos[idx].xyz;
    let xp = L.$.gPrev[idx].xyz;
    let u = rest.w / total;

    // Integrate (drag toward wind velocity is proportional to relative speed).
    let v = (x - xp) * keep;
    let windAcc = (wind * dt - v) * 0.6 / max(dt, 1e-5);
    var xn = x + v + (gravity + windAcc) * dt * dt;

    // Local shape: the rest segment carried by the parent's frame.
    let goal = prevNew + qrot(q, restSeg);
    xn = mix(xn, goal, kLocal);

    // Global shape: hold the groomed pose relative to the root.
    let hk = hold * exp(-holdFalloff * u);
    if (hk > 0.0) {
      let gt = (model * vec4f(rest.xyz, 1.0)).xyz;
      xn = mix(xn, gt, clamp(hk / substeps, 0.0, 1.0));
    }

    // Inextensibility (follow the leader).
    let d = xn - prevNew;
    let dl = max(length(d), 1e-9);
    var xc = prevNew + d * (segLen / dl);
    let corr = xc - xn;

    // Body collision with friction.
    var collided = false;
    let sd = bodySdf(xc);
    if (sd < margin) {
      xc += bodyNormal(xc) * (margin - sd);
      collided = true;
    }

    // DFTL: the parent's velocity absorbs part of this correction.
    if (pendValid) {
      L.$.gPrev[pendIdx] = vec4f(pendOld + corr * dftl, 0.0);
    }
    L.$.gPos[idx] = vec4f(xc, rest.w);
    var oldForVel = x;
    if (collided) { oldForVel = mix(x, xc, friction); }
    pendIdx = idx;
    pendOld = oldForVel;
    pendValid = true;

    // Advance the frame: rotate so the rest direction maps onto the new direction.
    if (segLen > 1e-9) {
      let restDirW = qrot(q, restSeg / segLen);
      let curDir = normalize(xc - prevNew);
      q = normalize(qmul(qFromTo(restDirW, curDir), q));
    }
    L.$.gQ[idx] = q;
    prevNew = xc;
    prevRest = rest.xyz;
  }
  if (pendValid) { L.$.gPrev[pendIdx] = vec4f(pendOld, 0.0); }
}
`;
