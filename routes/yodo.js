// routes/yodo.js
// Purpose: Site 2 (Yodobashi) routes — forgiving payload parsing + env CVV.
// All comments in English.

const { getContext } = require('../context');
const { addToCartAndCheckout } = require('../sites/yodo_core');

const LOGIN_URL =
  'https://order.yodobashi.com/yc/login/index.html?returnUrl=https%3A%2F%2Fwww.yodobashi.com%2F';

// ---------- helpers ----------
function normalizePayload(req) {
  let raw = req.body ?? {};
  if (typeof raw === 'string') { try { raw = JSON.parse(raw); } catch { raw = {}; } }
  const q = req.query || {};

  const pick = (...xs) => {
    for (const x of xs) {
      if (x !== undefined && x !== null && String(x).trim() !== '') return x;
    }
    return undefined;
  };
  const toBool = (v, dflt) => {
    if (v === undefined) return dflt;
    if (typeof v === 'boolean') return v;
    const s = String(v).toLowerCase();
    return ['1','true','yes','y','on'].includes(s);
  };
  const toNum = (v, dflt) => {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : dflt;
  };

  return {
    // accept many aliases including confirmUrl
    url: pick(
      raw.url, raw.productUrl, raw.checkoutUrl, raw.confirmUrl,
      q.url,   q.productUrl,   q.checkoutUrl,   q.confirmUrl, q.link, q.href
    ),
    quantity: toNum(pick(raw.quantity, raw.qty, q.quantity, q.qty), 1),
    autoClick: toBool(pick(raw.autoClick, q.autoClick), true),
    cvv: pick(raw.cvv, q.cvv),
    skipCVV: toBool(pick(raw.skipCVV, q.skipCVV), true),
  };
}

// ---------- routes ----------
module.exports = (app) => {
  // Health/status
  app.get('/api/yodo/status', async (_req, res) => {
    try { return res.json({ ok: true, loginUrl: LOGIN_URL }); }
    catch (err) { return res.status(500).json({ ok: false, error: String(err) }); }
  });

  // Open arbitrary page (keep session warm)
  app.get('/api/yodo/open', async (req, res) => {
    const url =
      (req.query.url && decodeURIComponent(String(req.query.url))) ||
      'https://www.yodobashi.com/';
    try {
      const ctx = await getContext('yodo');
      const page = await ctx.newPage();
      await page.bringToFront();
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      console.log('[Site 2] Opened:', url);
      return res.json({ ok: true, url });
    } catch (err) {
      console.error('[Site 2] Open fail:', err);
      return res.status(500).json({ ok: false, error: String(err) });
    }
  });

  // Login: force a visible new tab then navigate to LOGIN_URL
  app.post('/api/yodo/login', async (_req, res) => {
    try {
      const ctx = await getContext('yodo');
      const page = await ctx.newPage();
      await page.bringToFront();
      await page.goto('about:blank');
      await page.waitForTimeout(300);
      await page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
      try { await page.evaluate(() => window.focus()); } catch {}
      console.log('[Site 2] Login page opened');
      return res.json({ ok: true, loginUrl: LOGIN_URL });
    } catch (err) {
      console.error('[Site 2] Login open fail:', err);
      return res.status(500).json({ ok: false, error: String(err) });
    }
  });

  // Checkout (POST/GET). Accepts aliases + env CVV fallback.
  const handleCheckout = async (req, res) => {
    try {
      const payload = normalizePayload(req);
      if (!payload.url) {
        return res.status(400).json({
          ok: false,
          error: 'Missing "url". Accepts url/productUrl/checkoutUrl/confirmUrl/link/href.',
          received: { body: req.body, query: req.query }
        });
      }

      // Inject CVV from environment if not provided
      const cvvEnv = process.env.YODO_CVV || process.env.CVV || process.env.CARD_CVV;
      if (!payload.cvv && cvvEnv) payload.cvv = String(cvvEnv);

      const ctx = await getContext('yodo');
      const page = await ctx.newPage();
      await page.bringToFront();

      // Redact CVV in logs
      const safeLog = { ...payload, cvv: payload.cvv ? '***' : undefined };
      console.log('[Site 2] Checkout start:', safeLog);

      await addToCartAndCheckout(page, payload);
      console.log('[Site 2] Checkout flow executed');

      return res.json({ ok: true, message: 'Checkout flow executed' });
    } catch (err) {
      console.error('[Site 2] Checkout failed:', err);
      return res.status(500).json({ ok: false, error: String(err) });
    }
  };

  app.post('/api/yodo/checkout', handleCheckout);
  app.get('/api/yodo/checkout', handleCheckout);
};
