// Launch the (debug) C app in the compositor and capture its stdout/stderr,
// which the debug shell mirrors into the iframe DOM (#log) and posts to parent.
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
  page.on('pageerror', (e) => out.push(`[pageerror] ${e.message}`));

  await page.goto('http://localhost:8080/', { waitUntil: 'networkidle2', timeout: 30000 });
  // install a listener in the top page for gfhello_log messages
  await page.evaluate(() => {
    window.__gflogs = [];
    window.addEventListener('message', (e) => {
      if (e.data && e.data.gfhello_log) window.__gflogs.push(e.data.gfhello_log);
    });
  });
  await page.waitForSelector('input[name="remote"]', { timeout: 20000 });
  await page.click('input[name="remote"]');
  await page.type('input[name="remote"]', APP_URL);
  await page.keyboard.press('Enter');
  await new Promise((r) => setTimeout(r, 10000));

  const parentLogs = await page.evaluate(() => window.__gflogs || []);
  out.push('=== parent-received app logs ===');
  out.push(...parentLogs);

  // also read the iframe DOM #log directly
  for (const f of page.frames()) {
    if (f.url() === 'about:srcdoc') {
      const domlog = await f.evaluate(() => {
        const el = document.getElementById('log');
        return el ? el.textContent : '(no #log element)';
      }).catch((e) => '(eval failed: ' + e.message + ')');
      out.push('=== iframe #log DOM ===');
      out.push(domlog);
    }
  }
  out.push('=== title: ' + (await page.evaluate(() => document.title)));
  await page.screenshot({ path: __dirname + '/shot-c.png' });
  console.log(out.join('\n'));
  await browser.close();
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
