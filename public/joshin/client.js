// public/joshin/client.js
// UI glue for Joshin: Run one / Run all → open new tab and click "Add to cart" only.
// All comments in English.

(() => {
  const $  = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const logBox = $('#log');

  function log(msg) {
    const line = `[${new Date().toLocaleTimeString()}] ${msg}`;
    if (logBox) { const p = document.createElement('div'); p.textContent = line; logBox.appendChild(p); }
    console.log('[site4]', msg);
  }

  const tbody = $('#tbody');
  const rows = () => $$('#tbody > tr');

  function clearInputs(scope) {
    $$('input', scope).forEach(i => {
      if (i.type === 'checkbox' || i.type === 'radio') i.checked = false;
      else if (i.type === 'number') i.value = '1';
      else i.value = '';
    });
  }

  function addRow(n = 1) {
    const last = rows().at(-1);
    if (!last) return;
    for (let i = 0; i < n; i++) {
      const clone = last.cloneNode(true);
      clearInputs(clone);
      const qty = clone.querySelector('td.quantity input[type="number"]');
      if (qty) qty.value = '1';
      const ac = clone.querySelector('td.checkbox input[type="checkbox"]');
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

  async function runOne(tr) {
    const d = readRow(tr);
    const productUrl = d.checkoutUrl || d.productUrl || d.url || '';
    if (!productUrl) { log('⚠️ Thiếu URL'); return; }
    try {
      log('▶️ Add to cart: ' + (d.productName || productUrl));
      const res = await fetch('/api/joshin/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: productUrl })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) throw new Error(data.error || ('HTTP ' + res.status));
      log('✅ Done');
    } catch (e) {
      log('❌ Lỗi: ' + (e.message || e));
    }
  }

  async function runAll() {
    const list = rows().map(r => ({ r, d: readRow(r) })).filter(x => x.d.autoClick && x.d.checkoutUrl);
    if (!list.length) { log('⚠️ Không có dòng nào để chạy'); return; }
    for (const it of list) await runOne(it.r);
    log('🏁 Hoàn tất Run All');
  }

  function wireRowButtons() {
    $$('.run', tbody).forEach(btn => btn.onclick = (e) => { e.preventDefault(); runOne(btn.closest('tr')); });
    $$('.del', tbody).forEach(btn => btn.onclick = (e) => { e.preventDefault(); delRow(btn.closest('tr')); });
  }

  function wireTopBar() {
    $('#btnAdd')?.addEventListener('click', () => addRow(1));
    $('#btnRunAll')?.addEventListener('click', () => runAll());
    $('#btnClearLog')?.addEventListener('click', () => { if (logBox) logBox.innerHTML = ''; });
    $('#btnLogin')?.addEventListener('click', async () => {
      try {
        log('▶️ Mở login Joshin...');
        await fetch('/api/joshin/login', { method: 'POST' });
        log('🟢 Đã mở login (tab mới). Vui lòng đăng nhập.');
      } catch (e) { log('❌ Không mở được login: ' + (e.message || e)); }
    });
    $('#btnSave')?.addEventListener('click', async () => {
      try {
        await fetch('/api/joshin/save-session', { method: 'POST' });
        log('💾 Session saved.');
      } catch (e) { log('❌ Save session lỗi: ' + (e.message || e)); }
    });
  }

  document.addEventListener('DOMContentLoaded', () => {
    wireTopBar();
    wireRowButtons();
    log('🟣 Joshin client ready.');
  });
})();
