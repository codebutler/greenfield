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
  // capture worker errors at the browser level via CDP on the page
  const client = await page.target().createCDPSession();
  await client.send('Target.setDiscoverTargets', { discover: true });
  client.on('Target.targetCreated', (e) => out.push(`[targetCreated] ${e.targetInfo.type} ${e.targetInfo.url}`));
  client.on('Target.targetInfoChanged', (e) => { if ((e.targetInfo.url||'').includes('gf-hello')) out.push(`[changed] ${e.targetInfo.type} ${e.targetInfo.url}`); });

  await page.goto('http://localhost:8080/', { waitUntil: 'networkidle2', timeout: 30000 });
  await page.waitForSelector('input[name="remote"]', { timeout: 20000 });
  await page.type('input[name="remote"]', APP_URL);
  await page.keyboard.press('Enter');
  await new Promise((r) => setTimeout(r, 9000));

  out.push('=== browser.targets() ===');
  for (const t of browser.targets()) out.push(`  ${t.type()}  ${t.url()}`);
  console.log(out.join('\n'));
  await browser.close();
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
