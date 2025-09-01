// routes/yodo_schedule.js
// Purpose: Server-side scheduler for Site 2 (Yodobashi) using node-cron.
// Exposes:
//   POST /api/yodo/schedule/start  { cron, items, timezone?, spreadMs?, id?, second?, at? }
//   POST /api/yodo/schedule/stop   { id }
//   GET  /api/yodo/schedule/list
//
// Notes:
// - "items" is an array of payloads accepted by addToCartAndCheckout({ url, quantity, autoClick, cvv? }).
// - CVV falls back to env (YODO_CVV/CVV/CARD_CVV) if not present.
// - Jobs run sequentially with an optional gap "spreadMs" between items.
// - Added seconds support:
//    • If 'cron' has 6 fields, it's used as-is (second minute hour dom mon dow).
//    • If 'cron' has 5 fields + 'second' provided, we prepend second.
//    • If 'at' = 'HH:mm:ss' provided, we convert it to 'ss mm HH * * *'.
//    • Validation checks both 6-field and 5-field (with upgrade) paths.

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

/** Parse "HH:mm:ss" -> {h,m,s} with range checks */
function parseAt(atStr) {
  if (typeof atStr !== 'string') return null;
  const m = atStr.trim().match(/^(\d{1,2}):(\d{2}):(\d{2})$/);
  if (!m) return null;
  const h = Number(m[1]), mm = Number(m[2]), s = Number(m[3]);
  if (h < 0 || h > 23) return null;
  if (mm < 0 || mm > 59) return null;
  if (s < 0 || s > 59) return null;
  return { h, m: mm, s };
}

/** Build a 6-field cron (with seconds) from inputs */
function buildCronWithSeconds({ cronExpr, second, at }) {
  // 1) If 'at' is provided, convert to "ss mm HH * * *"
  const parsedAt = parseAt(at);
  if (parsedAt) {
    const { h, m, s } = parsedAt;
    return `${s} ${m} ${h} * * *`;
  }

  const expr = String(cronExpr || '').trim().replace(/\s+/g, ' ');
  if (!expr) return null;

  const parts = expr.split(' ');
  if (parts.length === 6) {
    // Already has seconds
    return expr;
  }

  if (parts.length === 5) {
    // Try to upgrade 5-field -> 6-field using 'second'
    let sec = second;
    if (sec == null || sec === '') sec = 0; // default to 0 if not provided
    const sNum = Number(sec);
    if (!Number.isFinite(sNum) || sNum < 0 || sNum > 59) {
      throw new Error('Invalid "second" (0-59) when upgrading 5-field cron to 6-field.');
    }
    return `${sNum} ${expr}`; // prepend seconds
  }

  // Unsupported field count
  return null;
}

module.exports = (app) => {
  // Start a schedule
  app.post('/api/yodo/schedule/start', async (req, res) => {
    try {
      const body = req.body || {};
      const rawCron   = String(body.cron || '').trim(); // may be 5 or 6 fields
      const at        = body.at; // "HH:mm:ss" optional
      const second    = body.second; // optional second (0-59) to upgrade 5-field
      const itemsIn   = Array.isArray(body.items) ? body.items : [];
      const timezone  = String(body.timezone || 'Asia/Tokyo');
      const spreadMs  = Number(body.spreadMs || 5000); // gap between items
      const id        = String(body.id || `yodo-${Date.now()}`);

      if (!itemsIn.length) {
        return res.status(400).json({ ok: false, error: 'Missing items[] (at least one { url, ... })' });
      }

      // Build a valid 6-field cron with seconds
      let cronExpr;
      try {
        cronExpr = buildCronWithSeconds({ cronExpr: rawCron, second, at });
      } catch (e) {
        return res.status(400).json({ ok: false, error: e.message || String(e) });
      }
      if (!cronExpr) {
        return res.status(400).json({
          ok: false,
          error: 'Invalid cron/at. Provide either 6-field cron (e.g. "59 29 9 * * *"), or 5-field + second, or at="HH:mm:ss".'
        });
      }

      // Validate using node-cron (supports seconds)
      if (!cron.validate?.(cronExpr)) {
        return res.status(400).json({
          ok: false,
          error: `Invalid cron expression: "${cronExpr}". Expected "sec min hour dom mon dow".`
        });
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
      return res.json({
        ok: true,
        id,
        cron: cronExpr,         // now 6-field with seconds when applicable
        timezone,
        items: items.length,
        spreadMs,
        hint: 'Format is "sec min hour dom mon dow". Example 09:29:59 -> "59 29 9 * * *".'
      });
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
