// Drive the single-origin showcase: click each sample button, verify it renders,
// then drag the last window to prove the floating window manager works.
// Usage: node pw-showcase.js [baseUrl]
const { chromium } = require('playwright-core');
const BASE = process.argv[2] || 'http://localhost:8080/';

(async () => {
  const browser = await chromium.launch({
    executablePath: '/usr/bin/chromium-browser',
    args: ['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist','--enable-features=SharedArrayBuffer'],
  });
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 760 } });
  const page = await ctx.newPage();
  const logs = [];
  page.on('console', (m) => { const t = m.text(); if (/gf-hello|error|compositor|EXC/i.test(t)) logs.push(`[${m.type()}] ${t}`); });
  page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));

  await page.goto(BASE, { waitUntil: 'load', timeout: 30000 });
  // On a header-less static host, coi-serviceworker registers and reloads ONCE
  // to gain cross-origin isolation; that reload destroys the eval context, so
  // poll with retries that swallow "context destroyed" until it settles true.
  let coi = false;
  for (let i = 0; i < 30 && !coi; i++) {
    coi = await page.evaluate(() => self.crossOriginIsolated === true).catch(() => false);
    if (!coi) await page.waitForTimeout(700);
  }
  await page.waitForSelector('#toolbar', { timeout: 20000 });
  await page.waitForFunction(() => document.getElementById('status')?.textContent === 'ready', { timeout: 20000 }).catch(() => logs.push('[warn] status never became ready'));

  // Launch all three samples.
  for (const sel of ['simple-shm', 'webgl', 'gf-hello']) {
    await page.click(`button.sample[data-app*="${sel}"]`);
    await page.waitForTimeout(3500);
    logs.push(`[info] launched ${sel}; title="${await page.title()}"`);
  }
  await page.waitForTimeout(2000);
  // read isolation at a settled moment (after the SW reload + apps launched)
  logs.push('[info] crossOriginIsolated=' + await page.evaluate(() => self.crossOriginIsolated).catch(() => '?'));
  await page.screenshot({ path: __dirname + '/showcase-3apps.png' });

  // Drag test: press inside the top-left window area and move it.
  // (windows stack near the top-left; grab at ~150,180 and drag to ~620,470)
  await page.mouse.move(150, 190);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) {
    await page.mouse.move(150 + i * 47, 190 + i * 28);
    await page.waitForTimeout(30);
  }
  await page.mouse.up();
  await page.waitForTimeout(800);
  await page.screenshot({ path: __dirname + '/showcase-dragged.png' });

  console.log(logs.join('\n'));
  await browser.close();
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
