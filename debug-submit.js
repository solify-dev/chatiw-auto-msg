const { connect } = require('puppeteer-real-browser');
require('dotenv').config();

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

(async () => {
  const proxyRaw = process.env.PROXY;
  let raw = proxyRaw.includes('://') ? proxyRaw : `http://${proxyRaw}`;
  const u = new URL(raw);

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

  for (let i = 0; i < 40; i++) {
    const title = await page.title();
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

  await page.waitForSelector('input[name="nickname"]', { timeout: 60000 });

  const html = await page.evaluate(() => {
    const form = document.querySelector('#start_form, form');
    return {
      formHTML: form?.innerHTML?.slice(0, 4000),
      countryNodes: [...document.querySelectorAll('[name=country], #countries, #country_id, input, select')]
        .filter((el) => /country|zone|nation/i.test(el.name + el.id + el.className))
        .map((el) => ({
          tag: el.tagName,
          name: el.name,
          id: el.id,
          type: el.type,
          value: el.value,
          disabled: el.disabled,
          outer: el.outerHTML.slice(0, 300),
        })),
      allNamed: [...document.querySelectorAll('#start_form [name], form[name] [name], form [name]')]
        .slice(0, 40)
        .map((el) => ({
          tag: el.tagName,
          name: el.name,
          id: el.id,
          type: el.type,
          value: el.value,
          checked: el.checked,
        })),
    };
  });

  require('fs').writeFileSync('form-structure.json', JSON.stringify(html, null, 2));
  console.log(JSON.stringify(html, null, 2));

  // Fill and try submit with request interception
  const requests = [];
  page.on('request', (req) => {
    if (req.method() === 'POST') requests.push({ url: req.url(), postData: req.postData()?.slice(0, 500) });
  });
  page.on('response', async (res) => {
    if (res.request().method() === 'POST') {
      console.log('POST resp', res.status(), res.url());
    }
  });

  await page.type('input[name="nickname"]', 'teosun');
  await page.evaluate(() => {
    const sel = document.querySelector('select[name="age"]');
    if (sel) {
      sel.value = '30';
      sel.dispatchEvent(new Event('change', { bubbles: true }));
    }
    document.querySelector('input[name="sex"][value="M"]')?.click();
    const zone = document.querySelector('select[name="zone"]');
    if (zone) {
      const opt = [...zone.options].find((o) => /aichi/i.test(o.text));
      if (opt) {
        zone.value = opt.value;
        zone.dispatchEvent(new Event('change', { bubbles: true }));
      }
    }
  });

  console.log('Submitting via form.requestSubmit / click');
  await page.evaluate(() => {
    const form = document.querySelector('#start_form, form');
    const btn = document.querySelector('#submit_btn');
    console.log('form', !!form, 'btn', !!btn);
    if (form && form.requestSubmit) form.requestSubmit(btn);
    else btn?.click();
  });

  await sleep(8000);
  console.log('After submit URL', page.url(), await page.title());
  console.log('POSTs', requests);
  const body = await page.evaluate(() => document.body.innerText.slice(0, 800));
  console.log(body);

  await page.screenshot({ path: 'after-submit-debug.png', fullPage: true });
  await sleep(3000);
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
