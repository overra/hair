// Headless smoke test: loads the app in Chromium (SwiftShader WebGPU),
// prints console output, and saves a screenshot.
// Usage: node scripts/screenshot.mjs <url> <out.png> [waitMs] [js-to-eval-before-shot]
import { chromium } from 'playwright';

const [url = 'http://localhost:5173/', out = 'shot.png', wait = '8000', script = ''] = process.argv.slice(2);
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH,
  args: ['--enable-unsafe-webgpu', '--use-gl=angle', '--use-angle=swiftshader', '--use-webgpu-adapter=swiftshader', '--enable-features=Vulkan', '--use-vulkan=swiftshader'],
});
const [vw, vh] = (process.env.VIEWPORT ?? '960x600').split('x').map(Number);
const page = await browser.newPage({ viewport: { width: vw, height: vh } });
page.on('console', (m) => console.log(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => console.log(`[pageerror] ${e.message}`));
await page.goto(url);
await page.waitForTimeout(Number(wait));
if (script) console.log('[eval]', await page.evaluate(script));
await page.screenshot({ path: out, timeout: 180000 });
await browser.close();
