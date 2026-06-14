// Load the WASM app HTML directly (top-level) to verify it instantiates and to
// capture all stdout/stderr (worker logs included via CDP auto-attach with
// waitForDebuggerOnStart so we don't miss early prints). It won't find a
// compositor, but it proves the wasm runs and shows how far it gets.
const puppeteer = require('puppeteer-core');

(async () => {
  const browser = await puppeteer.launch({
    executablePath: '/usr/bin/chromium-browser',
    headless: 'new',
    userDataDir: process.env.HOME + '/.cache/gf-chrome',
    args: [
      '--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage',
      '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
      '--ignore-gpu-blocklist', '--enable-features=SharedArrayBuffer',
    ],
  });
  const page = await browser.newPage();
  const logs = [];

  const client = await page.target().createCDPSession();
  await client.send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: true, flatten: true });
  client.on('Target.attachedToTarget', async (event) => {
    const session = client.connection().session(event.sessionId);
    if (!session) return;
    const tag = `${event.targetInfo.type}`;
    try {
      session.on('Runtime.consoleAPICalled', (e) => {
        const text = (e.args || []).map((a) => a.value ?? a.description ?? '').join(' ');
        logs.push(`[${tag}][${e.type}] ${text}`);
      });
      session.on('Runtime.exceptionThrown', (e) => {
        const d = e.exceptionDetails;
        logs.push(`[${tag}][EXC] ${d.exception ? (d.exception.description || d.exception.value) : d.text}`);
      });
      await session.send('Runtime.enable');
      await session.send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: true, flatten: true }).catch(() => {});
      await session.send('Runtime.runIfWaitingForDebugger').catch(() => {});
    } catch {}
  });
  page.on('console', (m) => logs.push(`[page][${m.type()}] ${m.text()}`));
  page.on('pageerror', (e) => logs.push(`[page][EXC] ${e.message}`));
  page.on('requestfailed', (r) => logs.push(`[reqfail] ${r.url()} ${r.failure() && r.failure().errorText}`));

  await page.goto('http://localhost:8080/gfapp/gf-hello.html', { waitUntil: 'networkidle2', timeout: 30000 }).catch((e) => logs.push('[goto] ' + e.message));
  await new Promise((r) => setTimeout(r, 6000));
  console.log(logs.join('\n'));
  await browser.close();
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
