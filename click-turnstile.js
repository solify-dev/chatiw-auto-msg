const puppeteer = require('puppeteer-core');
const fs = require('fs');

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

(async () => {
  const browser = await puppeteer.connect({
    browserURL: 'http://127.0.0.1:9333',
    defaultViewport: null,
    protocolTimeout: 120000,
  });

  const pages = await browser.pages();
  const page = pages.find((p) => p.url().includes('chatiw')) || pages[0];
  console.log('Page:', await page.title(), page.url());

  // List frames
  for (const frame of page.frames()) {
    console.log('FRAME:', frame.url().slice(0, 140));
  }

  // Try clicking turnstile checkbox repeatedly
  for (let i = 0; i < 40; i++) {
    const title = await page.title();
    console.log(`[${i}] ${title}`);

    if (!/just a moment/i.test(title)) {
      console.log('PASSED!');
      break;
    }

    for (const frame of page.frames()) {
      if (!frame.url().includes('challenges.cloudflare')) continue;
      try {
        // Common turnstile selectors
        const selectors = [
          'input[type=checkbox]',
          '#challenge-stage',
          '.cb-lb',
          'label',
          'body',
        ];
        for (const sel of selectors) {
          const el = await frame.$(sel);
          if (!el) continue;
          const box = await el.boundingBox();
          if (!box) continue;
          console.log('Clicking', sel, box);
          await page.mouse.click(box.x + Math.min(box.width / 2, 30), box.y + box.height / 2);
          await sleep(500);
        }
      } catch (e) {
        console.log('frame err', e.message);
      }
    }

    // Also try page-level click near typical turnstile position (center)
    try {
      const widget = await page.$('#cf-challenge-running, .cf-turnstile, iframe');
      if (widget) {
        const box = await widget.boundingBox();
        if (box) {
          await page.mouse.click(box.x + 40, box.y + box.height / 2);
        }
      }
    } catch {}

    await sleep(2000);
  }

  await page.screenshot({ path: 'clicked.png', fullPage: true }).catch(() => {});
  const info = await page.evaluate(() => ({
    title: document.title,
    body: document.body?.innerText?.slice(0, 400),
    submit: !!document.querySelector('#submit_btn'),
    sitekeys: [...document.querySelectorAll('[data-sitekey]')].map((e) => e.getAttribute('data-sitekey')),
  }));
  console.log(JSON.stringify(info, null, 2));
  fs.writeFileSync('clicked-info.json', JSON.stringify(info, null, 2));
  await browser.disconnect();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
