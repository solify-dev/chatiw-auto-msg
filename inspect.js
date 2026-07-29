const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({
    headless: false,
    args: ['--disable-blink-features=AutomationControlled'],
  });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  });
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  });

  const page = await context.newPage();
  page.on('console', (msg) => console.log('[console]', msg.text()));

  console.log('Navigating...');
  await page.goto('https://www.chatiw.com/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(5000);

  const title = await page.title();
  console.log('Title:', title);
  console.log('URL:', page.url());

  const html = await page.content();
  console.log('HTML length:', html.length);

  // Look for turnstile / form fields
  const info = await page.evaluate(() => {
    const turnstile = [...document.querySelectorAll('[data-sitekey], .cf-turnstile, iframe[src*="turnstile"], iframe[src*="challenges.cloudflare"]')].map((el) => ({
      tag: el.tagName,
      sitekey: el.getAttribute('data-sitekey'),
      className: el.className,
      src: el.getAttribute('src')?.slice(0, 120),
      id: el.id,
    }));
    const inputs = [...document.querySelectorAll('input, select, button, a#submit_btn, #submit_btn')].map((el) => ({
      tag: el.tagName,
      type: el.getAttribute('type'),
      name: el.getAttribute('name'),
      id: el.id,
      value: el.value || el.getAttribute('value'),
      text: el.textContent?.trim()?.slice(0, 80),
    }));
    const challenge = document.querySelector('#challenge-running, #cf-challenge-running, .cf-browser-verification');
    return {
      turnstile,
      inputs: inputs.slice(0, 50),
      bodyText: document.body?.innerText?.slice(0, 500),
      hasChallenge: !!challenge,
      iframes: [...document.querySelectorAll('iframe')].map((f) => f.src?.slice(0, 150)),
    };
  });

  console.log(JSON.stringify(info, null, 2));
  await page.screenshot({ path: 'inspect.png', fullPage: true });
  console.log('Saved inspect.png');

  // Keep open a bit for manual observation
  await page.waitForTimeout(15000);
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
