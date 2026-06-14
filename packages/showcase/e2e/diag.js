const puppeteer = require('puppeteer-core');

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
    logs.push(`[console.${m.type()}${f ? ' @' + (f.url() || 'srcdoc') : ''}] ${m.text()}`);
  });
  page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
  page.on('frameattached', (f) => logs.push(`[frameattached] ${f.url()}`));
  page.on('framenavigated', (f) => logs.push(`[framenavigated] ${f.url()}`));
  page.on('response', (r) => { if (r.status() >= 400) logs.push(`[http ${r.status()}] ${r.url()}`); });

  await page.goto('http://localhost:8080/', { waitUntil: 'networkidle2', timeout: 30000 });
  await new Promise((r) => setTimeout(r, 3000));
  await page.click('input[name="remote"]');
  await page.type('input[name="remote"]', 'web://localhost:9002/app.html');
  await page.keyboard.press('Enter');
  await new Promise((r) => setTimeout(r, 8000));

  // inspect all frames
  logs.push('=== FRAMES ===');
  for (const f of page.frames()) {
    logs.push(`frame url=${JSON.stringify(f.url())} name=${f.name()}`);
    try {
      const info = await f.evaluate(() => ({
        base: document.querySelector('base') && document.querySelector('base').getAttribute('href'),
        baseURI: document.baseURI,
        scripts: [...document.querySelectorAll('script')].map((s) => s.src || '(inline)'),
        title: document.title,
        bodyLen: document.body ? document.body.innerHTML.length : -1,
      }));
      logs.push('   ' + JSON.stringify(info));
    } catch (e) {
      logs.push('   (evaluate failed: ' + e.message + ')');
    }
  }

  console.log(logs.join('\n'));
  await browser.close();
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
