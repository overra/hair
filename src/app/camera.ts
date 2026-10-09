// Orbit camera.
import { invert, lookAt, multiply, perspective } from '../math/mat';

export class OrbitCamera {
  yaw = 0.35;
  pitch = 0.08;
  distance = 0.75;
  target: [number, number, number] = [0, 1.6, 0];
  fovY = (35 * Math.PI) / 180;
  aspect = 1;

  get eye(): [number, number, number] {
    const cp = Math.cos(this.pitch);
    return [
      this.target[0] + this.distance * cp * Math.sin(this.yaw),
      this.target[1] + this.distance * Math.sin(this.pitch),
      this.target[2] + this.distance * cp * Math.cos(this.yaw),
    ];
  }

  get proj() {
    return perspective(this.fovY, this.aspect, Math.max(0.005, this.distance * 0.02), this.distance * 20 + 10);
  }

  get view() {
    return lookAt(this.eye, this.target, [0, 1, 0]);
  }

  get viewProj() {
    return multiply(this.proj, this.view);
  }

  orbit(dx: number, dy: number) {
    this.yaw -= dx * 0.006;
    this.pitch = Math.max(-1.45, Math.min(1.45, this.pitch + dy * 0.006));
  }

  pan(dx: number, dy: number, viewportHeight: number) {
    const v = this.view;
    const s = (2 * this.distance * Math.tan(this.fovY / 2)) / viewportHeight;
    // Camera right = row 0, up = row 1 of the view rotation.
    for (let a = 0; a < 3; a++) this.target[a] += (-dx * v[a * 4] + dy * v[a * 4 + 1]) * s;
  }

  zoom(delta: number) {
    this.distance = Math.max(0.08, Math.min(6, this.distance * Math.exp(delta * 0.001)));
  }

  /** World-space ray through a pixel. */
  ray(x: number, y: number, w: number, h: number) {
    const inv = invert(this.viewProj);
    const nx = (x / w) * 2 - 1;
    const ny = 1 - (y / h) * 2;
    const p0 = unproject(inv, nx, ny, 0);
    const p1 = unproject(inv, nx, ny, 1);
    const dir = [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]];
    const l = Math.hypot(dir[0], dir[1], dir[2]);
    return { origin: p0, dir: [dir[0] / l, dir[1] / l, dir[2] / l] as [number, number, number] };
  }
}

function unproject(inv: Float32Array, x: number, y: number, z: number): [number, number, number] {
  const X = inv[0] * x + inv[4] * y + inv[8] * z + inv[12];
  const Y = inv[1] * x + inv[5] * y + inv[9] * z + inv[13];
  const Z = inv[2] * x + inv[6] * y + inv[10] * z + inv[14];
  const W = inv[3] * x + inv[7] * y + inv[11] * z + inv[15];
  return [X / W, Y / W, Z / W];
}
