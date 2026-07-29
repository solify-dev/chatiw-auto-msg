const { connect } = require('puppeteer-real-browser');
require('dotenv').config();

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

(async () => {
  const u = new URL(process.env.PROXY.includes('://') ? process.env.PROXY : `http://${process.env.PROXY}`);
  const { browser, page } = await connect({
    headless: false,
    turnstile: true,
    args: ['--start-maximized'],
    connectOption: { defaultViewport: null },
    proxy: {
      host: u.hostname,
      port: u.port,
      username: decodeURIComponent(u.username),
      password: decodeURIComponent(u.password),
    },
  });
  await page.goto('https://www.chatiw.com/', { waitUntil: 'domcontentloaded', timeout: 120000 });
  for (let i = 0; i < 30; i++) {
    const title = await page.title();
    console.log(i, title, page.url());
    if (!/just a moment/i.test(title)) break;
    for (const frame of page.frames()) {
      if (!(frame.url() || '').includes('challenges.cloudflare')) continue;
      try {
        const el = await frame.$('body');
        const box = el && (await el.boundingBox());
        if (box) await page.mouse.click(box.x + 28, box.y + box.height / 2);
      } catch {}
    }
    await sleep(2000);
  }
  const info = await page.evaluate(() => ({
    title: document.title,
    body: document.body?.innerText?.slice(0, 600),
    hasForm: !!document.querySelector('input[name="nickname"]'),
  }));
  console.log(JSON.stringify(info, null, 2));
  await page.screenshot({ path: 'maintenance.png', fullPage: true });
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
