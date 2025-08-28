// routes/yodo_schedule.js
// Purpose: Server-side scheduler for Site 2 (Yodobashi) using node-cron.
// Exposes:
//   POST /api/yodo/schedule/start  { cron, items, timezone?, spreadMs?, id? }
//   POST /api/yodo/schedule/stop   { id }
//   GET  /api/yodo/schedule/list
//
// Notes:
// - "items" is an array of payloads accepted by addToCartAndCheckout({ url, quantity, autoClick, cvv? }).
// - CVV falls back to env (YODO_CVV/CVV/CARD_CVV) if not present.
// - Jobs run sequentially with an optional gap "spreadMs" between items.

const cron = require('node-cron');
const { getContext } = require('../context');
const { addToCartAndCheckout } = require('../sites/yodo_core');

const active = new Map(); // id -> cron task

function normalizeItem(it = {}) {
  const out = {
    url: String(it.url || '').trim(),
    quantity: Number(it.quantity || 1),
    autoClick: it.autoClick !== false, // default true
  };
  // Optional CVV per-item; otherwise route will fallback to env
  if (it.cvv != null) out.cvv = String(it.cvv);
  return out;
}

function envCVV() {
  return (
    process.env.YODO_CVV ||
    process.env.CVV ||
    process.env.CARD_CVV ||
    undefined
  );
}

module.exports = (app) => {
  // Start a schedule
  app.post('/api/yodo/schedule/start', async (req, res) => {
    try {
      const body = req.body || {};
      const cronExpr  = String(body.cron || '').trim(); // e.g., "30 9 * * *"
      const itemsIn   = Array.isArray(body.items) ? body.items : [];
      const timezone  = String(body.timezone || 'Asia/Tokyo');
      const spreadMs  = Number(body.spreadMs || 5000); // gap between items
      const id        = String(body.id || `yodo-${Date.now()}`);

      if (!cronExpr || !cron.validate?.(cronExpr)) {
        return res.status(400).json({ ok: false, error: 'Invalid or missing cron expression, e.g. "30 9 * * *"' });
      }
      if (!itemsIn.length) {
        return res.status(400).json({ ok: false, error: 'Missing items[] (at least one { url, ... })' });
      }

      // Stop existing same id
      if (active.has(id)) {
        try { active.get(id).stop(); } catch {}
        active.delete(id);
      }

      const items = itemsIn.map(normalizeItem);

      const task = cron.schedule(cronExpr, async () => {
        try {
          console.log('[YODO-SCHED] fire', { id, at: new Date().toISOString(), items: items.length });
          for (let i = 0; i < items.length; i++) {
            const payload = { ...items[i] };
            if (!payload.url) continue;

            // Inject CVV from env if not supplied
            if (!payload.cvv) {
              const c = envCVV();
              if (c) payload.cvv = String(c);
            }

            const ctx = await getContext('yodo');
            const page = await ctx.newPage();
            await page.bringToFront();

            // Mask CVV in logs
            const safe = { ...payload, cvv: payload.cvv ? '***' : undefined };
            console.log('[YODO-SCHED] run', i + 1, '/', items.length, safe);

            try {
              await addToCartAndCheckout(page, payload);
            } catch (e) {
              console.error('[YODO-SCHED] error on item', i + 1, e?.message || e);
            }

            if (i < items.length - 1 && spreadMs > 0) {
              await page.waitForTimeout(spreadMs);
            }
          }
        } catch (err) {
          console.error('[YODO-SCHED] task error', err?.message || err);
        }
      }, { timezone });

      active.set(id, task);
      task.start();
      return res.json({ ok: true, id, cron: cronExpr, timezone, items: items.length, spreadMs });
    } catch (err) {
      return res.status(500).json({ ok: false, error: String(err) });
    }
  });

  // Stop a schedule
  app.post('/api/yodo/schedule/stop', (req, res) => {
    const id = String((req.body && req.body.id) || '');
    const t = active.get(id);
    if (!t) return res.status(404).json({ ok: false, error: 'Not found', id });
    try { t.stop(); } catch {}
    active.delete(id);
    return res.json({ ok: true, id });
  });

  // List schedules
  app.get('/api/yodo/schedule/list', (_req, res) => {
    return res.json({ ok: true, ids: Array.from(active.keys()) });
  });
};
