const { connect } = require('puppeteer-real-browser');
const fs = require('fs');
const path = require('path');

require('dotenv').config();

const CONFIG = {
  url: 'https://www.chatiw.com/',
  nickname: process.env.NICKNAME || 'teosun',
  age: process.env.AGE || '30',
  gender: process.env.GENDER || 'M',
  country: process.env.COUNTRY || 'Japan',
  state: process.env.STATE || 'Aichi',
  proxy: process.env.PROXY || '',
  proxyListPath: process.env.PROXY_LIST || path.join(__dirname, 'proxylist.txt'),
  msgsPerProxy: Number(process.env.MSGS_PER_PROXY || 5),
  turnstileSitekey: '0x4AAAAAAADnPIDROrmt1Wwj',
  capsolverKey: process.env.CAPSOLVER_API_KEY || '',
  keepOpen: process.env.KEEP_OPEN === '1',
};

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function log(...args) {
  console.log(new Date().toISOString(), ...args);
}

/**
 * Supports:
 *  - host:port:user:pass
 *  - http://user:pass@host:port
 *  - user:pass@host:port
 *  - host:port
 */
function parseProxy(proxy) {
  if (!proxy) return null;
  let raw = proxy.trim();
  if (!raw) return null;

  // host:port:user:pass  (password may contain ':')
  if (!raw.includes('://') && !raw.includes('@')) {
    const parts = raw.split(':');
    if (parts.length >= 4) {
      const [host, port, username, ...passParts] = parts;
      return {
        host,
        port,
        username,
        password: passParts.join(':'),
        raw,
      };
    }
    if (parts.length === 2) {
      return { host: parts[0], port: parts[1], raw };
    }
  }

  if (!raw.includes('://') && raw.includes('@')) raw = `http://${raw}`;
  else if (!raw.includes('://')) raw = `http://${raw}`;
  const u = new URL(raw);
  return {
    host: u.hostname,
    port: u.port,
    username: u.username ? decodeURIComponent(u.username) : undefined,
    password: u.password ? decodeURIComponent(u.password) : undefined,
    raw,
  };
}

function loadProxyList(filePath) {
  if (!fs.existsSync(filePath)) return [];
  return fs
    .readFileSync(filePath, 'utf8')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'))
    .map(parseProxy)
    .filter(Boolean);
}

async function isChallengePage(page) {
  try {
    const title = await page.title();
    if (/just a moment|attention required|bot check/i.test(title)) return true;
    const body = await page.evaluate(() => (document.body?.innerText || '').slice(0, 400));
    return /performing security verification|verify you are human|checking your browser|bot check/i.test(
      body,
    );
  } catch {
    return true;
  }
}

async function isBanned(page) {
  try {
    return await page.evaluate(() =>
      /has been blocked|you have been banned/i.test(document.body?.innerText || ''),
    );
  } catch {
    return false;
  }
}

async function clickTurnstile(page) {
  for (const frame of page.frames()) {
    const url = frame.url() || '';
    if (!url.includes('challenges.cloudflare.com')) continue;
    try {
      const el =
        (await frame.$('input[type="checkbox"]')) ||
        (await frame.$('.cb-lb')) ||
        (await frame.$('label')) ||
        (await frame.$('body'));
      if (!el) continue;
      const box = await el.boundingBox();
      if (!box) continue;
      await page.mouse.click(box.x + 28, box.y + box.height / 2);
      log('Clicked Turnstile widget');
      return true;
    } catch {}
  }
  return false;
}

async function waitForCloudflare(page, { timeoutMs = 180000, label = 'CF' } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (!(await isChallengePage(page))) {
      log(`${label}: cleared →`, await page.title());
      return true;
    }
    await clickTurnstile(page);
    await sleep(2000);
  }
  throw new Error(`${label}: Cloudflare challenge not cleared within ${timeoutMs}ms`);
}

async function selectByVisibleText(page, selectSelector, visibleText) {
  return page.evaluate(
    ({ selectSelector, visibleText }) => {
      const sel = document.querySelector(selectSelector);
      if (!sel) return { ok: false, reason: 'missing-select' };
      const needle = visibleText.trim().toLowerCase();
      const opt = [...sel.options].find((o) => {
        const t = o.text.trim().toLowerCase();
        return t === needle || t.includes(needle);
      });
      if (!opt) {
        return {
          ok: false,
          reason: 'not-found',
          options: [...sel.options].slice(0, 40).map((o) => o.text),
        };
      }
      sel.value = opt.value;
      sel.dispatchEvent(new Event('input', { bubbles: true }));
      sel.dispatchEvent(new Event('change', { bubbles: true }));
      if (window.jQuery) window.jQuery(sel).val(opt.value).trigger('change');
      return { ok: true, value: opt.value, text: opt.text };
    },
    { selectSelector, visibleText },
  );
}

async function fillStartForm(page) {
  log('Filling form', {
    nickname: CONFIG.nickname,
    age: CONFIG.age,
    gender: CONFIG.gender,
    country: CONFIG.country,
    state: CONFIG.state,
  });

  await page.waitForSelector('input[name="nickname"]', { timeout: 45000 });
  await page.click('input[name="nickname"]', { clickCount: 3 });
  await page.type('input[name="nickname"]', CONFIG.nickname, { delay: 30 });

  await page.evaluate((age) => {
    const sel = document.querySelector('select[name="age"], #age_list');
    if (!sel) return;
    const idx = [...sel.options].findIndex(
      (o) => o.text.trim() === String(age) || o.value === String(age),
    );
    if (idx >= 0) {
      sel.selectedIndex = idx;
      sel.dispatchEvent(new Event('change', { bubbles: true }));
      if (window.jQuery) window.jQuery(sel).val(sel.options[idx].value).trigger('change');
    }
  }, CONFIG.age);

  await page.click(`input[name="sex"][value="${CONFIG.gender}"]`);

  const countryInfo = await page.evaluate((country) => {
    const sel = document.querySelector('select[name="country"], #countries');
    if (!sel || sel.disabled || sel.options.length <= 1) {
      return { mode: 'locked', selected: sel?.selectedOptions?.[0]?.text || null };
    }
    return { mode: 'editable', count: sel.options.length };
  }, CONFIG.country);
  log('Country:', countryInfo);

  if (countryInfo.mode === 'editable') {
    const res = await selectByVisibleText(
      page,
      'select[name="country"], #countries',
      CONFIG.country,
    );
    if (!res.ok) throw new Error(`Country select failed: ${JSON.stringify(res)}`);
    await sleep(1000);
  }

  await page.evaluate(() => {
    const z = document.querySelector('#zone');
    if (z) z.style.display = '';
  });
  await page
    .waitForFunction(() => {
      const zone = document.querySelector('select[name="zone"]');
      return zone && [...zone.options].some((o) => o.value);
    }, { timeout: 25000 })
    .catch(() => {});

  let stateOk = await selectByVisibleText(page, 'select[name="zone"]', CONFIG.state);
  if (!stateOk.ok) {
    // Geo-locked country may not match configured state (e.g. US proxy + Aichi)
    stateOk = await page.evaluate(() => {
      const sel = document.querySelector('select[name="zone"]');
      if (!sel) return { ok: false, reason: 'missing-zone' };
      const opt = [...sel.options].find((o) => o.value && o.text.trim());
      if (!opt) return { ok: false, reason: 'no-options' };
      sel.value = opt.value;
      sel.dispatchEvent(new Event('change', { bubbles: true }));
      if (window.jQuery) window.jQuery(sel).val(opt.value).trigger('change');
      return { ok: true, value: opt.value, text: opt.text, fallback: true };
    });
  }
  if (!stateOk.ok) throw new Error(`State select failed: ${JSON.stringify(stateOk)}`);
  log('State:', stateOk.text, stateOk.fallback ? '(fallback)' : '');

  await page.screenshot({ path: path.join(__dirname, 'form-filled.png') }).catch(() => {});
}

async function dismissCookies(page) {
  try {
    const clicked = await page.evaluate(() => {
      const candidates = [...document.querySelectorAll('button, a, input[type=button]')];
      const btn = candidates.find((el) => /^(ok|accept|got it|agree)$/i.test((el.textContent || '').trim()));
      if (btn) {
        btn.click();
        return true;
      }
      const policy = document.querySelector('#cookie_policy');
      if (policy) policy.style.display = 'none';
      return false;
    });
    if (clicked) log('Dismissed cookie banner');
  } catch {}
}

async function clickStartChat(page) {
  log('Clicking #submit_btn');
  await dismissCookies(page);
  await page.waitForSelector('#submit_btn', { timeout: 15000 });

  // Ensure zone has a real selected value before submit
  const ready = await page.evaluate(() => {
    const nick = document.querySelector('input[name="nickname"]')?.value || '';
    const age = document.querySelector('select[name="age"]')?.value || '';
    const sex = document.querySelector('input[name="sex"]:checked')?.value || '';
    const country = document.querySelector('input[name="country"], select[name="country"]')?.value || '';
    const zone = document.querySelector('select[name="zone"]')?.value || '';
    return { nick, age, sex, country, zone };
  });
  log('Form values before submit:', ready);
  if (!ready.nick || !ready.age || !ready.sex || !ready.country || !ready.zone) {
    throw new Error(`Form incomplete: ${JSON.stringify(ready)}`);
  }

  await Promise.all([
    page.evaluate(() => {
      const form = document.querySelector('#start_form, form');
      const btn = document.querySelector('#submit_btn');
      if (form?.requestSubmit) form.requestSubmit(btn);
      else btn?.click();
    }),
    page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {}),
  ]);
}

async function pageSnapshot(page) {
  try {
    return await page.evaluate(() => ({
      title: document.title,
      url: location.href,
      hasGoChat: !!document.querySelector('a[href="/chatting.php"], a[href*="chatting.php"]'),
      hasFriends: !!document.querySelector('#friend_list'),
      formError: (document.querySelector('#form_error span')?.innerText || '').trim().slice(0, 200),
      formErrorVisible:
        !!document.querySelector('#form_error') &&
        getComputedStyle(document.querySelector('#form_error')).display !== 'none',
      body: (document.body?.innerText || '').slice(0, 350),
      turnstileFrames: [...document.querySelectorAll('iframe')].some((f) =>
        (f.src || '').includes('challenges.cloudflare'),
      ),
    }));
  } catch (e) {
    return { error: e.message };
  }
}

async function afterSubmitFlow(page) {
  log('Post-submit flow...');
  const deadline = Date.now() + 180000;
  let goChatClicked = false;
  let botBtnClicked = false;

  while (Date.now() < deadline) {
    await dismissCookies(page);

    const hasTf = page.frames().some((f) => (f.url() || '').includes('challenges.cloudflare'));
    if (hasTf || (await isChallengePage(page))) {
      log('Solving Cloudflare/Turnstile...');
      await clickTurnstile(page);
      await sleep(1500);
    }

    let snap;
    try {
      snap = await pageSnapshot(page);
    } catch {
      await sleep(1500);
      continue;
    }

    log('Page state:', {
      url: snap.url,
      title: snap.title,
      hasGoChat: snap.hasGoChat,
      hasFriends: snap.hasFriends,
      turnstileFrames: snap.turnstileFrames,
      body: (snap.body || '').slice(0, 120),
    });

    if (snap.formErrorVisible && snap.formError) {
      throw new Error(`Form error: ${snap.formError}`);
    }

    if (snap.hasFriends) {
      log('Reached chat page with friend list');
      return;
    }

    // Bot Check page: turnstile + #submit_btn[name=check_bot_btn]
    if (/bot check/i.test(snap.title || '') || /one more step|security check/i.test(snap.body || '')) {
      log('On Bot Check page');
      await clickTurnstile(page);
      // After token is ready, click the bot-check submit
      const tokenReady = await page.evaluate(() => {
        const el = document.querySelector('[name="cf-turnstile-response"]');
        return !!(el && el.value && el.value.length > 20);
      });
      if (tokenReady && !botBtnClicked) {
        log('Turnstile token ready — clicking check_bot_btn');
        await page.evaluate(() => {
          const btn =
            document.querySelector('button[name="check_bot_btn"], #submit_btn[name="check_bot_btn"]') ||
            document.querySelector('#submit_btn');
          const form = btn?.closest('form');
          if (form?.requestSubmit) form.requestSubmit(btn);
          else btn?.click();
        });
        botBtnClicked = true;
        await sleep(2500);
      }
      await sleep(1500);
      continue;
    }

    // Introduction page with Go to Chat
    if (snap.hasGoChat || /introduction\.php/i.test(snap.url || '')) {
      log('On introduction — clicking Go to Chat...');
      const clicked = await page.evaluate(() => {
        const a =
          document.querySelector('a.btn.btn-danger[href*="chatting.php"]') ||
          document.querySelector('a[href="/chatting.php"]') ||
          document.querySelector('a[href="chatting.php"]') ||
          document.querySelector('a[href*="chatting.php"]');
        if (!a) return false;
        a.click();
        return true;
      });
      if (!clicked) {
        log('Go to Chat link missing — navigating directly');
        await page.goto('https://www.chatiw.com/chatting.php', {
          waitUntil: 'domcontentloaded',
          timeout: 60000,
        });
      } else {
        await page
          .waitForFunction(
            () => /chatting\.php/i.test(location.href) && !/introduction/i.test(location.href),
            { timeout: 30000 },
          )
          .catch(async () => {
            log('Navigation slow — forcing chatting.php');
            await page.goto('https://www.chatiw.com/chatting.php', {
              waitUntil: 'domcontentloaded',
              timeout: 60000,
            });
          });
      }
      await sleep(2000);
      continue;
    }

    await sleep(2000);
  }

  await page.screenshot({ path: 'post-submit-timeout.png' }).catch(() => {});
  throw new Error('Timed out waiting for chat page after submit');
}

async function extractFriends(page) {
  await page.waitForSelector('#friend_list', { timeout: 120000 });
  await sleep(4000);
  return page.evaluate(() => {
    const root = document.querySelector('#friend_list');
    if (!root) return [];
    return [...root.querySelectorAll('a[data-userid]')].map((a) => ({
      userId: a.getAttribute('data-userid'),
      state: a.getAttribute('data-state'),
      gender: a.classList.contains('female')
        ? 'female'
        : a.classList.contains('male')
          ? 'male'
          : null,
      nickname:
        a.querySelector('#nickname, span#nickname')?.textContent?.trim() ||
        a.getAttribute('href')?.replace(/^#/, '') ||
        null,
      age: a.querySelector('#age, span#age')?.textContent?.trim() || null,
      country: a.querySelector('i.flag')?.id || null,
    }));
  });
}

async function dismissChatModals(page) {
  try {
    // Try Puppeteer text clicks first (more reliable than evaluate for Bootstrap modals)
    for (const text of ['I understand', 'I Understand', 'OK', 'No, Thanks']) {
      try {
        const btn = await page.waitForFunction(
          (t) => {
            const nodes = [...document.querySelectorAll('button, a.btn, .btn, input[type=button]')];
            return (
              nodes.find((n) => (n.textContent || n.value || '').replace(/\s+/g, ' ').includes(t)) ||
              null
            );
          },
          { timeout: 400 },
          text,
        );
        if (btn) {
          await page.evaluate((t) => {
            const nodes = [...document.querySelectorAll('button, a.btn, .btn, input[type=button]')];
            const el = nodes.find((n) =>
              (n.textContent || n.value || '').replace(/\s+/g, ' ').includes(t),
            );
            if (el) el.click();
          }, text);
          await sleep(400);
        }
      } catch {}
    }

    await page.evaluate(() => {
      const clickText = (re) => {
        const el = [...document.querySelectorAll('button, a, input[type=button], .btn')].find((node) =>
          re.test((node.textContent || node.value || '').replace(/\s+/g, ' ').trim()),
        );
        if (el) {
          el.click();
          return true;
        }
        return false;
      };

      clickText(/i understand/i);
      clickText(/^no,? thanks$/i);
      clickText(/^ok$/i);

      // Force-hide leftover modals/backdrops
      document.querySelectorAll('.modal').forEach((m) => {
        m.classList.remove('in', 'show');
        m.style.display = 'none';
        m.setAttribute('aria-hidden', 'true');
      });
      document.querySelectorAll('.modal-backdrop').forEach((b) => b.remove());
      document.body.classList.remove('modal-open');
      document.body.style.removeProperty('padding-right');
    });
    await sleep(300);
  } catch {}
}

async function sendMessageToFriend(page, friend, message) {
  const selector = `#friend_list a[data-userid="${friend.userId}"]`;

  // Re-find each time — list is live and re-renders
  let link = await page.$(selector);
  if (!link) {
    return { ok: false, reason: 'not-in-dom' };
  }

  await link.evaluate((el) => el.scrollIntoView({ block: 'center', inline: 'nearest' }));
  await sleep(250);
  await dismissChatModals(page);

  link = await page.$(selector);
  if (!link) return { ok: false, reason: 'not-in-dom' };

  // Prefer native onclick/show_box path
  await page.evaluate((sel) => {
    const a = document.querySelector(sel);
    if (!a) return;
    if (typeof window.show_box === 'function' && window.jQuery) {
      window.show_box(window.jQuery(a));
    } else {
      a.click();
    }
  }, selector);

  await sleep(700);
  await dismissChatModals(page);

  // Retry open once if textarea missing
  const ready = await page
    .waitForSelector('#chat_textarea', { timeout: 8000, visible: true })
    .then(() => true)
    .catch(() => false);

  if (!ready) {
    await page.evaluate((sel) => {
      const a = document.querySelector(sel);
      if (a) a.click();
    }, selector);
    await sleep(800);
    await dismissChatModals(page);
    const ready2 = await page
      .waitForSelector('#chat_textarea', { timeout: 8000, visible: true })
      .then(() => true)
      .catch(() => false);
    if (!ready2) return { ok: false, reason: 'no-chat-textarea' };
  }

  await page.click('#chat_textarea', { clickCount: 3 });
  await page.evaluate(() => {
    const ta = document.querySelector('#chat_textarea');
    if (ta) {
      ta.focus();
      ta.value = '';
    }
  });
  await page.type('#chat_textarea', message, { delay: 12 });

  await page.waitForSelector('#chat_sendbtn', { timeout: 5000 });
  await page.click('#chat_sendbtn');
  await sleep(450);

  return { ok: true };
}

async function sendHelloToFriends(
  page,
  { message = 'hello', maxMessages = 5, alreadyMessaged = new Set(), onMessageSent } = {},
) {
  await dismissChatModals(page);

  const messaged = new Set(alreadyMessaged);
  const results = [];
  const maxRounds = 8;
  let idleRounds = 0;
  let sentCount = 0;

  log(`Sending "${message}" (target ${maxMessages} successes this proxy)...`);

  while (sentCount < maxMessages && idleRounds < maxRounds) {
    const batch = await page.evaluate((selfNick) => {
      const root = document.querySelector('#friend_list');
      if (!root) return [];
      return [...root.querySelectorAll('a[data-userid]')]
        .map((a) => ({
          userId: a.getAttribute('data-userid'),
          nickname:
            a.querySelector('#nickname, span#nickname')?.textContent?.trim() ||
            a.getAttribute('href')?.replace(/^#/, '') ||
            null,
        }))
        .filter((f) => {
          if (!f.userId) return false;
          if (f.nickname && f.nickname.toLowerCase() === selfNick.toLowerCase()) return false;
          return true;
        });
    }, CONFIG.nickname);

    const pending = batch.filter((f) => !messaged.has(f.userId));

    if (!pending.length) {
      await page.evaluate(() => {
        const root =
          document.querySelector('#friend_list') ||
          document.querySelector('#friend_list ul')?.parentElement;
        if (root) root.scrollTop = (root.scrollTop || 0) + 600;
      });
      idleRounds += 1;
      await sleep(700);
      continue;
    }

    idleRounds = 0;

    for (const friend of pending) {
      if (sentCount >= maxMessages) break;

      const label = `${sentCount + 1}/${maxMessages} ${friend.nickname || friend.userId} (${friend.userId})`;
      try {
        await dismissChatModals(page);
        const res = await sendMessageToFriend(page, friend, message);
        messaged.add(friend.userId);
        if (res.ok) {
          sentCount += 1;
          log(`Sent → ${label}`);
          const entry = {
            userId: friend.userId,
            nickname: friend.nickname || friend.userId,
            ok: true,
          };
          results.push(entry);
          if (typeof onMessageSent === 'function') {
            try {
              onMessageSent(entry);
            } catch {}
          }
        } else {
          log(`Fail → ${label}: ${res.reason}`);
          results.push({
            userId: friend.userId,
            nickname: friend.nickname,
            ok: false,
            reason: res.reason,
          });
        }
      } catch (err) {
        messaged.add(friend.userId);
        log(`Fail → ${label}: ${err.message}`);
        results.push({
          userId: friend.userId,
          nickname: friend.nickname,
          ok: false,
          reason: err.message,
        });
        await dismissChatModals(page);
      }
      await sleep(Number(process.env.MSG_DELAY_MS || 800));
    }
  }

  log(`Proxy batch done: ${sentCount}/${maxMessages} sent`);
  return { results, messaged, sentCount };
}

function proxyToUpstreamUrl(proxy) {
  if (!proxy) return null;
  const auth =
    proxy.username != null && proxy.username !== ''
      ? `${encodeURIComponent(proxy.username)}:${encodeURIComponent(proxy.password || '')}@`
      : '';
  return `http://${auth}${proxy.host}:${proxy.port}`;
}

async function startLocalProxyRotator(initialUpstreamUrl) {
  const ProxyChain = require('proxy-chain');
  const state = { upstreamUrl: initialUpstreamUrl };

  const server = new ProxyChain.Server({
    port: Number(process.env.LOCAL_PROXY_PORT || 18080),
    // Always forward through the current upstream (swappable without restarting Chrome)
    prepareRequestFunction: () => ({
      requestAuthentication: false,
      upstreamProxyUrl: state.upstreamUrl || undefined,
    }),
  });

  await server.listen();
  const localPort = server.port;
  log(`Local proxy rotator listening on 127.0.0.1:${localPort}`);

  return {
    server,
    localPort,
    setUpstream(proxy) {
      state.upstreamUrl = proxyToUpstreamUrl(proxy);
      log(
        `Upstream switched → ${proxy.host}:${proxy.port} (session=${(proxy.password || '').match(/session-([^_]+)/)?.[1] || 'n/a'})`,
      );
    },
    async close() {
      await server.close(true);
    },
  };
}

async function resetBrowserSession(browser, page) {
  // Clear cookies / storage so the next proxy gets a clean Chatiw + CF session
  try {
    const client = await page.createCDPSession();
    await client.send('Network.clearBrowserCookies');
    await client.send('Network.clearBrowserCache');
  } catch {}
  try {
    await page.goto('about:blank', { waitUntil: 'domcontentloaded', timeout: 15000 });
  } catch {}
  // Close extra tabs; keep one page
  const pages = await browser.pages();
  for (const p of pages) {
    if (p !== page) {
      try {
        await p.close();
      } catch {}
    }
  }
  await sleep(500);
  return page;
}

/** Chatiw injects ad popunders (e.g. hovbi.com). Close any non-chatiw tab/window. */
function installAdPopupGuard(browser, mainPageRef) {
  const allowed = /(^|\.)chatiw\.(com|us|uk|es|fr|it)(\/|$)/i;
  const closeIfAd = async (targetPage) => {
    try {
      await sleep(400);
      if (targetPage === mainPageRef.page) return;
      let url = '';
      try {
        url = targetPage.url() || '';
      } catch {
        return;
      }
      // blank briefly while navigating — wait a bit
      if (!url || url === 'about:blank') {
        await sleep(1200);
        try {
          url = targetPage.url() || '';
        } catch {
          return;
        }
      }
      if (allowed.test(url) || url.startsWith('chrome') || url.startsWith('devtools')) return;
      log(`Closing ad/popup tab: ${url.slice(0, 120)}`);
      await targetPage.close().catch(() => {});
    } catch {}
  };

  browser.on('targetcreated', async (target) => {
    try {
      const type = target.type();
      if (type !== 'page' && type !== 'other') return;
      const p = await target.page();
      if (!p) return;
      await closeIfAd(p);
    } catch {}
  });

  // Periodic sweep in case popunders slip through
  const timer = setInterval(async () => {
    try {
      const pages = await browser.pages();
      for (const p of pages) {
        if (p === mainPageRef.page) continue;
        await closeIfAd(p);
      }
    } catch {}
  }, 2500);
  timer.unref?.();
  return () => clearInterval(timer);
}

async function loginAndMessage(page, { message, maxMessages, alreadyMessaged, onMessageSent }) {
  log('Navigating...');
  await page.goto(CONFIG.url, { waitUntil: 'domcontentloaded', timeout: 120000 });

  log('Solving CF#1...');
  await waitForCloudflare(page, { label: 'CF#1' });

  if (await isBanned(page)) {
    throw new Error('IP banned on this proxy');
  }

  await page.waitForSelector('input[name="nickname"], #submit_btn', { timeout: 60000 });
  await fillStartForm(page);
  await clickStartChat(page);
  await afterSubmitFlow(page);

  const friends = await extractFriends(page);
  fs.writeFileSync('friends.json', JSON.stringify(friends, null, 2));
  log(`Friend list: ${friends.length} users`);

  await dismissChatModals(page);
  await dismissChatModals(page);

  return sendHelloToFriends(page, {
    message,
    maxMessages,
    alreadyMessaged,
    onMessageSent,
  });
}

async function runMessagingJob(options = {}) {
  const username = String(options.username || options.nickname || CONFIG.nickname || '').trim();
  const age = String(options.age || CONFIG.age || '').trim();
  const message = String(options.message || process.env.MESSAGE || 'hello');
  const msgsPerProxy = Number(options.msgsPerProxy || CONFIG.msgsPerProxy);
  const onProgress = typeof options.onProgress === 'function' ? options.onProgress : null;

  if (!username) throw new Error('username is required');
  if (!age || !/^\d{1,3}$/.test(age)) throw new Error('age must be a number');

  // Per-job profile (form fill reads CONFIG)
  CONFIG.nickname = username;
  CONFIG.age = age;

  let proxies = loadProxyList(CONFIG.proxyListPath);
  if (!proxies.length && CONFIG.proxy) {
    const one = parseProxy(CONFIG.proxy);
    if (one) proxies = [one];
  }
  if (!proxies.length) {
    throw new Error(`No proxies found. Add ${CONFIG.proxyListPath} or set PROXY in .env`);
  }

  const sentTo = [];
  const job = {
    id: `job_${Date.now()}`,
    username,
    age,
    message,
    status: 'running',
    startedAt: new Date().toISOString(),
    finishedAt: null,
    totalSent: 0,
    proxiesUsed: 0,
    sentTo,
    error: null,
  };

  const emitProgress = () => {
    if (onProgress) {
      try {
        onProgress({
          ...job,
          sentTo: [...sentTo],
        });
      } catch {}
    }
  };

  log(`Job ${job.id} start: user=${username} age=${age} proxies=${proxies.length}`);
  log(`Plan: ${msgsPerProxy} msgs/proxy, rotate upstream WITHOUT closing browser`);
  emitProgress();

  const rotator = await startLocalProxyRotator(proxyToUpstreamUrl(proxies[0]));
  rotator.setUpstream(proxies[0]);

  log('Launching browser once (local proxy)...');
  const { browser, page } = await connect({
    headless: false,
    turnstile: true,
    args: [
      '--start-maximized',
      '--disable-popup-blocking',
    ],
    connectOption: { defaultViewport: null },
    proxy: {
      host: '127.0.0.1',
      port: String(rotator.localPort),
    },
  });

  const mainPageRef = { page };
  const stopAdGuard = installAdPopupGuard(browser, mainPageRef);
  log('Ad popup guard enabled (closes hovbi.com and other non-chatiw tabs)');

  const alreadyMessaged = new Set();
  const allResults = [];
  let totalSent = 0;
  let activePage = page;
  mainPageRef.page = activePage;

  try {
    for (let i = 0; i < proxies.length; i++) {
      const proxy = proxies[i];
      log(
        `======== Proxy ${i + 1}/${proxies.length} → ${proxy.host}:${proxy.port} user=${proxy.username} ========`,
      );

      rotator.setUpstream(proxy);
      if (i > 0) {
        activePage = await resetBrowserSession(browser, activePage);
        mainPageRef.page = activePage;
      }

      let batch;
      try {
        batch = await loginAndMessage(activePage, {
          message,
          maxMessages: msgsPerProxy,
          alreadyMessaged,
          onMessageSent: (entry) => {
            sentTo.push({
              userId: entry.userId,
              username: entry.nickname || entry.userId,
            });
            job.totalSent = sentTo.length;
            emitProgress();
          },
        });
      } catch (err) {
        log(`Proxy session error: ${err.message}`);
        batch = {
          results: [{ ok: false, reason: err.message }],
          messaged: alreadyMessaged,
          sentCount: 0,
          error: err.message,
        };
        try {
          activePage = await resetBrowserSession(browser, activePage);
          mainPageRef.page = activePage;
        } catch {}
      }

      for (const id of batch.messaged || []) alreadyMessaged.add(id);
      const tagged = (batch.results || []).map((r) => ({
        ...r,
        proxy: `${proxy.host}:${proxy.port}`,
        proxyIndex: i + 1,
        session: (proxy.password || '').match(/session-([^_]+)/)?.[1] || null,
      }));
      allResults.push(...tagged);
      totalSent = sentTo.length;
      job.totalSent = totalSent;
      job.proxiesUsed = i + 1;
      emitProgress();

      fs.writeFileSync(
        'send-results.json',
        JSON.stringify(
          {
            jobId: job.id,
            username,
            age,
            totalSent,
            proxiesUsed: i + 1,
            sentTo,
            alreadyMessaged: [...alreadyMessaged],
            results: allResults,
          },
          null,
          2,
        ),
      );

      log(`Progress: ${totalSent} total sent across ${i + 1} proxies (browser kept alive)`);
      await sleep(800);
    }
    job.status = 'completed';
  } catch (err) {
    job.status = 'failed';
    job.error = err.message || String(err);
    throw err;
  } finally {
    stopAdGuard();
    job.finishedAt = new Date().toISOString();
    job.totalSent = sentTo.length;
    job.sentTo = sentTo;
    emitProgress();
    log(`ALL DONE. Total sent: ${job.totalSent}`);
    if (!CONFIG.keepOpen) {
      try {
        await browser.close();
      } catch {}
    } else {
      log('KEEP_OPEN=1 — leaving browser open');
    }
    try {
      await rotator.close();
    } catch {}
  }

  return job;
}

async function main() {
  await runMessagingJob({
    username: process.env.NICKNAME || CONFIG.nickname,
    age: process.env.AGE || CONFIG.age,
    message: process.env.MESSAGE || 'hello',
  });
}

module.exports = {
  runMessagingJob,
  CONFIG,
};

if (require.main === module) {
  main().catch((err) => {
    console.error('\nERROR:', err.message || err);
    process.exitCode = 1;
  });
}