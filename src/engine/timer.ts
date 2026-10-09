// GPU pass timing via timestamp queries (no-op when the feature is missing).
export class GpuTimer {
  readonly enabled: boolean;
  private querySet: GPUQuerySet | null = null;
  private resolveBuf: GPUBuffer | null = null;
  private readBufs: GPUBuffer[] = [];
  private busy = new Set<GPUBuffer>();
  private next = 0;
  /** Smoothed milliseconds per named pass. */
  readonly ms: Record<string, number> = {};

  constructor(device: GPUDevice, private names: string[]) {
    this.enabled = device.features.has('timestamp-query');
    for (const n of names) this.ms[n] = 0;
    if (!this.enabled) return;
    const count = names.length * 2;
    this.querySet = device.createQuerySet({ type: 'timestamp', count });
    this.resolveBuf = device.createBuffer({ size: count * 8, usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC });
    for (let i = 0; i < 3; i++) {
      this.readBufs.push(device.createBuffer({ size: count * 8, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST }));
    }
  }

  writes(name: string) {
    if (!this.querySet) return undefined;
    const i = this.names.indexOf(name);
    return { querySet: this.querySet, beginningOfPassWriteIndex: 2 * i, endOfPassWriteIndex: 2 * i + 1 };
  }

  private pending: GPUBuffer | null = null;

  resolve(enc: GPUCommandEncoder) {
    if (!this.querySet || !this.resolveBuf) return;
    const buf = this.readBufs[this.next];
    if (this.busy.has(buf)) return; // skip a frame rather than stall
    this.next = (this.next + 1) % this.readBufs.length;
    enc.resolveQuerySet(this.querySet, 0, this.names.length * 2, this.resolveBuf, 0);
    enc.copyBufferToBuffer(this.resolveBuf, 0, buf, 0, this.names.length * 16);
    this.pending = buf;
  }

  readback() {
    const buf = this.pending;
    if (!buf) return;
    this.pending = null;
    this.busy.add(buf);
    buf.mapAsync(GPUMapMode.READ).then(() => {
      const t = new BigInt64Array(buf.getMappedRange());
      this.names.forEach((n, i) => {
        const dt = Number(t[2 * i + 1] - t[2 * i]) / 1e6;
        if (dt >= 0 && dt < 1000) this.ms[n] = this.ms[n] * 0.9 + dt * 0.1;
      });
      buf.unmap();
      this.busy.delete(buf);
    }, () => this.busy.delete(buf));
  }

  get total() {
    return Object.values(this.ms).reduce((a, b) => a + b, 0);
  }
}
