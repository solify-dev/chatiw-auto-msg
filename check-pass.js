const puppeteer = require('puppeteer-core');

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

(async () => {
  const browser = await puppeteer.connect({
    browserURL: 'http://127.0.0.1:9333',
    defaultViewport: null,
    protocolTimeout: 120000,
  });

  for (let i = 0; i < 30; i++) {
    const pages = await browser.pages();
    const page = pages.find((p) => (p.url() || '').includes('chatiw')) || pages.find((p) => p.url().startsWith('http')) || pages[0];
    let title = '';
    try {
      title = await page.title();
    } catch {
      title = '(nav)';
    }
    console.log(`[${i}] ${title} | ${page.url()}`);

    if (title && !/just a moment|attention/i.test(title)) {
      const has = await page.evaluate(() => ({
        submit: !!document.querySelector('#submit_btn'),
        nick: !!document.querySelector('input[name="nickname"]'),
        body: document.body?.innerText?.slice(0, 300),
      }));
      console.log('SUCCESS', has);
      await page.screenshot({ path: 'passed.png', fullPage: true });
      break;
    }

    // keep clicking turnstile if still present
    for (const frame of page.frames()) {
      if (!frame.url().includes('challenges.cloudflare')) continue;
      try {
        const el = await frame.$('body');
        const box = el && (await el.boundingBox());
        if (box) {
          await page.mouse.click(box.x + 28, box.y + box.height / 2);
          console.log('clicked turnstile');
        }
      } catch {}
    }
    await sleep(2000);
  }

  await browser.disconnect();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
