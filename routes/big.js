// routes/big.js
const path = require('path');
const express = require('express');
const { newPageForSite } = require('../context');     // dùng helper mở TAB MỚI
const { addToCartAndCheckout } = require('../sites/big_core');

const LOGIN_URL = 'https://www.biccamera.com/bc/member/SfrLogin.jsp';

function normalizePayload(req) {
  let raw = req.body ?? {};
  if (typeof raw === 'string') { try { raw = JSON.parse(raw); } catch { raw = {}; } }
  const q = req.query || {};
  const pick = (...xs) => { for (const x of xs) { if (x !== undefined && x !== null && String(x).trim() !== '') return x; } };
  const toBool = (v, d) => v === undefined ? d : ['1','true','yes','y','on'].includes(String(v).toLowerCase());
  const toNum  = (v, d) => { const n = Number(v); return Number.isFinite(n) ? n : d; };

  const autoClick  = toBool(pick(raw.autoClick,  q.autoClick),  true);
  const placeOrder = toBool(pick(raw.placeOrder, q.placeOrder, raw.autoClick, q.autoClick), autoClick);

  return {
    url:       pick(raw.url, raw.productUrl, raw.checkoutUrl, raw.confirmUrl, q.url, q.productUrl, q.checkoutUrl, q.confirmUrl, q.link, q.href),
    quantity:  toNum(pick(raw.quantity, raw.qty, q.quantity, q.qty), 1),
    autoClick,
    placeOrder,        // theo tick trên UI
    maxSteps:  toNum(pick(raw.maxSteps, q.maxSteps), 3),
  };
}

module.exports = (app) => {
  app.use('/bigcamera', express.static(path.join(__dirname, '..', 'public', 'bigcamera')));

  app.get('/api/big/status', (_req, res) => res.json({ ok: true, loginUrl: LOGIN_URL }));

  // Luôn mở LOGIN ở TAB MỚI
  app.post('/api/big/login', async (_req, res) => {
    try {
      const page = await newPageForSite('big'); // TAB MỚI mỗi lần
      await page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
      res.json({ ok: true, loginUrl: LOGIN_URL });
    } catch (err) {
      console.error('[Site 3] Login open fail:', err);
      res.status(500).json({ ok: false, error: String(err) });
    }
  });

  app.post('/api/big/save-session', async (_req, res) => res.json({ ok: true }));

  // Checkout — LUÔN mở TAB MỚI; tab cũ tiếp tục chạy
  const handleCheckout = async (req, res) => {
    try {
      const payload = normalizePayload(req);
      if (!payload.url) return res.status(400).json({ ok: false, error: 'Missing "url"' });

      const page = await newPageForSite('big'); // <-- điểm khác biệt: luôn tab mới
      console.log('[Site 3] Checkout start:', payload);
      const out = await addToCartAndCheckout(page, payload);
      res.json({ ok: true, message: 'Checkout flow executed', ...out });
    } catch (err) {
      console.error('[Site 3] Checkout failed:', err);
      res.status(500).json({ ok: false, error: String(err) });
    }
  };

  app.post('/api/big/checkout', handleCheckout);
  app.get('/api/big/checkout',  handleCheckout);

  console.log('[Site 3] BigCamera routes mounted (SfrLogin.jsp)');
};
