// Column-major 4x4 matrices and quaternions for WebGPU (clip z in [0, 1]).
export type M4 = Float32Array;
export type Q = [number, number, number, number]; // x, y, z, w

export const identity = (): M4 => new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);

export function multiply(a: M4, b: M4): M4 {
  const o = new Float32Array(16);
  for (let c = 0; c < 4; c++)
    for (let r = 0; r < 4; r++) {
      let s = 0;
      for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k];
      o[c * 4 + r] = s;
    }
  return o;
}

export function perspective(fovY: number, aspect: number, near: number, far: number): M4 {
  const f = 1 / Math.tan(fovY / 2);
  const o = new Float32Array(16);
  o[0] = f / aspect;
  o[5] = f;
  o[10] = far / (near - far);
  o[11] = -1;
  o[14] = (near * far) / (near - far);
  return o;
}

export function ortho(l: number, r: number, b: number, t: number, n: number, f: number): M4 {
  const o = identity();
  o[0] = 2 / (r - l);
  o[5] = 2 / (t - b);
  o[10] = 1 / (n - f);
  o[12] = -(r + l) / (r - l);
  o[13] = -(t + b) / (t - b);
  o[14] = n / (n - f);
  return o;
}

export function lookAt(eye: number[], target: number[], up: number[]): M4 {
  const z = norm([eye[0] - target[0], eye[1] - target[1], eye[2] - target[2]]);
  const x = norm(cross3(up, z));
  const y = cross3(z, x);
  return new Float32Array([
    x[0], y[0], z[0], 0,
    x[1], y[1], z[1], 0,
    x[2], y[2], z[2], 0,
    -dot3(x, eye), -dot3(y, eye), -dot3(z, eye), 1,
  ]);
}

export function invert(m: M4): M4 {
  const inv = new Float32Array(16);
  const [a00, a01, a02, a03, a10, a11, a12, a13, a20, a21, a22, a23, a30, a31, a32, a33] = m;
  const b00 = a00 * a11 - a01 * a10, b01 = a00 * a12 - a02 * a10, b02 = a00 * a13 - a03 * a10;
  const b03 = a01 * a12 - a02 * a11, b04 = a01 * a13 - a03 * a11, b05 = a02 * a13 - a03 * a12;
  const b06 = a20 * a31 - a21 * a30, b07 = a20 * a32 - a22 * a30, b08 = a20 * a33 - a23 * a30;
  const b09 = a21 * a32 - a22 * a31, b10 = a21 * a33 - a23 * a31, b11 = a22 * a33 - a23 * a32;
  const det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
  const id = 1 / det;
  inv[0] = (a11 * b11 - a12 * b10 + a13 * b09) * id;
  inv[1] = (a02 * b10 - a01 * b11 - a03 * b09) * id;
  inv[2] = (a31 * b05 - a32 * b04 + a33 * b03) * id;
  inv[3] = (a22 * b04 - a21 * b05 - a23 * b03) * id;
  inv[4] = (a12 * b08 - a10 * b11 - a13 * b07) * id;
  inv[5] = (a00 * b11 - a02 * b08 + a03 * b07) * id;
  inv[6] = (a32 * b02 - a30 * b05 - a33 * b01) * id;
  inv[7] = (a20 * b05 - a22 * b02 + a23 * b01) * id;
  inv[8] = (a10 * b10 - a11 * b08 + a13 * b06) * id;
  inv[9] = (a01 * b08 - a00 * b10 - a03 * b06) * id;
  inv[10] = (a30 * b04 - a31 * b02 + a33 * b00) * id;
  inv[11] = (a21 * b02 - a20 * b04 - a23 * b00) * id;
  inv[12] = (a11 * b07 - a10 * b09 - a12 * b06) * id;
  inv[13] = (a00 * b09 - a01 * b07 + a02 * b06) * id;
  inv[14] = (a31 * b01 - a30 * b03 - a32 * b00) * id;
  inv[15] = (a20 * b03 - a21 * b01 + a22 * b00) * id;
  return inv;
}

export function transformPoint(m: M4, p: number[]): [number, number, number] {
  const x = m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12];
  const y = m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13];
  const z = m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14];
  const w = m[3] * p[0] + m[7] * p[1] + m[11] * p[2] + m[15];
  return [x / w, y / w, z / w];
}

export function quatAxisAngle(axis: number[], angle: number): Q {
  const a = norm(axis);
  const s = Math.sin(angle / 2);
  return [a[0] * s, a[1] * s, a[2] * s, Math.cos(angle / 2)];
}

export function quatMul(a: Q, b: Q): Q {
  return [
    a[3] * b[0] + b[3] * a[0] + a[1] * b[2] - a[2] * b[1],
    a[3] * b[1] + b[3] * a[1] + a[2] * b[0] - a[0] * b[2],
    a[3] * b[2] + b[3] * a[2] + a[0] * b[1] - a[1] * b[0],
    a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
  ];
}

export function quatRotate(q: Q, v: number[]): [number, number, number] {
  const [x, y, z, w] = q;
  const tx = 2 * (y * v[2] - z * v[1]);
  const ty = 2 * (z * v[0] - x * v[2]);
  const tz = 2 * (x * v[1] - y * v[0]);
  return [
    v[0] + w * tx + (y * tz - z * ty),
    v[1] + w * ty + (z * tx - x * tz),
    v[2] + w * tz + (x * ty - y * tx),
  ];
}

export function quatConj(q: Q): Q {
  return [-q[0], -q[1], -q[2], q[3]];
}

/** Rigid transform: rotate by q about `pivot`, then translate by t. */
export function rigid(q: Q, pivot: number[], t: number[]): M4 {
  const [x, y, z, w] = q;
  const m = new Float32Array([
    1 - 2 * (y * y + z * z), 2 * (x * y + z * w), 2 * (x * z - y * w), 0,
    2 * (x * y - z * w), 1 - 2 * (x * x + z * z), 2 * (y * z + x * w), 0,
    2 * (x * z + y * w), 2 * (y * z - x * w), 1 - 2 * (x * x + y * y), 0,
    0, 0, 0, 1,
  ]);
  const rp = quatRotate(q, pivot);
  m[12] = pivot[0] - rp[0] + t[0];
  m[13] = pivot[1] - rp[1] + t[1];
  m[14] = pivot[2] - rp[2] + t[2];
  return m;
}

function cross3(a: number[], b: number[]) {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
function dot3(a: number[], b: number[]) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}
function norm(a: number[]) {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
}
