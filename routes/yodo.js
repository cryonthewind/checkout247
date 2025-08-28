// routes/yodo.js
// Purpose: Site 2 (Yodobashi) routes.
// Notes:
// - Uses getContext('yodo') so it won't affect Site 1.
// - Exposes minimal endpoints used by the Site 2 tab in the UI.
// - Keep pages open (do not close) so the user can see the flow.
// - All comments in English as requested.

const { getContext } = require('../context');
const { addToCartAndCheckout } = require('../sites/yodo_core');

const LOGIN_URL =
  'https://order.yodobashi.com/yc/login/index.html?returnUrl=https%3A%2F%2Fwww.yodobashi.com%2F';

module.exports = (app) => {
  // Health/status
  app.get('/api/yodo/status', async (_req, res) => {
    try {
      return res.json({ ok: true, loginUrl: LOGIN_URL });
    } catch (err) {
      return res.status(500).json({ ok: false, error: String(err) });
    }
  });

  // Open arbitrary page in a new tab (used by "Open Chrome for login" or debugging)
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

  // Login flow: open a visible tab first, then navigate to LOGIN_URL
  app.post('/api/yodo/login', async (_req, res) => {
    try {
      const ctx = await getContext('yodo');
      const page = await ctx.newPage();
      await page.bringToFront();
      // Open a blank first (helps some anti-bot heuristics), then go login
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

  // Checkout flow: expects { url, quantity, autoClick, cvv }
  app.post('/api/yodo/checkout', async (req, res) => {
    const { url, quantity, autoClick, cvv } = req.body || {};
    if (!url) {
      return res.status(400).json({ ok: false, error: 'Missing "url" in body' });
    }
    try {
      const ctx = await getContext('yodo');
      const page = await ctx.newPage();
      await page.bringToFront();

      const payload = {
        url: String(url),
        quantity: Number(quantity) || 1,
        autoClick: typeof autoClick === 'boolean' ? autoClick : true,
        cvv: cvv ? String(cvv) : undefined,
      };

      console.log('[Site 2] Checkout start:', payload);
      await addToCartAndCheckout(page, payload);
      console.log('[Site 2] Checkout flow executed');

      // Keep the page open so the user can see the result
      return res.json({ ok: true, message: 'Checkout flow executed' });
    } catch (err) {
      console.error('[Site 2] Checkout failed:', err);
      return res.status(500).json({ ok: false, error: String(err) });
    }
  });
};
