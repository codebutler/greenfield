// Playwright harness: launch a web:// app in the compositor, capture console
// from the page, all frames, AND web workers (emscripten pthread worker),
// then screenshot. Usage: node pw-run.js <web-url> <shot> [waitMs]
const { chromium } = require('playwright-core');

const APP_URL = process.argv[2] || 'web://localhost:8080/gfapp/gf-hello.html';
const SHOT = process.argv[3] || 'shot-c.png';
const WAIT = parseInt(process.argv[4] || '13000', 10);

(async () => {
  const browser = await chromium.launch({
    executablePath: '/usr/bin/chromium-browser',
    args: [
      '--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage',
      '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
      '--ignore-gpu-blocklist', '--enable-features=SharedArrayBuffer',
    ],
  });
  const context = await browser.newContext({ viewport: { width: 900, height: 700 } });
  const page = await context.newPage();
  const logs = [];

  page.on('console', (m) => logs.push(`[page.${m.type()}] ${m.text()}`));
  page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
  // Workers anywhere in the page (incl. inside the srcdoc iframe).
  page.on('worker', (w) => {
    logs.push(`[worker+] ${w.url()}`);
    w.on('console', (m) => logs.push(`[worker.${m.type()}] ${m.text()}`));
  });
  context.on('weberror', (e) => logs.push(`[weberror] ${e.error().message}`));

  await page.goto('http://localhost:8080/', { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForSelector('input[name="remote"]', { timeout: 20000 });
  await page.fill('input[name="remote"]', APP_URL);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(WAIT);

  logs.push('[info] title=' + (await page.title()));
  logs.push('[info] iframes=' + page.frames().length);
  await page.screenshot({ path: __dirname + '/' + SHOT });
  console.log(logs.join('\n'));
  await browser.close();
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
