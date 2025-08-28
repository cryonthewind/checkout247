// Site 2 auto-fill from /storage/yodo.json (fallback /storage/popmart.json) + Import JSON.
// Non-destructive: does not touch existing handlers.

const $  = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const logBox = $('#log');

function log(msg) {
  const line = `[${new Date().toLocaleTimeString()}] ${msg}`;
  if (logBox) { const p = document.createElement('div'); p.textContent = line; logBox.appendChild(p); }
  console.log('[site2/augment]', msg);
}

function waitFor(fn, { interval = 120, timeout = 10000 } = {}) {
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    const iv = setInterval(() => {
      const v = fn();
      if (v) { clearInterval(iv); resolve(v); }
      else if (Date.now() - t0 > timeout) { clearInterval(iv); reject(new Error('timeout')); }
    }, interval);
  });
}

const tbody = () => $('#tbody');
const rows  = () => $$('#tbody > tr');

function addOneRow() {
  const last = rows().at(-1);
  if (!last) return;
  const clone = last.cloneNode(true);
  // reset fields
  $$('input', clone).forEach(i => {
    if (i.type === 'checkbox' || i.type === 'radio') i.checked = false;
    else i.value = '';
  });
  const qty = clone.children[3]?.querySelector('input[type="number"]');
  if (qty) qty.value = '1';
  const ac = clone.children[4]?.querySelector('input[type="checkbox"]');
  if (ac) ac.checked = true;
  tbody().appendChild(clone);
}

async function ensureRowCount(n) {
  const addBtn = $('#btnAdd');
  while (rows().length < n) { addBtn ? addBtn.click() : addOneRow(); await new Promise(r => setTimeout(r, 40)); }
}

function setVal(el, val) {
  if (!el) return;
  el.value = val ?? '';
  el.dispatchEvent(new Event('input',  { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

function fillRow(tr, v) {
  const t = tr.children;
  const name = t[1]?.querySelector('input');
  const url  = t[2]?.querySelector('input');
  const qty  = t[3]?.querySelector('input');
  const ac   = t[4]?.querySelector('input[type="checkbox"]');

  setVal(name, v.productName);
  setVal(url,  v.checkoutUrl);
  setVal(qty,  String(Math.max(1, parseInt(v.quantity ?? 1, 10))));
  if (ac) ac.checked = !!v.autoClick;
}

function normalize(x) {
  const q = x.quantity ?? x.qty ?? x.q ?? x.cvv ?? x.last4 ?? x.cardLast4 ?? 1;
  return {
    productName: x.name || x.productName || '',
    checkoutUrl: x.url  || x.checkoutUrl || x.productUrl || '',
    quantity:    Math.max(1, parseInt(q, 10) || 1),
    autoClick:   x.autoClick !== undefined ? !!x.autoClick : true,
  };
}

async function fetchJson(url) {
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(String(res.status));
  const j = await res.json();
  return Array.isArray(j) ? j : (Array.isArray(j.rows) ? j.rows : []);
}

async function autoFillFromStorage() {
  try {
    await waitFor(() => tbody() && rows().length > 0);
    let data = [];
    try { data = await fetchJson('/storage/yodo.json'); if (data?.length) log(`Đọc được ${data.length} bản ghi từ /storage/yodo.json`); } catch {}
    if (!data?.length) { try { data = await fetchJson('/storage/popmart.json'); if (data?.length) log(`Đọc được ${data.length} bản ghi từ /storage/popmart.json (fallback)`); } catch {} }
    if (!data?.length) { log('Không tìm thấy dữ liệu trong storage'); return; }
    const items = data.map(normalize);
    await ensureRowCount(items.length);
    const rs = rows();
    items.forEach((v, i) => rs[i] && fillRow(rs[i], v));
    log(`Đã fill ${items.length} hàng từ storage.`);
  } catch (e) {
    log('Auto-fill lỗi: ' + (e.message || e));
  }
}

function isVisible(el) {
  if (!el) return false;
  const cs = getComputedStyle(el);
  if (el.hidden || cs.display === 'none' || cs.visibility === 'hidden') return false;
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0;
}

function site2Root() { return $('#site2') || $('#tab-site2') || $('#yodobashi') || document.body; }

let booted = false;
function tryBoot() {
  if (booted) return;
  const root = site2Root();
  if (!root || !isVisible(root)) return;
  booted = true;
  autoFillFromStorage();
}

document.addEventListener('DOMContentLoaded', () => {
  document.addEventListener('click', (e) => {
    const t = e.target.closest('[role="tab"],button,a,li');
    if (!t) return;
    const txt = (t.textContent || '').toLowerCase();
    if (txt.includes('site 2') || txt.includes('yodo') || txt.includes('yodobashi')) setTimeout(tryBoot, 120);
  }, { passive: true });
  window.addEventListener('hashchange', () => setTimeout(tryBoot, 120));
  const mo = new MutationObserver(() => { if (!booted) tryBoot(); });
  mo.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['class','style','hidden'] });
  setTimeout(tryBoot, 150);
});
