// public/bootstrap-preset.js
// One-file strict preset loader (no cross-fallback, no global fallback).
// - Each site loads ONLY its own JSON.
// - Root must be found via explicit selectors.
// - Scope is locked to the root; once filled, the root is tagged with data-preset-owner.
// - If a site's root is not in DOM yet, we wait via MutationObserver and try again.

(function () {
    // ----- debug helpers -----
    const DEBUG = (window.PRESET_DEBUG === true);
    const dlog = (...a) => DEBUG && console.log('[preset]', ...a);
    const warn = (...a) => console.warn('[preset]', ...a);
  
    const $  = (s, r = document) => r.querySelector(s);
    const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  
    // ----- STRICT site config (EDIT selectors to match your DOM) -----
    const SITES = [
      {
        key: 'ali',
        json: '/storage/popmart.json',
        selectors: ['#aliexpress', '#ali', '[data-site="ali"]', '#site1'],
        normalize: (x) => ({
          productName: x.name || x.productName || '',
          checkoutUrl: x.url  || x.checkoutUrl || '',
          // Ali col3 = card last4
          col3:        (x.last4 || x.cardLast4 || '').toString(),
          autoClick:   x.autoClick !== undefined ? !!x.autoClick : true
        })
      },
      {
        key: 'yodo',
        json: '/storage/yodo.json',
        selectors: ['#yodobashi', '#yodo', '[data-site="yodo"]', '#site2'],
        normalize: (x) => ({
          productName: x.name || x.productName || '',
          checkoutUrl: x.url  || x.checkoutUrl || x.productUrl || '',
          // Yodo col3 = quantity
          col3:        String(Math.max(1, parseInt(x.quantity ?? x.qty ?? 1, 10) || 1)),
          autoClick:   x.autoClick !== undefined ? !!x.autoClick : true
        })
      },
      {
        key: 'big',
        json: '/storage/bigcamera.json',
        selectors: ['#bigcamera', '#big', '[data-site="big"]', '#site3'],
        normalize: (x) => ({
          productName: x.name || x.productName || '',
          checkoutUrl: x.url  || x.checkoutUrl || x.productUrl || '',
          // Big col3 = quantity
          col3:        String(Math.max(1, parseInt(x.quantity ?? x.qty ?? 1, 10) || 1)),
          autoClick:   x.autoClick !== undefined ? !!x.autoClick : true
        })
      }
    ];
  
    // ----- scoped table helpers -----
    function findRoot(site) {
      for (const sel of site.selectors) {
        const el = $(sel);
        if (!el) continue;
        // Do not reuse a root already owned by another site
        const owner = el.getAttribute('data-preset-owner');
        if (owner && owner !== site.key) { dlog(site.key, 'skip root owned by', owner, sel); continue; }
        return el;
      }
      return null;
    }
  
    function findTbody(root) { return root.querySelector('tbody'); }
    function getRows(root) {
      const tb = findTbody(root);
      return tb ? $$('tr', tb) : [];
    }
    function setVal(el, val) {
      if (!el) return;
      el.value = val ?? '';
      el.dispatchEvent(new Event('input',  { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }
    function clickAddInside(root) {
      const cand = ['#btnAdd','button#btnAdd','button:has-text("Thêm dòng")','button:has-text("Add")','button:has-text("Thêm")'];
      for (const sel of cand) {
        const b = root.querySelector(sel);
        if (b) { b.click(); return true; }
      }
      return false;
    }
    function cloneRowInto(root) {
      const tb = findTbody(root);
      if (!tb) return null;
      const base = tb.querySelector('tr');
      if (!base) return null;
      const tr = base.cloneNode(true);
      $$('input,textarea,select', tr).forEach(i => {
        if (i.type === 'checkbox' || i.type === 'radio') i.checked = false;
        else i.value = '';
      });
      const num = tr.querySelector('input[type="number"]'); if (num) num.value = '1';
      const chk = tr.querySelector('input[type="checkbox"]'); if (chk) chk.checked = true;
      tb.appendChild(tr);
      return tr;
    }
    async function ensureRowCount(root, n) {
      while (getRows(root).length < n) {
        if (!clickAddInside(root)) cloneRowInto(root);
        await sleep(10);
      }
    }
    function fillGenericRow(tr, v) {
      const t   = tr.children || [];
      const name = t[1]?.querySelector('input') || tr.querySelector('input[name="productName"]');
      const url  = t[2]?.querySelector('input') || tr.querySelector('input[name="checkoutUrl"]');
      const col3 = t[3]?.querySelector('input,select');
      const ac   = t[4]?.querySelector('input[type="checkbox"]') || tr.querySelector('input[type="checkbox"]');
  
      setVal(name, v.productName);
      setVal(url,  v.checkoutUrl);
      if (col3) setVal(col3, v.col3);
      if (ac) ac.checked = !!v.autoClick;
    }
  
    async function fetchJsonStrict(url) {
      const res = await fetch(url, { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
      const data = await res.json();
      return Array.isArray(data) ? data : (Array.isArray(data.rows) ? data.rows : []);
    }
  
    // ----- fill-once per site with root ownership -----
    const done = new Set();
    const rootCache = new Map();
  
    async function fillSite(site) {
      if (done.has(site.key)) return;
  
      let root = rootCache.get(site.key);
      if (!root || !document.contains(root)) {
        root = findRoot(site);
        if (!root) { dlog(site.key, 'root not found (wait)'); return; }
        rootCache.set(site.key, root);
      }
  
      // Only fill into a root that is either free or owned by itself
      const owner = root.getAttribute('data-preset-owner');
      if (owner && owner !== site.key) { dlog(site.key, 'root owned by other site:', owner); return; }
  
      // Prefer to wait until tbody exists in this root
      let tb = findTbody(root);
      const t0 = Date.now();
      while (!tb && Date.now() - t0 < 2500) { await sleep(60); tb = findTbody(root); }
      if (!tb) { dlog(site.key, 'tbody not ready'); return; }
  
      // Load EXACT JSON for this site
      let list = [];
      try {
        const raw = await fetchJsonStrict(site.json);
        list = raw.map(site.normalize).filter(x => (x.checkoutUrl || x.productName));
        if (!list.length) throw new Error('empty');
        dlog(`${site.key} <- ${site.json} (${list.length} rows)`);
      } catch (e) {
        warn(`skip ${site.key}: cannot load ${site.json}:`, e.message || e);
        done.add(site.key);
        return;
      }
  
      // Tag the root owner BEFORE fill to prevent other sites grabbing it
      root.setAttribute('data-preset-owner', site.key);
  
      await ensureRowCount(root, list.length);
      const trs = getRows(root);
      list.forEach((v, i) => trs[i] && fillGenericRow(trs[i], v));
  
      done.add(site.key);
  
      const lg = document.getElementById('log');
      if (lg) {
        const p = document.createElement('div');
        p.textContent = `[${new Date().toLocaleTimeString()}] ${site.key.toUpperCase()} filled ${list.length} rows from ${site.json}`;
        lg.appendChild(p);
      }
    }
  
    function boot() {
      // First attempts
      SITES.forEach(site => {
        setTimeout(() => fillSite(site), 120);
        setTimeout(() => fillSite(site), 500);
        setTimeout(() => fillSite(site), 1000);
      });
  
      // Watch DOM additions; if a site's root appears, fill it once
      const mo = new MutationObserver(() => {
        SITES.forEach(site => fillSite(site));
      });
      mo.observe(document.body, { childList: true, subtree: true });
    }
  
    document.addEventListener('DOMContentLoaded', boot);
  })();
  