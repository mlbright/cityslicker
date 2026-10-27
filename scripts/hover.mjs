// Grows a city, hovers a Building and a Road, and opens the picker, saving screenshots.
import { chromium } from 'playwright-core';
const [query, out1, out2, wait = '14000'] = process.argv.slice(2);
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.on('pageerror', (e) => console.log(`[pageerror] ${e.message}`));
await page.goto(`http://localhost:5173/${query}`);
await page.waitForFunction(() => window.app);
await page.evaluate(() => window.app.playback.setSpeed(16));
await page.waitForTimeout(Number(wait));
// Find a screen point over a tall-ish Building near the view centre.
const pt = await page.evaluate(() => {
  const a = window.app;
  a.playback.mode = 'pause';
  const lots = [...a.timelapse.state.lots.values()].filter((l) => l.building && l.use !== 'park');
  const cam = a.stage.camera;
  let best = null;
  for (const l of lots) {
    const v = cam.position.clone();
    v.set(l.x + l.w / 2, 0.3, l.y + l.h / 2).project(cam);
    const x = (v.x + 1) / 2 * innerWidth, y = (1 - v.y) / 2 * innerHeight;
    const d = Math.hypot(x - innerWidth / 2, y - innerHeight / 2);
    if (!best || d < best.d) best = { x, y, d };
  }
  return best;
});
await page.mouse.move(pt.x - 10, pt.y - 10);
await page.mouse.move(pt.x, pt.y);
await page.waitForTimeout(600);
await page.screenshot({ path: out1 });
await page.mouse.move(5, 5);
await page.click('button[title="New city…"]');
await page.waitForTimeout(400);
await page.screenshot({ path: out2 });
await browser.close();
