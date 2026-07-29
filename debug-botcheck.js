const { connect } = require('puppeteer-real-browser');
const fs = require('fs');
require('dotenv').config();

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function passCf(page) {
  for (let i = 0; i < 40; i++) {
    const title = await page.title();
    if (!/just a moment/i.test(title)) return;
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
  await passCf(page);
  await page.waitForSelector('input[name="nickname"]', { timeout: 60000 });

  await page.type('input[name="nickname"]', 'teosun');
  await page.evaluate(() => {
    const age = document.querySelector('select[name="age"]');
    const idx = [...age.options].findIndex((o) => o.text.trim() === '30');
    age.selectedIndex = idx;
    age.dispatchEvent(new Event('change', { bubbles: true }));
    document.querySelector('input[name="sex"][value="M"]').click();
    const zone = document.querySelector('select[name="zone"]');
    const z = [...zone.options].find((o) => /aichi/i.test(o.text));
    if (z) {
      zone.value = z.value;
      zone.dispatchEvent(new Event('change', { bubbles: true }));
    }
  });

  await Promise.all([
    page.evaluate(() => {
      const form = document.querySelector('#start_form, form');
      const btn = document.querySelector('#submit_btn');
      form.requestSubmit(btn);
    }),
    page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {}),
  ]);

  console.log('After submit', page.url(), await page.title());

  // Observe for 60s while clicking turnstile
  for (let i = 0; i < 30; i++) {
    for (const frame of page.frames()) {
      console.log('FRAME', frame.url().slice(0, 120));
      if ((frame.url() || '').includes('challenges.cloudflare')) {
        try {
          const el = await frame.$('body');
          const box = el && (await el.boundingBox());
          if (box) await page.mouse.click(box.x + 28, box.y + box.height / 2);
        } catch {}
      }
    }
    const info = await page.evaluate(() => ({
      title: document.title,
      url: location.href,
      links: [...document.querySelectorAll('a')].slice(0, 20).map((a) => ({
        href: a.getAttribute('href'),
        text: a.textContent.trim().slice(0, 60),
        id: a.id,
        className: a.className,
      })),
      buttons: [...document.querySelectorAll('button, input[type=submit]')].map((b) => ({
        id: b.id,
        text: b.textContent.trim().slice(0, 60),
        name: b.name,
      })),
      hasFriends: !!document.querySelector('#friend_list'),
      turnstile: !!document.querySelector('.cf-turnstile, [data-sitekey]'),
      sitekeys: [...document.querySelectorAll('[data-sitekey]')].map((e) => e.getAttribute('data-sitekey')),
      body: document.body?.innerText?.slice(0, 500),
    })).catch((e) => ({ error: e.message }));
    console.log('---', i, JSON.stringify(info, null, 2));
    await page.screenshot({ path: `botcheck-${i}.png` }).catch(() => {});
    if (info.hasFriends) break;
    if (info.links?.some((l) => (l.href || '').includes('chatting.php') && /go to chat/i.test(l.text))) {
      console.log('Found Go to chat, clicking');
      await page.click('a[href="/chatting.php"], a[href*="chatting.php"]');
      await sleep(3000);
    }
    await sleep(2000);
  }

  fs.writeFileSync('botcheck-final.json', JSON.stringify(await page.evaluate(() => document.documentElement.outerHTML.slice(0, 15000))));
  await sleep(2000);
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
