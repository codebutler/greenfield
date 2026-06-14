// Launch the C app in the compositor, then reach INTO the app iframe to see
// whether its script ran (Module present, crossOriginIsolated, worker created)
// and log all /gfapp/ network requests + their status.
const puppeteer = require('puppeteer-core');
const APP_URL = process.argv[2] || 'web://localhost:8080/gfapp/gf-hello.html';

(async () => {
  const browser = await puppeteer.launch({
    executablePath: '/usr/bin/chromium-browser', headless: 'new',
    userDataDir: process.env.HOME + '/.cache/gf-chrome',
    args: ['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist','--enable-features=SharedArrayBuffer','--window-size=900,700'],
  });
  const page = await browser.newPage();
  const out = [];
  page.on('request', (r) => { if (r.url().includes('/gfapp/')) out.push(`[req] ${r.url()}`); });
  page.on('response', (r) => { if (r.url().includes('/gfapp/')) out.push(`[res ${r.status()} ${r.headers()['content-type']||''}] ${r.url()}`); });
  page.on('pageerror', (e) => out.push(`[pageerror] ${e.message}`));

  await page.goto('http://localhost:8080/', { waitUntil: 'networkidle2', timeout: 30000 });
  await new Promise((r) => setTimeout(r, 3000));
  await page.click('input[name="remote"]');
  await page.type('input[name="remote"]', APP_URL);
  await page.keyboard.press('Enter');
  await new Promise((r) => setTimeout(r, 8000));

  for (const f of page.frames()) {
    out.push(`--- frame ${JSON.stringify(f.url())} ---`);
    try {
      const info = await f.evaluate(() => ({
        coi: self.crossOriginIsolated,
        hasModule: typeof window.Module,
        sab: typeof SharedArrayBuffer,
        baseURI: document.baseURI,
        scripts: [...document.querySelectorAll('script')].map((s) => s.src || s.textContent.slice(0, 40)),
        bodyText: (document.body && document.body.innerText || '').slice(0, 200),
      }));
      out.push('   ' + JSON.stringify(info));
    } catch (e) { out.push('   (eval failed: ' + e.message + ')'); }
  }
  console.log(out.join('\n'));
  await browser.close();
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
