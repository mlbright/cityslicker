// Usage: node scripts/shot.mjs "<query>" out.png [waitMs] [js-to-run-before-shot]
// Drives the installed Chrome against the dev server and saves a screenshot; prints console errors.
import { chromium } from 'playwright-core';
const [query = '', out = 'shot.png', wait = '8000', js = ''] = process.argv.slice(2);
const browser = await chromium.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.log(`[${m.type()}] ${m.text()}`); });
page.on('pageerror', (e) => console.log(`[pageerror] ${e.message}`));
await page.goto(`http://localhost:5173/${query}`);
await page.waitForTimeout(Number(wait));
if (js) console.log('eval:', JSON.stringify(await page.evaluate(js)));
await page.screenshot({ path: out });
await browser.close();
console.log(out);
