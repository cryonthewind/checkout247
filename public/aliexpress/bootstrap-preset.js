// public/aliexpress/bootstrap-preset.js
// Auto-boot: đọc /storage/popmart.json rồi tự tạo hàng + fill vào table.
// Cột: [0 Thao tác] [1 Tên] [2 URL] [3 Card last 4] [4 Auto click]

(function () {
    const $ = (s, r = document) => r.querySelector(s);
    const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  
    function findAddRowBtn() {
      return $$('button').find(b => /thêm dòng|thêm hàng|add row/i.test(b.textContent || '')) || null;
    }
    function getRows() {
      const tbody = $('table tbody') || $('tbody');
      const rows  = tbody ? $$('tr', tbody) : $$('tr');
      return rows.filter(tr => tr.querySelector('input,select,textarea'));
    }
    function fillRow(tr, v) {
      const tds = tr.children || [];
      const name = tds[1]?.querySelector('input') || tr.querySelector('input[name="productName"]');
      const url  = tds[2]?.querySelector('input') || tr.querySelector('input[name="checkoutUrl"]');
      const l4   = tds[3]?.querySelector('input') || tr.querySelector('input[name="cardLast4"]');
      const ac   = tds[4]?.querySelector('input[type="checkbox"]') || tr.querySelector('input[type="checkbox"]');
  
      if (name) { name.value = v.productName || ''; name.dispatchEvent(new Event('input', { bubbles: true })); }
      if (url)  { url.value  = v.checkoutUrl || ''; url.dispatchEvent(new Event('input', { bubbles: true })); }
      if (l4)   { l4.value   = v.cardLast4 || '';   l4.dispatchEvent(new Event('input', { bubbles: true })); }
      if (ac)   ac.checked = !!v.autoClick;
    }
    function normalize(r) {
      return {
        productName: r.name || r.productName || '',
        checkoutUrl: r.url  || r.checkoutUrl || '',
        cardLast4:   r.last4 || r.cardLast4 || '',
        autoClick:   r.autoClick !== undefined ? !!r.autoClick : true,
      };
    }
  
    async function loadJson(url) {
      try {
        const res = await fetch(url, { cache: 'no-store' });
        if (!res.ok) throw new Error(res.statusText);
        const data = await res.json();
        return Array.isArray(data) ? data : (Array.isArray(data.rows) ? data.rows : []);
      } catch (e) {
        console.warn('[ali preset] không đọc được', url, e.message);
        return [];
      }
    }
  
    async function run() {
      const items = (await loadJson('/storage/popmart.json')).map(normalize);
      if (!items.length) return;
  
      const addBtn = findAddRowBtn();
      while (getRows().length < items.length && addBtn) {
        addBtn.click();
        await new Promise(r => setTimeout(r, 20));
      }
      const rows = getRows();
      items.forEach((v, i) => rows[i] && fillRow(rows[i], v));
  
      const log = $('#log') || $('#logs');
      if (log) {
        const p = document.createElement('div');
        p.textContent = `[${new Date().toLocaleTimeString()}] 🧩 Đã nạp ${items.length} dòng từ /storage/popmart.json`;
        log.appendChild(p);
      }
    }
  
    // Chạy sau khi table render
    document.addEventListener('DOMContentLoaded', () => {
      const iv = setInterval(() => {
        if ($('table')) { clearInterval(iv); run(); }
      }, 80);
    });
  })();
  