// routes/yodo.js
// Purpose: Site 2 (Yodobashi) routes with very forgiving payload parsing.
// - Accepts JSON body OR querystring for /api/yodo/checkout
// - Accepts multiple field names: url/productUrl/checkoutUrl/link/href, quantity/qty, autoClick, cvv, skipCVV
// - Uses getContext('yodo') so it won't affect Site 1
// - Keeps pages open so the user can see browser state

const { getContext } = require('../context');
const { addToCartAndCheckout } = require('../sites/yodo_core');

const LOGIN_URL =
  'https://order.yodobashi.com/yc/login/index.html?returnUrl=https%3A%2F%2Fwww.yodobashi.com%2F';

// Normalize incoming payload from body or query
function normalizePayload(req) {
  let raw = req.body ?? {};
  // If body came as a string (wrong content-type), try to parse it
  if (typeof raw === 'string') {
    try { raw = JSON.parse(raw); } catch { raw = {}; }
  }
  const q = req.query || {};

  const pick = (...candidates) => {
    for (const c of candidates) {
      if (c !== undefined && c !== null && String(c).trim() !== '') return c;
    }
    return undefined;
  };

  const payload = {
    url: pick(raw.url, raw.productUrl, raw.checkoutUrl, q.url, q.productUrl, q.checkoutUrl, q.link, q.href),
    quantity: Number(pick(raw.quantity, raw.qty, q.quantity, q.qty)) || 1,
    autoClick: pick(raw.autoClick, q.autoClick),
    cvv: pick(raw.cvv, q.cvv),
    skipCVV: pick(raw.skipCVV, q.skipCVV),
  };

  // Booleans may arrive as strings
  const toBool = (v, dflt) => {
    if (v === undefined) return dflt;
    if (typeof v === 'boolean') return v;
    const s = String(v).toLowerCase();
    return ['1', 'true', 'yes', 'y'].includes(s);
  };

  payload.autoClick = toBool(payload.autoClick, true);
  payload.skipCVV   = toBool(payload.skipCVV, true);

  // Final shaping
  if (payload.url) payload.url = String(payload.url);
  if (payload.cvv !== undefined) payload.cvv = String(payload.cvv);

  return payload;
}

module.exports = (app) => {
  // Health/status
  app.get('/api/yodo/status', async (_req, res) => {
    try {
      return res.json({ ok: true, loginUrl: LOGIN_URL });
    } catch (err) {
      return res.status(500).json({ ok: false, error: String(err) });
    }
  });

  // Open arbitrary page in a new tab
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

  // Login: bring a tab to front then navigate to LOGIN_URL
  app.post('/api/yodo/login', async (_req, res) => {
    try {
      const ctx = await getContext('yodo');
      const page = await ctx.newPage();
      await page.bringToFront();
      await page.goto('about:blank');
      await page.waitForTimeout(300);
      await page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
      console.log('[Site 2] Login page opened');
      return res.json({ ok: true, loginUrl: LOGIN_URL });
    } catch (err) {
      console.error('[Site 2] Login open fail:', err);
      return res.status(500).json({ ok: false, error: String(err) });
    }
  });

  // Checkout (accept JSON body or querystring)
  const handleCheckout = async (req, res) => {
    try {
      const payload = normalizePayload(req);

      if (!payload.url) {
        // Helpful error with example
        return res.status(400).json({
          ok: false,
          error: 'Missing "url". Send JSON body or querystring.',
          example: {
            method: 'POST',
            path: '/api/yodo/checkout',
            headers: { 'Content-Type': 'application/json' },
            body: { url: 'https://www.yodobashi.com/product/XXXX', quantity: 2, autoClick: true }
          },
          received: { body: req.body, query: req.query }
        });
      }

      const ctx = await getContext('yodo');
      const page = await ctx.newPage();
      await page.bringToFront();

      console.log('[Site 2] Checkout start:', payload);
      await addToCartAndCheckout(page, payload);
      console.log('[Site 2] Checkout flow executed');

      return res.json({ ok: true, message: 'Checkout flow executed' });
    } catch (err) {
      console.error('[Site 2] Checkout failed:', err);
      return res.status(500).json({ ok: false, error: String(err) });
    }
  };

  app.post('/api/yodo/checkout', handleCheckout);
  // Optional: allow GET for quick testing: /api/yodo/checkout?url=...&quantity=2
  app.get('/api/yodo/checkout', handleCheckout);
};
