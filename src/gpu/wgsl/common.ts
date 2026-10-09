// Shared WGSL helpers.
export const commonWgsl = /* wgsl */ `
const PI = 3.14159265359;
const FLAG_GREY: u32 = 1u;
const FLAG_FLYAWAY: u32 = 2u;
const FLAG_LASH: u32 = 4u;

fn qmul(a: vec4f, b: vec4f) -> vec4f {
  return vec4f(a.w * b.xyz + b.w * a.xyz + cross(a.xyz, b.xyz), a.w * b.w - dot(a.xyz, b.xyz));
}
fn qrot(q: vec4f, v: vec3f) -> vec3f {
  let t = 2.0 * cross(q.xyz, v);
  return v + q.w * t + cross(q.xyz, t);
}
fn qconj(q: vec4f) -> vec4f { return vec4f(-q.xyz, q.w); }
/** Shortest rotation taking unit a onto unit b. */
fn qFromTo(a: vec3f, b: vec3f) -> vec4f {
  let c = dot(a, b);
  if (c < -0.99999) {
    var axis = cross(vec3f(1.0, 0.0, 0.0), a);
    if (dot(axis, axis) < 1e-6) { axis = cross(vec3f(0.0, 1.0, 0.0), a); }
    return vec4f(normalize(axis), 0.0);
  }
  let s = sqrt((1.0 + c) * 2.0);
  return vec4f(cross(a, b) / s, s * 0.5);
}
fn qnlerp(a: vec4f, b: vec4f, t: f32) -> vec4f {
  let bb = select(b, -b, dot(a, b) < 0.0);
  return normalize(mix(a, bb, t));
}
/** Rotate unit a toward unit b by fraction t of the angle between them. */
fn qPartial(a: vec3f, b: vec3f, t: f32) -> vec4f {
  return qnlerp(vec4f(0.0, 0.0, 0.0, 1.0), qFromTo(a, b), t);
}

fn pcg(v: u32) -> u32 {
  let state = v * 747796405u + 2891336453u;
  let word = ((state >> ((state >> 28u) + 4u)) ^ state) * 277803737u;
  return (word >> 22u) ^ word;
}
fn hash11(v: u32) -> f32 { return f32(pcg(v)) / 4294967295.0; }
fn hash31(v: u32) -> vec3f {
  let a = pcg(v);
  let b = pcg(a);
  let c = pcg(b);
  return vec3f(f32(a), f32(b), f32(c)) / 4294967295.0 * 2.0 - 1.0;
}
fn anyPerp(n: vec3f) -> vec3f {
  let a = select(vec3f(0.0, 1.0, 0.0), vec3f(1.0, 0.0, 0.0), abs(n.x) < 0.9);
  return normalize(cross(n, a));
}
`;
