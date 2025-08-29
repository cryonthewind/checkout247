// --- Guards to avoid repeated imports ---
let BIG_AUTOFILL_DONE = false;   // filled successfully -> never run again
let BIG_AUTOFILL_LOADING = false; // currently running -> skip re-entry
let bigMo = null;                 // observer instance

async function autoFillFromStorageOnce() {
  // Prevent re-entry & repeated runs
  if (BIG_AUTOFILL_DONE || BIG_AUTOFILL_LOADING) return;
  BIG_AUTOFILL_LOADING = true;

  try {
    // (giữ nguyên các hàm fetchJson/normalize/ensureRowCount/fillRow ...)
    await waitFor(() => document.querySelector('#tbody') && document.querySelectorAll('#tbody > tr').length > 0);

    let data = [];
    try { data = await fetchJson('/storage/bigcamera.json'); } catch {}
    if (!data?.length) { try { data = await fetchJson('/storage/yodo.json'); } catch {} }
    if (!data?.length) { try { data = await fetchJson('/storage/popmart.json'); } catch {} }

    if (!data?.length) {
      log('Không có dữ liệu trong storage (bỏ qua auto-fill).');
      return; // Không set DONE, để lần tải trang sau vẫn thử lại
    }

    const items = data.map(normalize);
    await ensureRowCount(items.length);
    const rs = Array.from(document.querySelectorAll('#tbody > tr'));
    items.forEach((v, i) => rs[i] && fillRow(rs[i], v));
    log(`Đã fill ${items.length} hàng từ storage (một lần).`);

    BIG_AUTOFILL_DONE = true; // Mark success
    if (bigMo) bigMo.disconnect(); // Stop observing after success
  } catch (e) {
    log('Auto-fill lỗi: ' + (e.message || e));
  } finally {
    BIG_AUTOFILL_LOADING = false;
  }
}

// --- Init: run once when DOM ready, without noisy observer ---
document.addEventListener('DOMContentLoaded', () => {
  // Chỉ quan sát #tbody để biết khi nào bảng sẵn sàng, và tự disconnect khi xong
  const tbody = document.querySelector('#tbody');
  if (tbody) {
    bigMo = new MutationObserver(() => autoFillFromStorageOnce());
    bigMo.observe(tbody, { childList: true, subtree: false });
  }
  // Gọi một lần sau 200ms để bắt trường hợp bảng đã sẵn sàng
  setTimeout(autoFillFromStorageOnce, 200);
});