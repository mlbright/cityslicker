// Grows a city, turns on the Auto camera, then takes a Snapshot and saves the download.
import { chromium } from 'playwright-core';
const [query, outDir] = process.argv.slice(2);
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, acceptDownloads: true });
page.on('pageerror', (e) => console.log(`[pageerror] ${e.message}`));
await page.goto(`http://localhost:5173/${query}`);
await page.waitForFunction(() => window.app);
await page.evaluate(() => window.app.playback.setSpeed(16));
await page.waitForTimeout(8000);
const before = await page.evaluate(() => window.app.stage.controls.target.toArray().map((v) => +v.toFixed(1)));
await page.keyboard.press('a');
await page.waitForTimeout(6000);
const after = await page.evaluate(() => ({ target: window.app.stage.controls.target.toArray().map((v) => +v.toFixed(1)), auto: window.app.autoCam.enabled }));
console.log('auto camera target', before, '->', after.target, 'enabled', after.auto);
// Dragging the view hands the camera back.
await page.mouse.move(640, 300);
await page.mouse.down();
await page.mouse.move(700, 320, { steps: 5 });
await page.mouse.up();
console.log('after drag enabled', await page.evaluate(() => window.app.autoCam.enabled));
const [download] = await Promise.all([page.waitForEvent('download'), page.keyboard.press('p')]);
const path = `${outDir}/${download.suggestedFilename()}`;
await download.saveAs(path);
console.log('saved', path);
await browser.close();
