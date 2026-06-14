// Discover and attach to EVERY worker target, capture console + exceptions.
const puppeteer = require('puppeteer-core');
const APP_URL = process.argv[2] || 'web://localhost:8080/gfapp/gf-hello.html';
(async () => {
  const browser = await puppeteer.launch({
    executablePath: '/usr/bin/chromium-browser', headless: 'new',
    userDataDir: process.env.HOME + '/.cache/gf-chrome',
    args: ['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist','--enable-features=SharedArrayBuffer'],
  });
  const page = await browser.newPage();
  const out = [];
  const client = await page.target().createCDPSession();
  const conn = client.connection();

  await client.send('Target.setDiscoverTargets', { discover: true });
  client.on('Target.targetCreated', async (e) => {
    const ti = e.targetInfo;
    if (ti.type !== 'worker' && ti.type !== 'shared_worker' && ti.type !== 'iframe') return;
    try {
      const { sessionId } = await client.send('Target.attachToTarget', { targetId: ti.targetId, flatten: true });
      const session = conn.session(sessionId);
      const tag = ti.type;
      session.on('Runtime.consoleAPICalled', (ev) => {
        const text = (ev.args || []).map((a) => a.value ?? a.description ?? '').join(' ');
        out.push(`[${tag}][${ev.type}] ${text}`);
      });
      session.on('Runtime.exceptionThrown', (ev) => {
        const d = ev.exceptionDetails;
        out.push(`[${tag}][EXC] ${d.exception ? (d.exception.description || d.exception.value) : d.text}`);
      });
      await session.send('Runtime.enable');
    } catch (err) { out.push(`[attach fail ${ti.type}] ${err.message}`); }
  });

  await page.goto('http://localhost:8080/', { waitUntil: 'networkidle2', timeout: 30000 });
  await page.waitForSelector('input[name="remote"]', { timeout: 20000 });
  await page.type('input[name="remote"]', APP_URL);
  await page.keyboard.press('Enter');
  await new Promise((r) => setTimeout(r, 11000));
  console.log(out.join('\n') || '(no worker/iframe console captured)');
  await browser.close();
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
