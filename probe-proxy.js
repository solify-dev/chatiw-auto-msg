/**
 * Probe free proxies: can they reach chatiw.com without an IP ban?
 * Usage: node probe-proxy.js
 */
const fs = require('fs');
const { spawn } = require('child_process');
const puppeteer = require('puppeteer-core');
const path = require('path');

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9444;
const LIST = fs
  .readFileSync(path.join(__dirname, 'proxies.txt'), 'utf8')
  .split(/\r?\n/)
  .map((l) => l.trim())
  .filter(Boolean)
  .slice(0, 25);

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function killPort(port) {
  try {
    require('child_process').execSync(
      `powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort ${port} -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }"`,
      { stdio: 'ignore' },
    );
  } catch {}
}

async function testProxy(proxy) {
  await killPort(PORT);
  const profile = path.join(__dirname, `.probe-${proxy.replace(/[^0-9]/g, '_')}`);
  fs.mkdirSync(profile, { recursive: true });
  const child = spawn(
    CHROME,
    [
      `--remote-debugging-port=${PORT}`,
      `--user-data-dir=${profile}`,
      `--proxy-server=${proxy}`,
      '--no-first-run',
      '--disable-blink-features=AutomationControlled',
      'https://www.chatiw.com/',
    ],
    { detached: true, stdio: 'ignore', windowsHide: true },
  );
  child.unref();

  // wait CDP
  let ver = null;
  for (let i = 0; i < 25; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/version`);
      if (r.ok) {
        ver = await r.json();
        break;
      }
    } catch {}
    await sleep(400);
  }
  if (!ver) return { proxy, ok: false, reason: 'cdp-timeout' };

  const browser = await puppeteer.connect({
    browserWSEndpoint: ver.webSocketDebuggerUrl,
    defaultViewport: null,
    protocolTimeout: 60000,
  });
  try {
    const pages = await browser.pages();
    const page = pages.find((p) => p.url().includes('chatiw')) || pages[0];

    for (let i = 0; i < 20; i++) {
      let title = '';
      try {
        title = await page.title();
      } catch {
        await sleep(1000);
        continue;
      }
      if (/just a moment/i.test(title)) {
        // click turnstile
        for (const frame of page.frames()) {
          if (!frame.url().includes('challenges.cloudflare')) continue;
          try {
            const el = await frame.$('body');
            const box = el && (await el.boundingBox());
            if (box) await page.mouse.click(box.x + 28, box.y + box.height / 2);
          } catch {}
        }
        await sleep(2000);
        continue;
      }

      const status = await page.evaluate(() => {
        const t = document.body?.innerText || '';
        if (/has been blocked|been banned/i.test(t)) return 'banned';
        if (document.querySelector('#submit_btn') || document.querySelector('input[name="nickname"]'))
          return 'form';
        return 'other';
      });
      return { proxy, ok: status === 'form', reason: status, title };
    }
    return { proxy, ok: false, reason: 'cf-timeout' };
  } finally {
    try {
      await browser.disconnect();
    } catch {}
    await killPort(PORT);
  }
}

(async () => {
  console.log(`Probing ${LIST.length} proxies...`);
  for (const proxy of LIST) {
    process.stdout.write(`${proxy} ... `);
    try {
      const r = await Promise.race([
        testProxy(proxy),
        sleep(45000).then(() => ({ proxy, ok: false, reason: 'hard-timeout' })),
      ]);
      console.log(r.ok ? 'OK FORM' : `FAIL (${r.reason})`);
      if (r.ok) {
        fs.writeFileSync('working-proxy.txt', proxy);
        console.log('Saved working-proxy.txt');
        break;
      }
    } catch (e) {
      console.log('ERR', e.message);
    }
  }
  await killPort(PORT);
})();
