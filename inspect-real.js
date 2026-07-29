const { connect } = require('puppeteer-real-browser');
const fs = require('fs');

(async () => {
  const { browser, page } = await connect({
    headless: false,
    turnstile: true,
    args: ['--start-maximized'],
    connectOption: { defaultViewport: null },
  });

  console.log('Navigating to chatiw.com...');
  await page.goto('https://www.chatiw.com/', { waitUntil: 'domcontentloaded', timeout: 90000 });

  // Wait for Cloudflare challenge to clear
  for (let i = 0; i < 60; i++) {
    const title = await page.title();
    const url = page.url();
    console.log(`[${i}] title="${title}" url=${url}`);
    if (!title.includes('Just a moment') && !title.includes('Attention')) {
      break;
    }
    await new Promise((r) => setTimeout(r, 2000));
  }

  await page.screenshot({ path: 'after-cf.png', fullPage: true });
  console.log('Title:', await page.title());
  console.log('URL:', page.url());

  const info = await page.evaluate(() => {
    const pick = (sel) =>
      [...document.querySelectorAll(sel)].map((el) => ({
        tag: el.tagName,
        type: el.getAttribute('type'),
        name: el.getAttribute('name'),
        id: el.id,
        className: el.className,
        value: el.value || el.getAttribute('value'),
        href: el.getAttribute('href'),
        text: (el.textContent || '').trim().slice(0, 100),
        options:
          el.tagName === 'SELECT'
            ? [...el.options].slice(0, 20).map((o) => ({ value: o.value, text: o.text }))
            : undefined,
      }));

    return {
      bodySnippet: (document.body?.innerText || '').slice(0, 800),
      forms: pick('form'),
      inputs: pick('input, select, textarea, button, a'),
      submit: pick('#submit_btn, [id="submit_btn"]'),
      turnstile: pick('[data-sitekey], .cf-turnstile, [name="cf-turnstile-response"]'),
      goChat: pick('a[href="/chatting.php"], a[href*="chatting.php"]'),
      friendList: !!document.querySelector('#friend_list'),
    };
  });

  fs.writeFileSync('page-info.json', JSON.stringify(info, null, 2));
  console.log(JSON.stringify(info, null, 2));

  await new Promise((r) => setTimeout(r, 5000));
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
