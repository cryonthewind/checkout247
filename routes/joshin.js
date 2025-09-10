// routes/joshin.js
// Purpose: Routes for Site 4 - Joshin (Add to cart only), same export style as routes/big.js
// All comments in English.

const path = require('path');
const express = require('express');
const { newPageForSite } = require('../context'); // open a NEW TAB each run
const { addToCartOnly } = require('../sites/joshin_core');

const LOGIN_URL = 'https://joshinweb.jp/';

function normalizePayload(req) {
  let raw = req.body ?? {};
  if (typeof raw === 'string') { try { raw = JSON.parse(raw); } catch { raw = {}; } }
  const q = req.query || {};
  const pick = (...xs) => { for (const x of xs) { if (x !== undefined && x !== null && String(x).trim() !== '') return x; } };
  const toBool = (v, d) => v === undefined ? d : ['1','true','yes','y','on'].includes(String(v).toLowerCase());

  return {
    url: pick(
      raw.url, raw.productUrl, raw.checkoutUrl, raw.confirmUrl,
      q.url,   q.productUrl,   q.checkoutUrl,   q.confirmUrl,
      q.link,  q.href
    ),
    autoClick: toBool(pick(raw.autoClick, q.autoClick), true),
  };
}

module.exports = (app) => {
  // Static UI (optional mount if you serve /joshin UI)
  app.use('/joshin', express.static(path.join(__dirname, '..', 'public', 'joshin')));

  // Status + Login
  app.get('/api/joshin/status', (_req, res) => res.json({ ok: true, loginUrl: LOGIN_URL }));

  // Always open login in a NEW TAB
  app.post('/api/joshin/login', async (_req, res) => {
    try {
      const page = await newPageForSite('joshin'); // new tab
      await page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
      res.json({ ok: true, loginUrl: LOGIN_URL });
    } catch (err) {
      console.error('[Joshin] Login open fail:', err);
      res.status(500).json({ ok: false, error: String(err) });
    }
  });

  app.post('/api/joshin/save-session', async (_req, res) => res.json({ ok: true }));

  // Core handler: Add to cart ONLY
  const handleAdd = async (req, res) => {
    try {
      const payload = normalizePayload(req);
      if (!payload.url) return res.status(400).json({ ok: false, error: 'Missing "url"' });

      const page = await newPageForSite('joshin'); // always new tab like Big
      console.log('[Joshin] Add-to-cart start:', payload.url);
      const out = await addToCartOnly(page, payload);
      res.json({ ok: true, message: 'Add-to-cart executed', ...out });
    } catch (err) {
      console.error('[Joshin] Add-to-cart failed:', err);
      res.status(500).json({ ok: false, error: String(err) });
    }
  };

  // Endpoints (single) + aliases for UI compatibility
  app.post('/api/joshin/add', handleAdd);
  app.get('/api/joshin/add',  handleAdd);
  app.post('/api/joshin/run', handleAdd);   // alias so existing UI calling /run works
  app.get('/api/joshin/run',  handleAdd);

  // Batch (optional; reuse same new-tab logic per item)
  app.post('/api/joshin/batch', async (req, res) => {
    const items = Array.isArray(req.body?.items) ? req.body.items : [];
    if (!items.length) return res.json({ ok: true, results: [] });
    const results = [];
    for (const it of items) {
      try {
        const page = await newPageForSite('joshin');
        const r = await addToCartOnly(page, { url: it.url, autoClick: true });
        results.push({ ok: true, url: it.url, result: r });
      } catch (e) {
        results.push({ ok: false, url: it.url, error: String(e.message || e) });
      }
    }
    res.json({ ok: true, results });
  });

  console.log('[Site 4] Joshin routes mounted');
};
