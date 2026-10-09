import GUI from 'lil-gui';
import { meshBody } from './body/mesher';
import { LANDMARKS, raycastBody } from './body/sdf';
import { OrbitCamera } from './app/camera';
import { HairLayer } from './engine/hairLayer';
import { type FrameState, Renderer, TOOL_CLIP, TOOL_COMB, TOOL_CUT, TOOL_HAND } from './engine/renderer';
import { Hand, capsuleMesh, defaultHand } from './app/hand';
import { REGIONS, type RegionId, defaultCharacter } from './groom/atlas';
import { CURL_TYPES, type CurlType, PIGMENTS, type RegionParams, applyCurlType } from './groom/params';
import { STYLES, applyStyle } from './groom/styles';
import { invert, lookAt, multiply, ortho, quatAxisAngle, quatConj, quatMul, quatRotate, rigid, transformPoint, type Q } from './math/mat';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const canvas = $<HTMLCanvasElement>('gfx');
const hud = $<HTMLDivElement>('hud');
const brushEl = $<HTMLDivElement>('brush');
const overlay = $<HTMLDivElement>('overlay');
const say = (msg: string | null) => {
  overlay.textContent = msg ?? '';
  overlay.classList.toggle('hidden', msg === null);
};
const nextFrame = () => new Promise((r) => requestAnimationFrame(r));

type ToolName = 'orbit' | 'cut' | 'clipper' | 'comb' | 'hand';

const query = new URLSearchParams(location.search);
const state = {
  character: defaultCharacter(),
  densityScale: Number(query.get('density') ?? 0.6),
  selected: 'scalp' as RegionId,
  style: 'Shoulder wavy (2B)',
  sim: { substeps: 2, paused: query.has('pause'), wind: 0, windAzimuth: 90, turbulence: 0.6, shake: false },
  light: { azimuth: 35, elevation: 40, intensity: 1.8, shadowDensity: 220 },
  tool: { mode: (query.get('tool') ?? 'orbit') as ToolName, radius: 40, guardMm: 3, strength: 1, falloff: 0.5 },
  hand: defaultHand(),
};

async function main() {
  say('Initialising WebGPU…');
  let renderer: Renderer;
  try {
    renderer = await Renderer.create(canvas);
  } catch (e) {
    say(`${(e as Error).message}\nUse a WebGPU-capable browser (Chrome/Edge 113+, Safari 26, Firefox 141+).`);
    return;
  }
  say('Meshing body…');
  await nextFrame();
  const mesh = meshBody(0.004);
  renderer.setBody(mesh);

  HairLayer.widthScale = Number(query.get('width') ?? 1);
  const params = new Map<RegionId, RegionParams>(REGIONS.map((r) => [r.id, r.defaults()]));
  // ?regions=scalp,beard limits which regions are grown (debugging / benchmarking).
  const only = query.get('regions')?.split(',');
  if (only) for (const [id, p] of params) p.enabled = only.includes(id);
  applyStyle(params.get('scalp')!, state.style);
  const layers = new Map<RegionId, HairLayer>(REGIONS.map((r) => [r.id, new HairLayer(renderer.root, r, params.get(r.id)!)]));
  renderer.layers = [...layers.values()];

  const rebuild = async (ids: RegionId[]) => {
    say('Growing hair…');
    await nextFrame();
    await nextFrame();
    for (const id of ids) layers.get(id)!.rebuild(mesh, state.character, state.densityScale);
    say(null);
  };
  await rebuild(REGIONS.map((r) => r.id));

  // Regeneration is debounced so slider drags don't rebuild every tick.
  const dirty = new Set<RegionId>();
  let timer = 0;
  const regen = (ids: RegionId[]) => {
    ids.forEach((i) => dirty.add(i));
    clearTimeout(timer);
    timer = window.setTimeout(() => { const list = [...dirty]; dirty.clear(); rebuild(list); }, 350);
  };

  // ------------------------------------------------------------ GUI
  const gui = new GUI({ title: 'Hair' });
  const ch = gui.addFolder('Character');
  const allIds = REGIONS.map((r) => r.id);
  ch.add(state, 'densityScale', 0.05, 1.5, 0.05).name('density scale').onChange(() => regen(allIds));
  ch.add(state.character, 'androgen', 0, 1, 0.01).onChange(() => regen(allIds));
  ch.add(state.character, 'hairLoss', 0, 1, 0.01).name('hair loss').onChange(() => regen(['scalp']));
  ch.add(state.character, 'usePart').name('part line').onChange(() => regen(['scalp']));
  ch.add(state.character, 'part', -1, 1, 0.01).name('part position').onChange(() => regen(['scalp']));
  ch.add(state.character, 'whorlSpin', -1, 1, 0.1).name('whorl spin').onChange(() => regen(['scalp']));
  ch.add(state.character, 'fringe', 0, 1, 0.01).name('fringe / bangs').onChange(() => regen(['scalp']));
  ch.add(state.character, 'seed', 1, 999, 1).onChange(() => regen(allIds));
  ch.add(state, 'style', Object.keys(STYLES)).name('scalp style').onChange((name: string) => {
    const p = params.get('scalp')!;
    const fresh = REGIONS[0].defaults();
    Object.assign(p.shape, fresh.shape);
    Object.assign(p.physics, fresh.physics);
    applyStyle(p, name);
    buildRegionFolder();
    regen(['scalp']);
  });

  const regionNames = Object.fromEntries(REGIONS.map((r) => [r.label, r.id]));
  gui.add(state, 'selected', regionNames).name('edit region').onChange(() => buildRegionFolder());
  let regionFolder: GUI | null = null;
  const pigment = { preset: 'brown', curl: '1B' as CurlType };
  function buildRegionFolder() {
    regionFolder?.destroy();
    const id = state.selected;
    const p = params.get(id)!;
    const layer = layers.get(id)!;
    const f = gui.addFolder(REGIONS.find((r) => r.id === id)!.label);
    regionFolder = f;
    const re = () => regen([id]);
    const up = () => layer.writeParams();
    f.add(p, 'enabled').onChange(re);
    const sh = f.addFolder('Shape');
    sh.add(pigment, 'curl', Object.keys(CURL_TYPES)).name('curl type (1A–4C)').onChange((t: CurlType) => {
      applyCurlType(p.shape, t);
      sh.controllersRecursive().forEach((c) => c.updateDisplay());
      re();
    });
    const sp = p.shape;
    sh.add(sp, 'density', 0, 400, 1).name('density /cm²').onChange(re);
    sh.add(sp, 'length', 0.0005, 0.8, 0.0005).name('length (m)').onChange(re);
    sh.add(sp, 'lengthVar', 0, 1, 0.01).name('length variation').onChange(re);
    sh.add(sp, 'diameter', 10, 180, 1).name('diameter (µm)').onChange(re);
    sh.add(sp, 'rootLift', 0, 90, 1).name('root lift (°)').onChange(re);
    sh.add(sp, 'surfaceFollow', 0, 1, 0.01).name('surface follow').onChange(re);
    sh.add(sp, 'volume', 0, 0.08, 0.001).name('volume (m)').onChange(re);
    sh.add(sp, 'waveAmp', 0, 0.03, 0.0005).name('wave amplitude').onChange(re);
    sh.add(sp, 'wavePeriod', 0.01, 0.15, 0.001).name('wave period').onChange(re);
    sh.add(sp, 'curlRadius', 0, 0.03, 0.0005).name('curl radius').onChange(re);
    sh.add(sp, 'curlPitch', 0.004, 0.1, 0.001).name('curl pitch').onChange(re);
    sh.add(sp, 'coilRadius', 0, 0.004, 0.0001).name('coil radius').onChange(re);
    sh.add(sp, 'coilPitch', 0.002, 0.02, 0.0005).name('coil pitch').onChange(re);
    sh.add(sp, 'kink', 0, 1, 0.01).onChange(re);
    sh.add(sp, 'curlVar', 0, 1, 0.01).name('curl variation').onChange(re);
    sh.add(sp, 'frizz', 0, 1, 0.01).onChange(re);
    sh.add(sp, 'flyaway', 0, 0.2, 0.005).onChange(re);
    sh.add(sp, 'clumpSize', 1, 60, 1).name('clump size').onChange(re);
    sh.add(sp, 'clumpStrength', 0, 1, 0.01).name('clump strength').onChange(re);
    sh.add(sp, 'tipTaper', 0.02, 1, 0.01).name('tip taper').onChange(up);
    sh.close();
    const lk = f.addFolder('Look');
    const l = p.look;
    lk.add(pigment, 'preset', Object.keys(PIGMENTS)).name('natural color').onChange((k: keyof typeof PIGMENTS) => {
      [l.eumelanin, l.pheomelanin] = PIGMENTS[k];
      lk.controllersRecursive().forEach((c) => c.updateDisplay());
      up();
    });
    lk.add(l, 'eumelanin', 0, 10, 0.01).onChange(up);
    lk.add(l, 'pheomelanin', 0, 6, 0.01).onChange(up);
    lk.add(l, 'grey', 0, 1, 0.01).name('grey fraction').onChange(re);
    lk.addColor(l, 'dyeColor').name('dye color').onChange(up);
    lk.add(l, 'dye', 0, 1, 0.01).name('dye amount').onChange(up);
    lk.add(l, 'tipBleach', 0, 1, 0.01).name('sun bleach').onChange(up);
    lk.add(l, 'roughness', 0.05, 1, 0.01).name('long. roughness').onChange(up);
    lk.add(l, 'azimuthalRoughness', 0.05, 1, 0.01).name('azim. roughness').onChange(up);
    lk.add(l, 'cuticleTilt', 0, 8, 0.1).name('cuticle tilt (°)').onChange(up);
    lk.add(l, 'ior', 1.3, 1.8, 0.01).onChange(up);
    lk.add(l, 'wetness', 0, 1, 0.01).onChange(up);
    lk.add(l, 'oiliness', 0, 1, 0.01).onChange(up);
    const ph = f.addFolder('Physics');
    const y = p.physics;
    ph.add(y, 'bendStiffness', 0, 1, 0.01).name('bend stiffness').onChange(up);
    ph.add(y, 'hold', 0, 1, 0.01).name('hold (gel)').onChange(up);
    ph.add(y, 'holdFalloff', 0, 8, 0.1).name('hold falloff').onChange(up);
    ph.add(y, 'damping', 0, 5, 0.01).onChange(up);
    ph.add(y, 'gravity', 0, 3, 0.01).onChange(up);
    ph.add(y, 'friction', 0, 1, 0.01).onChange(up);
    f.add({ regrow: () => re() }, 'regrow').name('regrow region');
  }
  buildRegionFolder();

  const tools = gui.addFolder('Tools');
  const toolCtl = tools.add(state.tool, 'mode', ['orbit', 'cut', 'clipper', 'comb', 'hand']).name('tool');
  tools.add(state.tool, 'radius', 5, 200, 1).name('brush radius (px)');
  tools.add(state.tool, 'falloff', 0, 1, 0.01).name('brush falloff');
  tools.add(state.tool, 'guardMm', 0.3, 50, 0.1).name('clipper guard (mm)');
  tools.add(state.tool, 'strength', 0, 1, 0.01).name('comb strength');
  tools.add({ regrowAll: () => regen(allIds) }, 'regrowAll').name('regrow all hair');
  const handF = tools.addFolder('Hand (fingers through hair)');
  handF.add(state.hand, 'fingers', 1, 5, 1);
  handF.add(state.hand, 'spacing', 0.01, 0.04, 0.001).name('finger spacing (m)');
  handF.add(state.hand, 'radius', 0.004, 0.015, 0.0005).name('finger radius (m)');
  handF.add(state.hand, 'friction', 0, 1, 0.01).name('finger friction');
  handF.add(state.hand, 'depth', 0, 0.03, 0.001).name('fingertip height (m)');
  handF.close();

  const simF = gui.addFolder('Simulation');
  simF.add(state.sim, 'substeps', 1, 8, 1);
  simF.add(state.sim, 'paused');
  simF.add(state.sim, 'shake').name('shake head');
  simF.add(state.sim, 'wind', 0, 8, 0.1).name('wind (m/s)');
  simF.add(state.sim, 'windAzimuth', 0, 360, 1).name('wind direction');
  simF.add(state.sim, 'turbulence', 0, 2, 0.01);
  let resetSim = false;
  simF.add({ reset: () => { resetSim = true; } }, 'reset').name('reset to rest');

  const lightF = gui.addFolder('Light');
  lightF.add(state.light, 'azimuth', -180, 180, 1);
  lightF.add(state.light, 'elevation', -10, 89, 1);
  lightF.add(state.light, 'intensity', 0, 8, 0.1);
  lightF.add(state.light, 'shadowDensity', 0, 1000, 1).name('hair shadow density');
  lightF.close();
  simF.close();

  // ------------------------------------------------------------ input
  const cam = new OrbitCamera();
  if (query.has('yaw')) cam.yaw = (Number(query.get('yaw')) * Math.PI) / 180;
  if (query.has('pitch')) cam.pitch = (Number(query.get('pitch')) * Math.PI) / 180;
  if (query.has('dist')) cam.distance = Number(query.get('dist'));
  if (query.has('ty')) cam.target[1] = Number(query.get('ty'));
  if (query.has('tx')) cam.target[0] = Number(query.get('tx'));
  if (query.has('tz')) cam.target[2] = Number(query.get('tz'));
  let headYaw = 0;
  let headTilt = 0;
  let drag: { button: number; x: number; y: number; shift: boolean } | null = null;
  const mouse = { x: -1e4, y: -1e4, dx: 0, dy: 0 };
  let toolActive = false;
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture(e.pointerId);
    drag = { button: e.button, x: e.clientX, y: e.clientY, shift: e.shiftKey };
    toolActive = e.button === 0 && !e.shiftKey && !e.altKey && state.tool.mode !== 'orbit';
  });
  canvas.addEventListener('pointermove', (e) => {
    mouse.dx += e.clientX - mouse.x;
    mouse.dy += e.clientY - mouse.y;
    mouse.x = e.clientX;
    mouse.y = e.clientY;
    if (!drag) return;
    const dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;
    drag.x = e.clientX;
    drag.y = e.clientY;
    if (drag.button === 2 && drag.shift) cam.pan(dx, dy, canvas.clientHeight);
    else if (drag.button === 1) cam.pan(dx, dy, canvas.clientHeight);
    else if (drag.button === 2 || (drag.button === 0 && (state.tool.mode === 'orbit' || e.altKey) && !drag.shift)) cam.orbit(dx, dy);
    else if (drag.button === 0 && drag.shift) { headYaw += dx * 0.01; headTilt = Math.max(-0.6, Math.min(0.6, headTilt + dy * 0.01)); }
  });
  const end = () => { drag = null; toolActive = false; };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);
  canvas.addEventListener('wheel', (e) => { e.preventDefault(); cam.zoom(e.deltaY); }, { passive: false });
  window.addEventListener('keydown', (e) => {
    const map: Record<string, ToolName> = { '1': 'orbit', '2': 'cut', '3': 'clipper', '4': 'comb', '5': 'hand' };
    if (map[e.key]) toolCtl.setValue(map[e.key]);
    if (e.key === 'f') {
      // Focus on the point under the cursor.
      const r = cam.ray(mouse.x, mouse.y, canvas.clientWidth, canvas.clientHeight);
      const t = raycastBody(r.origin, r.dir);
      if (t > 0) cam.target = [r.origin[0] + r.dir[0] * t, r.origin[1] + r.dir[1] * t, r.origin[2] + r.dir[2] * t];
    }
  });

  // ------------------------------------------------------------ loop
  let last = performance.now();
  let time = 0;
  let frame = 0;
  let fps = 0;
  const neck = [0, 1.5, -0.02];
  const hand = new Hand();
  let lastModel = rigid([0, 0, 0, 1], neck, [0, 0, 0]);
  const loop = () => {
    const now = performance.now();
    const realDt = Math.min(0.05, (now - last) / 1000);
    last = now;
    fps = fps * 0.95 + (1 / Math.max(realDt, 1e-4)) * 0.05;
    const dpr = Math.min(window.devicePixelRatio, 2);
    renderer.resize(canvas.clientWidth * dpr, canvas.clientHeight * dpr);
    cam.aspect = renderer.width / renderer.height;

    const simDt = state.sim.paused ? 0 : realDt;
    time += simDt;
    let yaw = headYaw;
    let tilt = headTilt;
    if (state.sim.shake) {
      yaw += Math.sin(time * 7) * 0.45;
      tilt += Math.sin(time * 4.3) * 0.12;
    }
    const q: Q = quatMul(quatAxisAngle([0, 1, 0], yaw), quatAxisAngle([1, 0, 0], tilt));
    const model = rigid(q, neck, [0, 0, 0]);
    lastModel = model;

    const Ldir = [
      Math.cos((state.light.elevation * Math.PI) / 180) * Math.sin((state.light.azimuth * Math.PI) / 180),
      Math.sin((state.light.elevation * Math.PI) / 180),
      Math.cos((state.light.elevation * Math.PI) / 180) * Math.cos((state.light.azimuth * Math.PI) / 180),
    ] as [number, number, number];
    const R = Math.max(0.25, Math.min(1.1, cam.distance * 0.55));
    const tgt = cam.target;
    const lEye = [tgt[0] + Ldir[0] * (2 * R + 0.1), tgt[1] + Ldir[1] * (2 * R + 0.1), tgt[2] + Ldir[2] * (2 * R + 0.1)];
    const lightView = lookAt(lEye, tgt, Math.abs(Ldir[1]) > 0.99 ? [0, 0, 1] : [0, 1, 0]);
    const near = 0.05;
    const far = 4 * R + 0.2;
    const lightViewProj = multiply(ortho(-R, R, -R, R, near, far), lightView);

    // Brush: drag direction in body space for combing.
    const v = cam.view;
    const right = [v[0], v[4], v[8]];
    const upv = [v[1], v[5], v[9]];
    const scale = (cam.distance * Math.tan(cam.fovY / 2) * 2) / canvas.clientHeight;
    const dragW = [0, 1, 2].map((a) => (right[a] * mouse.dx - upv[a] * mouse.dy) * scale);
    mouse.dx = mouse.dy = 0;
    const dragBody = quatRotate(quatConj(q), dragW);
    const toolMode = { orbit: 0, cut: TOOL_CUT, clipper: TOOL_CLIP, comb: TOOL_COMB, hand: TOOL_HAND }[state.tool.mode];

    // Hand: posed in body space from the mouse ray, simulated in world space.
    let handCaps: FrameState['hand']['capsules'] = [];
    let handDisp = [0, 0, 0];
    if (state.tool.mode === 'hand') {
      const ray = cam.ray(mouse.x, mouse.y, canvas.clientWidth, canvas.clientHeight);
      const qi = quatConj(q);
      hand.update(
        transformPoint(invert(model), ray.origin),
        quatRotate(qi, ray.dir),
        quatRotate(qi, right),
        toolActive,
        state.hand,
      );
      handCaps = hand.capsules.map((c) => ({ a: transformPoint(model, c.a), b: transformPoint(model, c.b), r: c.r }));
      handDisp = quatRotate(q, hand.displacement);
      const m = capsuleMesh(hand.capsules);
      renderer.setHandMesh(m.vertices, m.indices);
    } else {
      renderer.setHandMesh(new Float32Array(0), new Uint32Array(0));
    }
    const az = (state.sim.windAzimuth * Math.PI) / 180;

    const fs: FrameState = {
      model,
      modelRot: q,
      viewProj: cam.viewProj,
      proj11: cam.proj[5],
      camPos: cam.eye,
      lightViewProj,
      lightDir: Ldir,
      lightIntensity: state.light.intensity,
      lightDepthRange: far - near,
      time,
      dt: Math.max(simDt, 1e-5) / state.sim.substeps,
      substeps: state.sim.paused ? 0 : state.sim.substeps,
      frame,
      wind: [Math.sin(az) * state.sim.wind, 0, Math.cos(az) * state.sim.wind],
      turbulence: state.sim.turbulence,
      brush: {
        x: mouse.x * dpr,
        y: mouse.y * dpr,
        radius: state.tool.radius * dpr,
        mode: toolMode,
        drag: dragBody,
        strength: state.tool.strength,
        guard: state.tool.guardMm / 1000,
        falloff: state.tool.falloff,
        active: toolActive && toolMode !== 0,
      },
      shadowDensity: state.light.shadowDensity,
      resetSim,
      hand: { capsules: handCaps, displacement: handDisp, friction: state.hand.friction, margin: 0.0008 },
    };
    resetSim = false;
    renderer.render(fs);
    frame++;

    brushEl.style.display = state.tool.mode === 'orbit' || state.tool.mode === 'hand' ? 'none' : 'block';
    brushEl.style.left = `${mouse.x}px`;
    brushEl.style.top = `${mouse.y}px`;
    brushEl.style.width = brushEl.style.height = `${state.tool.radius * 2}px`;
    brushEl.style.borderColor = toolActive ? '#ffb347' : '#fff9';

    if (frame % 10 === 0) {
      const strands = renderer.layers.filter((l) => l.active).reduce((a, l) => a + l.strands, 0);
      const guides = renderer.layers.filter((l) => l.active).reduce((a, l) => a + l.guides, 0);
      const t = renderer.timer;
      hud.textContent =
        `${fps.toFixed(0)} fps  ${(1000 / fps).toFixed(2)} ms\n` +
        (t.enabled
          ? `gpu  sim ${t.ms.sim.toFixed(2)}  shadow ${t.ms.shadow.toFixed(2)}  main ${t.ms.main.toFixed(2)}  = ${t.total.toFixed(2)} ms\n`
          : 'gpu  (timestamp-query unavailable)\n') +
        `${strands.toLocaleString()} strands · ${guides.toLocaleString()} simulated guides\n` +
        `${renderer.width}×${renderer.height} · tool: ${state.tool.mode}`;
    }
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
  // Expose for debugging and automated checks.
  Object.assign(window, { hair: { renderer, state, layers, cam, LANDMARKS, hand, model: () => lastModel } });
}

main();
