const { connect } = require('puppeteer-real-browser');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PROFILE = path.join(__dirname, '.chrome-profile');
const PORT = 9222;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function launchChrome() {
  fs.mkdirSync(PROFILE, { recursive: true });
  execFile(
    CHROME,
    [
      `--remote-debugging-port=${PORT}`,
      `--user-data-dir=${PROFILE}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-blink-features=AutomationControlled',
      'https://www.chatiw.com/',
    ],
    { windowsHide: false },
  );
  // wait for CDP
  for (let i = 0; i < 30; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/version`);
      if (res.ok) return await res.json();
    } catch {}
    await sleep(500);
  }
  throw new Error('Chrome CDP not ready');
}

(async () => {
  // Kill any previous chrome on 9222
  try {
    const { execSync } = require('child_process');
    execSync('powershell -Command "Get-NetTCPConnection -LocalPort 9222 -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }"');
  } catch {}

  console.log('Launching real Chrome...');
  const ver = await launchChrome();
  console.log('CDP:', ver.webSocketDebuggerUrl);

  const puppeteer = require('puppeteer-core');
  const browser = await puppeteer.connect({
    browserWSEndpoint: ver.webSocketDebuggerUrl,
    defaultViewport: null,
  });

  const pages = await browser.pages();
  const page = pages[0] || (await browser.newPage());

  // Wait for CF
  for (let i = 0; i < 45; i++) {
    const title = await page.title();
    console.log(`[${i}] ${title} | ${page.url()}`);
    if (!/just a moment|attention required|performing security/i.test(title)) {
      const body = await page.evaluate(() => document.body?.innerText?.slice(0, 200) || '');
      if (!/performing security verification/i.test(body)) {
        console.log('Passed Cloudflare!');
        break;
      }
    }

    // try click turnstile checkbox in frames
    for (const frame of page.frames()) {
      try {
        const box = await frame.$('input[type=checkbox], .cb-lb, label');
        if (box) {
          const box2 = await box.boundingBox();
          if (box2) {
            await page.mouse.click(box2.x + box2.width / 2, box2.y + box2.height / 2);
            console.log('Clicked turnstile element');
          }
        }
      } catch {}
    }
    await sleep(2000);
  }

  await page.screenshot({ path: 'chrome-cdp.png', fullPage: true });
  const info = await page.evaluate(() => ({
    title: document.title,
    url: location.href,
    body: document.body?.innerText?.slice(0, 1000),
    submit: !!document.querySelector('#submit_btn'),
    nick: !!document.querySelector('#nickname, [name=nickname], input[name="nick"]'),
    inputs: [...document.querySelectorAll('input,select,button')].map((el) => ({
      tag: el.tagName,
      id: el.id,
      name: el.name,
      type: el.type,
      className: el.className,
    })).slice(0, 40),
  }));
  fs.writeFileSync('chrome-cdp-info.json', JSON.stringify(info, null, 2));
  console.log(JSON.stringify(info, null, 2));

  await sleep(3000);
  await browser.disconnect();
  // leave chrome open? kill it
  try {
    const { execSync } = require('child_process');
    execSync('powershell -Command "Get-NetTCPConnection -LocalPort 9222 -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }"');
  } catch {}
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
