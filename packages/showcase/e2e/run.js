const puppeteer = require('puppeteer-core');

(async () => {
  const browser = await puppeteer.launch({
    executablePath: '/usr/bin/chromium-browser',
    headless: 'new',
    userDataDir: process.env.HOME + '/.cache/gf-chrome',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--use-gl=angle',
      '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader',
      '--ignore-gpu-blocklist',
      '--enable-features=SharedArrayBuffer',
      '--window-size=900,700',
    ],
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 900, height: 700 });

  const logs = [];
  page.on('console', (m) => logs.push(`[console.${m.type()}] ${m.text()}`));
  page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}\n${e.stack || ''}`));
  page.on('requestfailed', (r) => logs.push(`[reqfailed] ${r.url()} :: ${r.failure() && r.failure().errorText}`));
  page.on('response', (r) => { if (r.status() >= 400) logs.push(`[http ${r.status()}] ${r.url()}`); });

  try {
    await page.goto('http://localhost:8080/', { waitUntil: 'networkidle2', timeout: 30000 });
  } catch (e) {
    logs.push('[goto-error] ' + e.message);
  }

  const coi = await page.evaluate(() => self.crossOriginIsolated);
  logs.push('[info] crossOriginIsolated = ' + coi);

  // wait a bit for main() / wasm init
  await new Promise((r) => setTimeout(r, 4000));

  const hasInput = await page.$('input[name="remote"]');
  logs.push('[info] input present after load = ' + !!hasInput);

  if (hasInput) {
    await page.click('input[name="remote"]');
    await page.type('input[name="remote"]', 'web://localhost:9002/app.html');
    await page.keyboard.press('Enter');
    // give the app time to connect, allocate SHM buffers, and paint a few frames
    await new Promise((r) => setTimeout(r, 9000));
  } else {
    // dump controls container html for diagnosis
    const html = await page.evaluate(() => {
      const c = document.getElementById('controls-container');
      return c ? c.outerHTML : '(no controls-container)';
    });
    logs.push('[controls-container] ' + html);
  }

  // report iframe presence + count
  const iframeCount = await page.evaluate(() => document.querySelectorAll('iframe').length);
  logs.push('[info] iframe count = ' + iframeCount);

  await page.screenshot({ path: __dirname + '/shot.png' });

  console.log(logs.join('\n'));
  await browser.close();
})().catch((e) => { console.error('FATAL', e); process.exit(1); });

process.on('exit', () => {});
