// context.js
// Per-site contexts with safe defaults.
// - 'ali'  : launchPersistentContext (stable)
// - 'yodo' : persistent by default; optional CDP if YODO_USE_CDP=true (with fallback)
// - 'big'  : CDP attach preferred (dùng Chrome bạn tự mở, port 9222 mặc định)

const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const { chromium } = require('playwright');

const cache = new Map(); // site -> BrowserContext

function bool(v, dflt = false) {
  if (v === undefined) return dflt;
  return String(v).toLowerCase() === 'true';
}
function ensureDir(p) { fs.mkdirSync(p, { recursive: true }); return p; }
async function sleep(ms){ return new Promise(r=>setTimeout(r,ms)); }

// ---------------------- Common helpers ----------------------
function chromeExecutableGuess() {
  if (process.platform === 'darwin') {
    return '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  }
  if (process.platform === 'win32') {
    const cand = [
      'C:\\\\Program Files\\\\Google\\\\Chrome\\\\Application\\\\chrome.exe',
      'C:\\\\Program Files (x86)\\\\Google\\\\Chrome\\\\Application\\\\chrome.exe',
    ];
    for (const x of cand) if (fs.existsSync(x)) return x;
    return 'chrome.exe';
  }
  return 'google-chrome'; // linux common name
}

// ---------------------- CDP helpers (Yodo - giữ nguyên) ----------------------
async function launchChromeForCDP(port, profileDir) {
  const exe = process.env.YODO_CHROME || chromeExecutableGuess();
  const args = [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${path.resolve(profileDir)}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--lang=ja-JP',
  ];
  const child = spawn(exe, args, { stdio: 'ignore', detached: true });
  child.unref();
}
async function connectYodoViaCDP() {
  const USER_ROOT = process.env.USER_DATA_DIR || './user-data';
  const profileDir = ensureDir(path.join(USER_ROOT, 'yodo_cdp'));
  const port = Number(process.env.YODO_CDP_PORT || 9223);

  for (let i = 0; i < 3; i++) {
    try {
      const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
      const ctx = browser.contexts()[0] || (await browser.newContext());
      return ctx;
    } catch {
      if (i === 0) await launchChromeForCDP(port, profileDir);
      await sleep(600 + i * 500);
    }
  }
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  const ctx = browser.contexts()[0] || (await browser.newContext());
  return ctx;
}

// ---------------------- CDP helpers (BigCamera) ----------------------
// Ưu tiên attach vào Chrome thật do bạn mở (tránh dấu hiệu automation)
async function launchChromeForCDP_Big(port, profileDir) {
  const exe = process.env.BIG_CHROME || chromeExecutableGuess();
  const args = [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${path.resolve(profileDir)}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--lang=ja-JP',
    '--proxy-server=direct://',
    '--proxy-bypass-list=*',
    '--disable-quic',
  ];
  const child = spawn(exe, args, { stdio: 'ignore', detached: true });
  child.unref();
}
async function connectBigViaCDP() {
  const USER_ROOT = process.env.USER_DATA_DIR || './user-data';
  const profileDir = ensureDir(path.join(USER_ROOT, 'big_cdp'));
  const port = Number(process.env.BIG_CDP_PORT || process.env.CDP_PORT || 9222);
  const url = process.env.BIG_CDP_URL || `http://127.0.0.1:${port}`;

  for (let i = 0; i < 4; i++) {
    try {
      const browser = await chromium.connectOverCDP(url);
      const ctx = browser.contexts()[0] || (await browser.newContext({
        locale: 'ja-JP',
        timezoneId: 'Asia/Tokyo',
        acceptDownloads: true,
      }));
      ctx.__attached = true; // đừng đóng Chrome thật khi shutdown
      return ctx;
    } catch {
      if (i === 0 && bool(process.env.BIG_LAUNCH_IF_NOT_RUNNING, true)) {
        await launchChromeForCDP_Big(port, profileDir);
      }
      await sleep(700 + i * 500);
    }
  }
  const browser = await chromium.connectOverCDP(url);
  const ctx = browser.contexts()[0] || (await browser.newContext({
    locale: 'ja-JP',
    timezoneId: 'Asia/Tokyo',
    acceptDownloads: true,
  }));
  ctx.__attached = true;
  return ctx;
}

// ---------------------- Stealth patches per site ----------------------
async function applyStealth(context, site) {
  // Nếu đã attach vào Chrome thật thì không cần stealth nặng
  if (context.__attached) return;

  if (site === 'yodo') {
    await context.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
      Object.defineProperty(navigator, 'languages', { get: () => ['ja-JP','ja','en-US','en'] });
      Object.defineProperty(navigator, 'plugins', { get: () => [1,2,3] });
      // eslint-disable-next-line no-undef
      window.chrome = window.chrome || { runtime: {} };
      Object.defineProperty(navigator, 'platform', { get: () => 'MacIntel' });
      const origQuery = navigator.permissions?.query?.bind(navigator.permissions);
      if (origQuery) {
        navigator.permissions.query = (p) => {
          if (p && p.name === 'notifications') {
            return Promise.resolve({ state: Notification.permission });
          }
          return origQuery(p);
        };
      }
      const _getParam = WebGLRenderingContext.prototype.getParameter;
      WebGLRenderingContext.prototype.getParameter = function(p) {
        if (p === 37445) return 'Intel Inc.';
        if (p === 37446) return 'Intel Iris OpenGL Engine';
        return _getParam.apply(this, arguments);
      };
      Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 8 });
      Object.defineProperty(navigator, 'deviceMemory', { get: () => 8 });
    });
  } else if (site === 'ali') {
    await context.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
      // eslint-disable-next-line no-undef
      window.chrome = window.chrome || { runtime: {} };
    });
  } else {
    await context.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    });
  }
}

// ---------------------- Factory: persistent context ----------------------
async function createPersistent(site) {
  const USER_DATA_ROOT = process.env.USER_DATA_DIR || './user-data';
  const DISK_CACHE_ROOT = process.env.DISK_CACHE_DIR || './.disk-cache';
  const PROFILE_DIR = ensureDir(path.join(USER_DATA_ROOT, site));
  const CACHE_DIR   = ensureDir(path.join(DISK_CACHE_ROOT, site));

  const ctx = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless: bool(process.env.HEADLESS, false),
    channel: bool(process.env.USE_CHROME, true) ? 'chrome' : undefined,
    viewport: { width: 1420, height: 900 },
    locale: 'ja-JP',
    timezoneId: 'Asia/Tokyo',
    acceptDownloads: true,
    userAgent:
      process.env.USER_AGENT ||
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 13_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    args: [
      '--proxy-server=direct://',
      '--proxy-bypass-list=*',
      '--disable-quic',
      '--lang=ja-JP',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-blink-features=AutomationControlled',
    ],
    diskCachePath: CACHE_DIR
  });

  // best-effort hide webdriver
  await ctx.addInitScript(() => {
    try { Object.defineProperty(navigator, 'webdriver', { get: () => undefined }); } catch {}
  });

  return ctx;
}

// ---------------------- Public API ----------------------
async function getContext(site = 'default') {
  const existing = cache.get(site);
  if (existing && !existing.isClosed?.()) return existing;

  let ctx;

  if (site === 'yodo') {
    const useCDP = String(process.env.YODO_USE_CDP || 'false').toLowerCase() === 'true';
    if (useCDP) {
      try {
        console.log('[context] yodo: trying CDP…');
        ctx = await connectYodoViaCDP();
        console.log('[context] yodo: CDP connected.');
      } catch (e) {
        console.warn('[context] yodo: CDP failed, fallback → persistent:', e.message);
        ctx = await createPersistent('yodo');
      }
    } else {
      ctx = await createPersistent('yodo');
    }
    await applyStealth(ctx, 'yodo');

  } else if (site === 'ali') {
    ctx = await createPersistent('ali');
    await applyStealth(ctx, 'ali');

  } else if (site === 'big') {
    // Ưu tiên CDP attach vào Chrome bạn đang mở (port 9222 mặc định)
    const useCDP = String(process.env.BIG_USE_CDP ?? 'true').toLowerCase() !== 'false';
    if (useCDP) {
      try {
        console.log('[context] big: trying CDP attach…');
        ctx = await connectBigViaCDP();
        console.log('[context] big: CDP attached.');
      } catch (e) {
        console.warn('[context] big: CDP failed, fallback → persistent:', e.message);
        ctx = await createPersistent('big');
      }
    } else {
      ctx = await createPersistent('big');
    }
    await applyStealth(ctx, 'big');

  } else {
    // Other sites
    ctx = await createPersistent(site);
    await applyStealth(ctx, site);
  }

  // Common headers for JP sites
  await ctx.setExtraHTTPHeaders?.({
    'Accept-Language': 'ja,en-US;q=0.9,en;q=0.8',
    'Upgrade-Insecure-Requests': '1',
  });

  // Do not block anything
  await ctx.route('**/*', (route) => route.continue());

  ctx.setDefaultTimeout(2500);
  ctx.setDefaultNavigationTimeout(8000);

  cache.set(site, ctx);
  return ctx;
}

module.exports = { getContext };
