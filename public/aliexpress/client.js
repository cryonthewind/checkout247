// Site 1 (AliExpress) client – based on your original client.js
(() => {
    const $ = (sel, root=document) => root.querySelector(sel);
    const $$ = (sel, root=document) => Array.from(root.querySelectorAll(sel));
    const logBox = $('#log');
  
    const now = () => new Date().toLocaleTimeString('ja-JP', {hour12:false});
    const log = (msg, color) => {
      const line = document.createElement('div');
      line.textContent = `[${now()}] ${msg}`;
      if (color) line.style.color = color;
      logBox.appendChild(line);
      logBox.scrollTop = logBox.scrollHeight;
    };
    const setStatus = (msg) => { logBox.textContent = `[${now()}] ${msg}`; };
  
    // --- NEW: Clear log button if present
    const clearBtn = $('#btnClearLog');
    if (clearBtn) clearBtn.onclick = () => {
      logBox.textContent = `[${now()}] 🧹 Log cleared.`;
    };
  
    // ---- Buttons ----
    $('#btnLogin').onclick = async () => {
      try {
        const r = await fetch('/api/login');
        const j = await r.json();
        log(j.ok ? '🟢 Mở cửa sổ login (persistent). Hãy đăng nhập 1 lần.' : `🔴 ${j.error || 'Login open failed'}`);
      } catch (e) { log(`🔴 ${e.message}`); }
    };
  
    // “Save session”: open homepage to make sure cookies persist (with persistent context this is mostly a hint)
    $('#btnSave').onclick = async () => {
      try {
        const r = await fetch('/api/open?' + new URLSearchParams({ url: 'https://ja.aliexpress.com/' }));
        const j = await r.json();
        log(j.ok ? '💾 Session đã được giữ trong persistent profile.' : `🔴 ${j.error || 'Save session failed'}`);
      } catch (e) { log(`🔴 ${e.message}`); }
    };
  
    $('#btnAdd').onclick = () => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td class="actions">
          <div class="row-actions">
            <button class="run primary">Run</button>
            <button class="del">Xóa</button>
          </div>
        </td>
        <td class="name"><input placeholder="Tên sản phẩm" /></td>
        <td class="url"><input placeholder="https://www.aliexpress.com/p/trade/confirm.html?..." /></td>
        <td class="last4"><input placeholder="(optional)" /></td>
        <td class="checkbox"><input type="checkbox" checked /></td>
      `;
      $('#tbody').appendChild(tr);
    };
  
    // Import JSON: expected format = [{name, url, last4, autoClick}, ...]
    const fileEl = document.getElementById('file');
    const fileNameEl = document.getElementById('fileName');
  
    const importBtn = document.getElementById('btnImport');
    if (importBtn) importBtn.onclick = () => fileEl.click();
  
    fileEl.onchange = async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      fileNameEl.textContent = file.name;
      try {
        const text = await file.text();
        const arr = JSON.parse(text);
        if (!Array.isArray(arr)) throw new Error('JSON không phải mảng');
        $('#tbody').innerHTML = '';
        arr.forEach(row => {
          const tr = document.createElement('tr');
          tr.innerHTML = `
            <td class="actions">
              <div class="row-actions">
                <button class="run primary">Run</button>
                <button class="del">Xóa</button>
              </div>
            </td>
            <td class="name"><input value="${escapeHtml(row.name||'')}" placeholder="Tên sản phẩm" /></td>
            <td class="url"><input value="${escapeHtml(row.url||'')}" placeholder="https://...confirm.html?..." /></td>
            <td class="last4"><input value="${escapeHtml(row.last4||'')}" placeholder="(optional)" /></td>
            <td class="checkbox"><input type="checkbox" ${row.autoClick!==false?'checked':''} /></td>
          `;
          $('#tbody').appendChild(tr);
        });
        log(`📥 Đã import ${arr.length} dòng từ JSON.`);
      } catch (err) {
        log(`🔴 Import lỗi: ${err.message}`);
      }
    };
  
    // Run All
    $('#btnRunAll').onclick = async () => {
      const rows = $$('#tbody tr');
      if (!rows.length) return log('⚠ Chưa có dòng nào.');
      $('#btnRunAll').disabled = true;
  
      for (let i=0; i<rows.length; i++) {
        const r = rows[i];
        log(`▶️ [${i+1}/${rows.length}] Bắt đầu…`);
        // await ensures sequential to reduce bot flags
        await runOne(r, i+1);
      }
      $('#btnRunAll').disabled = false;
      log('✅ Hoàn tất Run All.');
    };
  
    // Delegate Run / Delete per row
    $('#tbody').addEventListener('click', (e) => {
      const btn = e.target.closest('button');
      if (!btn) return;
      const tr = e.target.closest('tr');
      if (btn.classList.contains('run')) runOne(tr);
      if (btn.classList.contains('del')) tr.remove();
    });

    // ---- Core runner ----
    async function runOne(tr, idx) {
      const [nameEl, urlEl, last4El, autoEl] = [
        $('.name input', tr),
        $('.url input', tr),
        $('.last4 input', tr),
        $('.checkbox input', tr)
      ];
      const name = (nameEl.value || 'Unnamed').trim();
      const url = (urlEl.value || '').trim();
      const last4 = (last4El.value || '').trim();
      const autoClick = !!autoEl.checked; // reserved for future use
  
      if (!url) { log(`🔴 ${name}: thiếu Checkout URL`); return; }
  
      // Measure end-to-end from client side
      const t0 = performance.now();
      try {
        const resp = await fetch('/api/fast-checkout', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ confirmUrl: url, last4: last4 || undefined, autoClick })
        });
        const data = await resp.json();
        const ms = Math.round(performance.now() - t0);
  
        if (data.ok) {
          log(`🟢 ${name}: success in ~${ms}ms (server ${data.ms}ms). → ${data.url}`, 'limegreen');
        } else {
          log(`🟠 ${name}: không thành công (~${ms}ms). Lý do: ${data.reason||data.error||'unknown'}`, 'orange');
        }
      } catch (err) {
        log(`🔴 ${name}: lỗi chạy – ${err.message}`);
      }
    }
  
    // Helpers
    function escapeHtml(s) {
      return String(s).replace(/[&<>"']/g, (m) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
    }
  
    // Initial status
    (async () => {
      try {
        const r = await fetch('/api/status'); const j = await r.json();
        setStatus(j.ok ? '🟢 Connected. Import JSON / Add rows. Use "Open Chrome for login" + "Save session", then Run.'
                       : `🔴 Không kết nối: ${j.error||''}`);
      } catch { setStatus('🔴 Không kết nối server.'); }
    })();
  })();
  