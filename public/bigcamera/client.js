// client.js — BigCamera (Site 3) UI without scheduler
// Comments are in English per user preference.

(() => {
  const $  = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const logBox = (() => {
    const el = document.getElementById('log');
    return el || (() => {
      const div = document.createElement('div');
      div.id = 'log';
      document.body.appendChild(div);
      return div;
    })();
  })();
  function log(msg) {
    const line = `[${new Date().toLocaleTimeString()}] ${msg}`;
    const p = document.createElement('div');
    p.textContent = line;
    logBox.appendChild(p);
    const nodes = logBox.children;
    if (nodes.length > 500) logBox.removeChild(nodes[0]);
    console.log('[bigcamera]', msg);
  }

  const tbody = $('#tbody');
  function rows() { return $$('#tbody > tr'); }

  function clearInputs(scope) {
    $$('input', scope).forEach(i => {
      if (i.type === 'checkbox' || i.type === 'radio') i.checked = false;
      else i.value = '';
    });
  }

  function addRow(n = 1) {
    const last = rows().at(-1);
    if (!last) return;
    for (let i = 0; i < n; i++) {
      const clone = last.cloneNode(true);
      clearInputs(clone);
      const qty = clone.querySelector('td input[type="number"]');
      if (qty) qty.value = '1';
      const ac = clone.querySelector('td input[type="checkbox"]');
      if (ac) ac.checked = true;
      tbody.appendChild(clone);
    }
    wireRowButtons();
  }

  function delRow(tr) {
    if (rows().length <= 1) { clearInputs(tr); return; }
    tr.remove();
  }

  function readRow(tr) {
    const t = tr.children;
    return {
      productName: t[1]?.querySelector('input')?.value?.trim() ?? '',
      checkoutUrl: t[2]?.querySelector('input')?.value?.trim() ?? '',
      quantity:    Math.max(1, parseInt(t[3]?.querySelector('input')?.value || '1', 10)),
      autoClick:   t[4]?.querySelector('input[type="checkbox"]')?.checked ?? true,
    };
  }

  function fillRow(tr, v) {
    const t = tr.children;
    const name = t[1]?.querySelector('input');
    const url  = t[2]?.querySelector('input');
    const qty  = t[3]?.querySelector('input');
    const ac   = t[4]?.querySelector('input[type="checkbox"]');
    if (name) { name.value = v.productName ?? ''; name.dispatchEvent(new Event('input', { bubbles: true })); }
    if (url)  { url.value  = v.checkoutUrl ?? ''; url.dispatchEvent(new Event('input', { bubbles: true })); }
    if (qty)  { qty.value  = String(Math.max(1, parseInt(v.quantity ?? 1, 10))); qty.dispatchEvent(new Event('input', { bubbles: true })); }
    if (ac)   ac.checked = !!v.autoClick;
  }

  async function ensureRowCount(n) {
    const need = n - rows().length;
    if (need > 0) addRow(need);
  }

  async function runOne(tr) {
    const d = readRow(tr);
    const productUrl = d.checkoutUrl || d.productUrl || d.url || '';
    try {
      if (!productUrl) throw new Error('Thiếu URL sản phẩm/checkout');
      log('▶️ [Site 3] Run 1 dòng...');
      const res = await fetch('/api/big/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          productUrl,
          quantity: Math.max(1, Number(d.quantity) || 1),
          autoClick: !!d.autoClick,
          productName: d.productName || ''
        })
      });
      if (!res.ok) throw new Error(await res.text());
      const out = await res.json().catch(() => ({}));
      log(`🟢 [Site 3] Done: ${out.message || 'checkout executed'}`);
    } catch (e) {
      log('❌ [Site 3] Thất bại: ' + (e.message || e));
    }
  }

  async function runAll() {
    for (const tr of rows()) {
      await runOne(tr);
    }
  }

  function normalize(x) {
    const q = x.quantity ?? x.qty ?? x.q ?? 1;
    return {
      productName: x.name || x.productName || '',
      checkoutUrl: x.url  || x.checkoutUrl || x.productUrl || '',
      quantity:    Math.max(1, parseInt(q, 10) || 1),
      autoClick:   x.autoClick !== undefined ? !!x.autoClick : true,
    };
  }

  async function fillFromArray(arr, label) {
    if (!arr || !arr.length) { log('File JSON trống.'); return; }
    const list = arr.map(normalize);
    await ensureRowCount(list.length);
    const rs = rows();
    list.forEach((v, i) => rs[i] && fillRow(rs[i], v));
    log(`📥 Đã fill ${list.length} dòng từ ${label}.`);
  }

  function wireImport() {
    const btnImport = $('#btnImport');
    const file = $('#file');
    const fileName = $('#fileName');
    if (!btnImport || !file) return;

    btnImport.addEventListener('click', () => file.click());
    file.addEventListener('change', async (ev) => {
      const f = ev.target.files?.[0];
      if (!f) return;
      try {
        if (fileName) fileName.textContent = f.name;
        const txt = await f.text();
        const j = JSON.parse(txt);
        const arr = Array.isArray(j) ? j : (Array.isArray(j.rows) ? j.rows : []);
        await fillFromArray(arr, f.name);
      } catch (e) {
        log('Import JSON lỗi: ' + (e.message || e));
      } finally {
        file.value = '';
      }
    });
  }

  function wireRowButtons() {
    $$('.run', tbody).forEach(btn => {
      btn.onclick = (e) => { e.preventDefault(); runOne(btn.closest('tr')); };
    });
    $$('.del', tbody).forEach(btn => {
      btn.onclick = (e) => { e.preventDefault(); delRow(btn.closest('tr')); };
    });
  }

  function wireTopBar() {
    const btnAdd = $('#btnAdd');
    const btnRunAll = $('#btnRunAll');
    const btnClear = $('#btnClearLog');
    const btnLogin = $('#btnLogin');
    const btnSave  = $('#btnSave');

    if (btnAdd)   btnAdd.onclick = () => addRow(1);
    if (btnRunAll) btnRunAll.onclick = () => runAll();
    if (btnClear) btnClear.onclick = () => { logBox.innerHTML = ''; };
    if (btnLogin) btnLogin.onclick = async () => {
      try {
        log('▶️ Mở trang login BigCamera...');
        await fetch('/api/big/login', { method: 'POST' });
        log('🟢 Đã mở trang login BigCamera. Vui lòng đăng nhập trong cửa sổ Chrome.');
      } catch (e) { log('❌ Không mở được login: ' + (e.message || e)); }
    };
    if (btnSave) btnSave.onclick = async () => {
      try {
        log('💾 Lưu session...');
        await fetch('/api/big/save-session', { method: 'POST' });
        log('🟢 Session BigCamera đã được lưu.');
      } catch (e) { log('❌ Lưu session lỗi: ' + (e.message || e)); }
    };
  }

  document.addEventListener('DOMContentLoaded', () => {
    wireTopBar();
    wireRowButtons();
    wireImport();
    log('🟣 Site 3 client ready (real mode).');
  });
})();
