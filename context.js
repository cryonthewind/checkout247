// context.js
// Per-site contexts with safe defaults.
// - 'ali'  : launchPersistentContext (stable)
// - 'yodo' : persistent by default; optional CDP if YODO_USE_CDP=true (with fallback)

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

// ---------------------- CDP helpers (optional for Yodo) ----------------------
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
async function sleep(ms){ return new Promise(r=>setTimeout(r,ms)); }

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

  // Try to connect; if not up, launch then retry a few times
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
  // Final attempt (will throw if still failing)
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  const ctx = browser.contexts()[0] || (await browser.newContext());
  return ctx;
}

// ---------------------- Stealth patches per site ----------------------
async function applyStealth(context, site) {
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
    userAgent:
      process.env.USER_AGENT ||
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 13_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    args: [
      `--disk-cache-dir=${path.resolve(CACHE_DIR)}`,
      '--no-first-run',
      '--no-default-browser-check',
      // Do NOT add "--disable-blink-features=AutomationControlled"
    ],
  });
  return ctx;
}

// ---------------------- Public API ----------------------
async function getContext(site = 'default') {
  const existing = cache.get(site);
  if (existing && !existing.isClosed?.()) return existing;

  let ctx;
  if (site === 'yodo') {
    // Default = persistent; CDP only when explicitly requested
    const useCDP = String(process.env.YODO_USE_CDP || 'false').toLowerCase() === 'true';
    if (useCDP) {
      try {
        console.log('[context] yodo: trying CDP…');
        ctx = await connectYodoViaCDP();
        console.log('[context] yodo: CDP connected.');
      } catch (e) {
        console.warn('[context] yodo: CDP failed, fallback to persistent. Reason:', e.message);
        ctx = await createPersistent('yodo');
      }
    } else {
      ctx = await createPersistent('yodo');
    }
    await applyStealth(ctx, 'yodo');
  } else if (site === 'ali') {
    ctx = await createPersistent('ali');
    await applyStealth(ctx, 'ali');
  } else {
    ctx = await createPersistent(site);
    await applyStealth(ctx, site);
  }

  // Do not block CSS/fonts to avoid ORB/CSS breakage
  await ctx.route('**/*', (route) => route.continue());

  ctx.setDefaultTimeout(2500);
  ctx.setDefaultNavigationTimeout(8000);

  cache.set(site, ctx);
  return ctx;
}

module.exports = { getContext };
