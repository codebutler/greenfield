// Launch an arbitrary web:// app in the compositor and screenshot.
// Usage: node run-url.js <web-url> <shot-name> [waitMs]
const puppeteer = require('puppeteer-core');

const APP_URL = process.argv[2] || 'web://localhost:9004/gf-hello.html';
const SHOT = process.argv[3] || 'shot-c.png';
const WAIT = parseInt(process.argv[4] || '12000', 10);

(async () => {
  const browser = await puppeteer.launch({
    executablePath: '/usr/bin/chromium-browser',
    headless: 'new',
    userDataDir: process.env.HOME + '/.cache/gf-chrome',
    args: [
      '--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage',
      '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
      '--ignore-gpu-blocklist', '--enable-features=SharedArrayBuffer', '--window-size=900,700',
    ],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 900, height: 700 });

  const logs = [];
  page.on('console', (m) => {
    const f = m.frame && m.frame();
    logs.push(`[${m.type()}${f ? ' @' + (f.url() || 'srcdoc') : ''}] ${m.text()}`);
  });
  page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
  page.on('workercreated', (w) => logs.push(`[worker+] ${w.url()}`));
  page.on('response', (r) => { if (r.status() >= 400) logs.push(`[http ${r.status()}] ${r.url()}`); });

  await page.goto('http://localhost:8080/', { waitUntil: 'networkidle2', timeout: 30000 });
  await new Promise((r) => setTimeout(r, 3000));
  await page.click('input[name="remote"]');
  await page.type('input[name="remote"]', APP_URL);
  await page.keyboard.press('Enter');
  await new Promise((r) => setTimeout(r, WAIT));

  logs.push('[info] iframe count = ' + (await page.evaluate(() => document.querySelectorAll('iframe').length)));
  logs.push('[info] document.title = ' + (await page.evaluate(() => document.title)));
  await page.screenshot({ path: __dirname + '/' + SHOT });

  console.log(logs.join('\n'));
  await browser.close();
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
