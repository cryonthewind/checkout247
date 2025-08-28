// ===== Site 2 Scheduler UI (server-side cron) =====
// All comments in English.
// Calls /api/yodo/schedule/start | /stop | /list

(function () {
    const $ = (sel, root=document) => root.querySelector(sel);
    const logBox = document.getElementById('log') || document.getElementById('logs');
    const tz = 'Asia/Tokyo';
  
    function log(msg) {
      if (!logBox) return;
      const t = new Date().toLocaleTimeString('vi-VN', { hour12:false });
      const div = document.createElement('div');
      div.textContent = `[${t}] ${msg}`;
      logBox.appendChild(div);
      logBox.scrollTop = logBox.scrollHeight;
    }
  
    // Parse "HH:MM(:SS)" -> {h,m,s}
    function parseHMS(hms) {
      if (!hms) return null;
      const parts = String(hms).trim().split(':').map(x => parseInt(x, 10));
      if (parts.length < 2) return null;
      const [h, m, s] = [parts[0]||0, parts[1]||0, parts[2]||0];
      if (h<0||h>23||m<0||m>59||s<0||s>59) return null;
      return { h, m, s };
    }
  
    // Build cron expression (daily or 1-shot today/tomorrow)
    function buildCron(atHms, daily=true) {
      const t = parseHMS(atHms);
      if (!t) throw new Error('Invalid time. Use HH:MM or HH:MM:SS');
  
      // Standard 5-field cron: m h * * *  (seconds not supported)
      // If "seconds" is needed, you can switch to a 6-field parser; node-cron supports 5 or 6.
      const minute = t.m;
      const hour = t.h;
  
      // For simplicity we schedule daily by default: "m h * * *"
      // If !daily and time today has passed, it still runs next day (same as daily).
      return `${minute} ${hour} * * *`;
    }
  
    // Parse textarea lines -> items[]
    // Accepts:
    //   "URL"
    //   "URL, 2"
    //   "URL x2"
    function parseItems(text) {
      const items = [];
      const lines = String(text || '').split(/\r?\n/).map(l => l.trim()).filter(Boolean);
      for (const line of lines) {
        let url = line;
        let qty = 1;
  
        // ", qty" form
        const m1 = line.match(/^(.*?),(.*)$/);
        if (m1) {
          url = m1[1].trim();
          qty = parseInt(m1[2].trim(), 10) || 1;
        } else {
          // " xN" form
          const m2 = line.match(/^(.*)\s+x(\d+)$/i);
          if (m2) {
            url = m2[1].trim();
            qty = parseInt(m2[2], 10) || 1;
          }
        }
        if (!/^https?:\/\//i.test(url)) continue;
        items.push({ url, quantity: Math.max(1, qty), autoClick: true });
      }
      return items;
    }
  
    async function startSchedule() {
      try {
        const atTime = $('#yAtTime')?.value;
        const daily  = $('#yDaily')?.checked ?? true;
        const jobId  = $('#yJobId')?.value?.trim() || `yodo-${Date.now()}`;
        const spread = parseInt($('#ySpread')?.value || '5000', 10) || 0;
        const text   = $('#yLinks')?.value || '';
        const items  = parseItems(text);
  
        if (!items.length) return alert('Chưa có link nào.');
        const cron = buildCron(atTime, daily); // e.g., "30 9 * * *" for 09:30
  
        const body = { id: jobId, cron, timezone: tz, spreadMs: spread, items };
        const res = await fetch('/api/yodo/schedule/start', {
          method: 'POST',
          headers: { 'Content-Type':'application/json' },
          body: JSON.stringify(body),
        });
        const j = await res.json();
        if (!j.ok) throw new Error(j.error || 'schedule start failed');
  
        // Persist last schedule to localStorage
        localStorage.setItem('yodoSched', JSON.stringify({
          atTime, daily, jobId, spread, text, savedAt: Date.now()
        }));
  
        log(`🟢 Scheduled ${items.length} item(s) at ${atTime} (cron=${j.cron}, id=${j.id})`);
        alert('Đã tạo lịch thành công.');
      } catch (e) {
        log(`🔴 Schedule error: ${e.message}`);
        alert(`Schedule error: ${e.message}`);
      }
    }
  
    async function stopSchedule() {
      const jobId = $('#yJobId')?.value?.trim();
      if (!jobId) return alert('Hãy nhập job id để dừng.');
      const res = await fetch('/api/yodo/schedule/stop', {
        method: 'POST',
        headers: { 'Content-Type':'application/json' },
        body: JSON.stringify({ id: jobId }),
      });
      const j = await res.json();
      if (!j.ok) {
        log(`🔴 Stop error: ${j.error || 'unknown'}`); 
        alert(`Stop error: ${j.error || 'unknown'}`);
      } else {
        log(`⛔ Stopped job id=${jobId}`);
        alert('Đã dừng lịch.');
      }
    }
  
    async function listSchedules() {
      const res = await fetch('/api/yodo/schedule/list');
      const j = await res.json();
      if (!j.ok) return alert('List error');
      log(`📋 Active jobs: ${Array.isArray(j.ids) ? j.ids.join(', ') : '(none)'}`);
      alert(`Active jobs: ${Array.isArray(j.ids) ? j.ids.join(', ') : '(none)'}`);
    }
  
    // Wire buttons + restore local settings
    document.addEventListener('DOMContentLoaded', () => {
      $('#yBtnStart')?.addEventListener('click', startSchedule);
      $('#yBtnStop')?.addEventListener('click', stopSchedule);
      $('#yBtnList')?.addEventListener('click', listSchedules);
  
      try {
        const saved = JSON.parse(localStorage.getItem('yodoSched') || 'null');
        if (saved) {
          $('#yAtTime')  && ($('#yAtTime').value  = saved.atTime || '');
          $('#yDaily')   && ($('#yDaily').checked = !!saved.daily);
          $('#yJobId')   && ($('#yJobId').value   = saved.jobId || '');
          $('#ySpread')  && ($('#ySpread').value  = String(saved.spread || 5000));
          $('#yLinks')   && ($('#yLinks').value   = saved.text || '');
        }
      } catch {}
    });
  })();
  