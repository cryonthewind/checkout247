// routes/ali.js
// Purpose: Site 1 (AliExpress) routes
// - /api/status: health check
// - /api/login : open AE login page
// - /api/fast-checkout : perform fast checkout using ali_core.js

const { getContext } = require('../context');
const { fastCheckout } = require('../sites/ali_core');

// Normalize payload from body or query
function normalizePayload(req) {
  let raw = req.body ?? {};
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

  return {
    confirmUrl: pick(raw.confirmUrl, raw.url, raw.checkoutUrl, q.confirmUrl, q.url, q.checkoutUrl),
    last4: pick(raw.last4, raw.cardLast4, q.last4, q.cardLast4),
    autoClick: pick(raw.autoClick, q.autoClick),
  };
}

module.exports = (app) => {
  // Health check
  app.get('/api/status', async (_req, res) => {
    try {
      return res.json({ ok: true, site: 'ali' });
    } catch (err) {
      return res.status(500).json({ ok: false, error: String(err) });
    }
  });
  // In routes/ali.js
  app.get('/api/ali/open', async (req, res) => {
    try {
      const url = String(req.query.url || 'https://ja.aliexpress.com/').trim();
      const ctx = await getContext('ali');
      const page = await ctx.newPage();
      await page.bringToFront();
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      return res.json({ ok: true, url });
    } catch (e) { return res.status(500).json({ ok:false, error: String(e.message||e) }); }
  });

  // Back-compat alias for current UI
  app.get('/api/open', (req, res) =>
    app._router.handle(Object.assign(req, { url: '/api/ali/open' + (req._parsedUrl.search || '') }), res)
  );


  // Login page (AliExpress)
  app.get('/api/login', async (_req, res) => {
    try {
      const ctx = await getContext('ali');
      const page = await ctx.newPage();
      await page.bringToFront();
      await page.goto('https://login.aliexpress.com/', {
        waitUntil: 'domcontentloaded',
        timeout: 30000,
      });
      console.log('[Ali] Login page opened');
      return res.json({ ok: true, url: 'https://login.aliexpress.com/' });
    } catch (err) {
      console.error('[Ali] Login error:', err);
      return res.status(500).json({ ok: false, error: String(err) });
    }
  });

  // Fast checkout
  app.post('/api/fast-checkout', async (req, res) => {
    try {
      const { confirmUrl, last4 } = normalizePayload(req);
      if (!confirmUrl) {
        return res.status(400).json({
          ok: false,
          error: 'Missing confirmUrl',
          example: {
            method: 'POST',
            path: '/api/fast-checkout',
            headers: { 'Content-Type': 'application/json' },
            body: { confirmUrl: 'https://www.aliexpress.com/p/trade/confirm.html?...', last4: '5063' }
          }
        });
      }

      console.log('[Ali] Fast checkout start:', confirmUrl, last4 || '');
      const result = await fastCheckout(confirmUrl, last4);
      console.log('[Ali] Fast checkout done:', result);
      return res.json({ ok: true, ...result });
    } catch (err) {
      console.error('[Ali] Fast checkout error:', err);
      return res.status(500).json({ ok: false, error: err.message });
    }
  });
};
