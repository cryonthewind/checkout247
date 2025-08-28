// sites/ali_core.js
// AliExpress fast checkout core — optimistic then warm&retry; avoid 500 by returning reason.

const fs = require('fs');
const { openUrl } = require('../utils/browser'); // dùng openUrl với prewarmOnFail
const { getContext } = require('../context'); // chỉ để newPage khi cần thêm tab

// ---------- helpers ----------
function nowStamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

async function closeOverlays(page) {
  try { await page.keyboard.press('Escape'); } catch {}
  const closeSelectors = [
    '[aria-label="Close"]','[data-role="close"]',
    'button:has-text("閉じる")','button:has-text("Close")','button:has-text("닫기")',
    '[class*="close"]','[class*="modal"] [class*="close"]',
  ];
  for (const sel of closeSelectors) {
    try {
      const el = page.locator(sel).first();
      if (await el.isVisible().catch(() => false)) {
        await el.click().catch(() => {});
        await page.waitForTimeout(120);
      }
    } catch {}
  }
}

async function selectSavedCard(page, last4) {
  if (!last4 || !String(last4).trim()) return true;
  const tail = String(last4).trim();

  try {
    await Promise.race([
      page.getByText(/支払い方法|Payment/i).first().waitFor({ timeout: 1500 }).catch(()=>{}),
      page.locator('[data-pl="payment-method-title"]').first().waitFor({ timeout: 1500 }).catch(()=>{}),
    ]);
  } catch {}

  const titles = page.locator('[data-pl="payment-method-title"]', { hasText: new RegExp(`${tail}$`) });
  const n = await titles.count();
  if (!n) return false;

  for (let i = 0; i < n; i++) {
    const title = titles.nth(i);
    const row = title.locator('xpath=ancestor::div[contains(@class,"radio-item--item-row")]').first();
    if (!(await row.isVisible().catch(()=>false))) continue;

    const radio = row.locator('input.comet-radio-input[type="radio"]').first();
    const label = row.locator('label.comet-radio').first();
    await row.scrollIntoViewIfNeeded().catch(()=>{});

    if (await radio.count()) {
      await radio.click({ timeout: 1500, force: true }).catch(()=>{});
      await page.waitForTimeout(120);
      if (await radio.isChecked().catch(()=>false)) return true;
    }
    if (await label.count()) {
      await label.click({ timeout: 1500, force: true }).catch(()=>{});
      await page.waitForTimeout(120);
      if (await radio.isChecked().catch(()=>false)) return true;
    }
    const box = await row.boundingBox();
    if (box) {
      await page.mouse.click(box.x + box.width/2, box.y + box.height/2).catch(()=>{});
      await page.waitForTimeout(120);
      if (await radio.isChecked().catch(()=>false)) return true;
    }
  }
  return false;
}

async function pickFirstPayment(page) {
  try {
    const rows = page.locator('.radio-item--item-row');
    const n = await rows.count();
    for (let i = 0; i < n; i++) {
      const row = rows.nth(i);
      if (!(await row.isVisible().catch(()=>false))) continue;
      const radio = row.locator('input.comet-radio-input[type="radio"]').first();
      await row.scrollIntoViewIfNeeded().catch(()=>{});
      if (await radio.count()) {
        await radio.click({ timeout: 1500, force: true }).catch(()=>{});
        await page.waitForTimeout(120);
        if (await radio.isChecked().catch(()=>false)) return true;
      }
      const box = await row.boundingBox();
      if (box) {
        await page.mouse.click(box.x + box.width/2, box.y + box.height/2).catch(()=>{});
        await page.waitForTimeout(120);
        if (await radio.isChecked().catch(()=>false)) return true;
      }
    }
  } catch {}
  return false;
}

const AE_ORDER_BUTTON_SELECTORS = [
  'button.pl-order-toal-container__btn:has-text("注文する")',
  '.pl-order-toal-container__btn-box button.pl-order-toal-container__btn',
  'button:has-text("注文する")','button:has-text("ご注文を確定")',
  'button.comet-btn.comet-btn-primary','button:has-text("Place order")',
  'button:has-text("결제하기")','button:has-text("立即下单")',
];

async function findPlaceOrder(page) {
  for (const sel of AE_ORDER_BUTTON_SELECTORS) {
    const el = page.locator(sel).first();
    if (await el.count()) return { frame: page, el };
  }
  for (const f of page.frames()) {
    for (const sel of AE_ORDER_BUTTON_SELECTORS) {
      const el = f.locator(sel).first();
      if (await el.count()) return { frame: f, el };
    }
  }
  const byRole = page.getByRole('button', {
    name: /注文する|ご注文を確定|Place order|결제하기|立即下单/i,
  });
  if (await byRole.count()) return { frame: page, el: byRole.first() };
  return null;
}

// ---------- main ----------
async function fastCheckout(confirmUrl, last4FromCaller) {
  const t0 = Date.now();
  try {
    // Use optimistic open with fallback warm&retry
    const page = await openUrl(confirmUrl, 'ali', { prewarmOnFail: true });

    // Soft hints
    await Promise.race([
      page.getByText(/合計|小計|Total|총액/).first().waitFor({ timeout: 2000 }).catch(() => {}),
      page.getByText(/支払|お支払い|Payment|결제/).first().waitFor({ timeout: 2000 }).catch(() => {}),
    ]);

    await closeOverlays(page);

    const last4 = (last4FromCaller && String(last4FromCaller).trim()) || process.env.CARD_LAST4 || '';
    let ok = false;
    if (last4) {
      ok = await selectSavedCard(page, last4);
      if (!ok) ok = await pickFirstPayment(page);
    } else {
      ok = await pickFirstPayment(page);
    }

    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight)).catch(() => {});
    await page.waitForTimeout(120);

    let target = await findPlaceOrder(page);
    if (!target) {
      await closeOverlays(page);
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight)).catch(() => {});
      await page.waitForTimeout(120);
      target = await findPlaceOrder(page);
    }

    if (!target) {
      const snapHtml = `./last-confirm-${nowStamp()}.html`;
      const snapPng = `./last-confirm-${Date.now()}.png`;
      fs.writeFileSync(snapHtml, await page.content());
      await page.screenshot({ path: snapPng, fullPage: true }).catch(() => {});
      return { ok: false, ms: Date.now() - t0, url: page.url(), reason: 'Không tìm thấy nút 注文する (đã lưu HTML+PNG).' };
    }

    if (await target.el.isDisabled().catch(() => false)) {
      await page.waitForTimeout(300);
    }

    const navOrSuccess = Promise.race([
      page.waitForURL(/(cashier|payment|success|order|確認|success\.html)/i, { timeout: 8000 }).then(() => true).catch(() => false),
      page.getByText(/注文が完了|支払いが完了|注文確認|Order placed|Payment successful|결제가 완료/i)
          .first().waitFor({ state: 'visible', timeout: 8000 }).then(() => true).catch(() => false),
    ]);

    await Promise.allSettled([navOrSuccess, target.el.click().catch(() => {})]);

    const success =
      /success|order|確認/i.test(page.url()) ||
      await page.getByText(/注文が完了|支払いが完了|注文確認|Order placed|Payment successful|결제가 완료/i)
        .first().isVisible().catch(() => false);

    return { ok: !!success, ms: Date.now() - t0, url: page.url(), reason: success ? undefined : 'Không xác định trạng thái sau click.' };
  } catch (err) {
    return { ok: false, ms: Date.now() - t0, reason: `exception: ${err.message}` };
  }
}

module.exports = {
  closeOverlays,
  selectSavedCard,
  pickFirstPayment,
  findPlaceOrder,
  fastCheckout,
};
