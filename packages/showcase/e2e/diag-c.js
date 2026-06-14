// Deep diagnostic: auto-attach to ALL targets (iframe + emscripten pthread
// workers) via CDP and forward their console + exceptions, so we can see what
// the C/WASM app prints and any errors it throws.
const puppeteer = require('puppeteer-core');

const APP_URL = process.argv[2] || 'web://localhost:8080/gfapp/gf-hello.html';
const WAIT = parseInt(process.argv[3] || '13000', 10);

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

  // Auto-attach to every target (page, iframes, workers) and forward logs.
  const client = await page.target().createCDPSession();
  await client.send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: true, flatten: true });
  client.on('Target.attachedToTarget', async (event) => {
    const { sessionId, targetInfo } = event;
    const session = client.connection().session(sessionId);
    if (!session) return;
    const tag = `${targetInfo.type}:${(targetInfo.url || '').slice(-40)}`;
    logs.push(`[ATTACH] ${targetInfo.type} ${targetInfo.url}`);
    try {
      session.on('Runtime.consoleAPICalled', (e) => {
        const text = (e.args || []).map((a) => a.value ?? a.description ?? a.unserializableValue ?? '').join(' ');
        logs.push(`[${tag}][${e.type}] ${text}`);
      });
      session.on('Runtime.exceptionThrown', (e) => {
        const d = e.exceptionDetails;
        logs.push(`[${tag}][EXC] ${d.exception ? (d.exception.description || d.exception.value) : d.text}`);
      });
      session.on('Log.entryAdded', (e) => logs.push(`[${tag}][log] ${e.entry.text}`));
      await session.send('Runtime.enable');
      await session.send('Log.enable').catch(() => {});
      await session.send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: true, flatten: true }).catch(() => {});
      await session.send('Runtime.runIfWaitingForDebugger').catch(() => {});
    } catch (err) {
      logs.push(`[attach-err ${tag}] ${err.message}`);
    }
  });

  page.on('console', (m) => logs.push(`[page][${m.type()}] ${m.text()}`));
  page.on('pageerror', (e) => logs.push(`[page][EXC] ${e.message}`));

  await page.goto('http://localhost:8080/', { waitUntil: 'networkidle2', timeout: 30000 });
  await new Promise((r) => setTimeout(r, 3000));
  await page.click('input[name="remote"]');
  await page.type('input[name="remote"]', APP_URL);
  await page.keyboard.press('Enter');
  await new Promise((r) => setTimeout(r, WAIT));

  logs.push('[info] title=' + (await page.evaluate(() => document.title)));
  await page.screenshot({ path: __dirname + '/shot-c.png' });
  console.log(logs.join('\n'));
  await browser.close();
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
