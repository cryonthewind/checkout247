// sites/yodo_core.js
// Yodobashi (order domain): product -> set qty -> add to cart -> open ORDER CART -> NEXT -> confirm
// Cart URL fixed to https://order.yodobashi.com/yc/shoppingcart/index.html?next=true
// Comments in English.

const ORDER_CART_URLS = [
  'https://order.yodobashi.com/yc/shoppingcart/index.html?next=true',
  'https://order.yodobashi.com/yc/shoppingcart/index.html'
];
const LOGIN_URL =
  'https://order.yodobashi.com/yc/login/index.html?returnUrl=https%3A%2F%2Fwww.yodobashi.com%2F';

/* -------------------- small helpers -------------------- */

async function pickVisible(...locs) {
  for (const loc of locs) {
    if (await loc.count()) {
      try { const first = loc.first(); await first.waitFor({ state: 'visible', timeout: 2000 }); return first; } catch {}
    }
  }
  return null;
}

async function clickHard(page, locator) {
  if (!locator) return false;
  try { await locator.scrollIntoViewIfNeeded().catch(()=>{}); await locator.click({ timeout: 2500 }); return true; } catch {}
  try { await locator.click({ timeout: 1500, force: true }); return true; } catch {}
  try { await locator.evaluate(el => el.click()); return true; } catch {}
  try { const b = await locator.boundingBox(); if (b) { await page.mouse.click(b.x + b.width/2, b.y + b.height/2); return true; } } catch {}
  return false;
}

async function waitOnConfirmPage(page, ms = 12000) {
  // Prefer element markers; also accept URL pattern on order domain.
  const ok = await Promise.race([
    page.waitForSelector('button:has-text("注文を確定する")', { timeout: ms }).then(()=>true).catch(()=>false),
    page.waitForSelector('input[value="注文を確定する"]', { timeout: ms }).then(()=>true).catch(()=>false),
    page.waitForSelector('text=ご注文内容を確認', { timeout: ms }).then(()=>true).catch(()=>false),
    page.waitForSelector('text=セキュリティコード', { timeout: ms }).then(()=>true).catch(()=>false),
    page.waitForURL(/order\.yodobashi\.com\/yc\/order\/confirm\/index\.html/i, { timeout: ms }).then(()=>true).catch(()=>false),
  ]);
  return ok;
}

async function isAccessDenied(page) {
  try {
    const html = (await page.content()) || '';
    const url = page.url();
    return /Access Denied/i.test(html) || /edgesuite\.net/i.test(html) || /Akamai/i.test(html) ||
           /\/yc\/login\/error/i.test(url);
  } catch { return false; }
}

async function clearOverlays(page) {
  await page.evaluate(() => {
    document.querySelectorAll('.ui-dialog, .modal, .overlay, .ui-widget-overlay')
      .forEach(el => { el.style.display = 'none'; el.removeAttribute('style'); });
  }).catch(()=>{});
}

/* -------------------- locators -------------------- */

// "Add to cart" on product page (www.yodobashi.com)
async function getAddToCartButton(page) {
  const btn = await pickVisible(
    page.locator('#js_m_submitRelated'),
    page.locator('a#js_m_submitRelated'),
    page.locator('.yBtnPrimary .yBtnText'),
    page.getByText('ショッピングカートに入れる', { exact: true }),
    page.getByRole('button', { name: /ショッピングカートに入れる/ })
  );
  if (!btn) throw new Error('Không thấy nút "ショッピングカートに入れる"');
  return btn;
}

// NEXT on ORDER CART page (order.yodobashi.com)
async function getOrderCartNext(page) {
  // Real DOM often: <a id="sc_i_buy" class="yBtnText"><span>次へ進む</span></a>
  return await pickVisible(
    page.locator('#sc_i_buy'),
    page.locator('a#sc_i_buy'),
    page.locator('.yBtnStack .yBtnText'),
    page.locator('a:has-text("次へ進む")'),
    page.locator('a:has-text("購入手続きに進む")'),
    page.locator('button:has-text("次へ進む")'),
    page.locator('button:has-text("購入手続きに進む")'),
    page.locator('input[type="submit"][value="次へ進む"]'),
    page.locator('input[type="submit"][value="購入手続きに進む"]')
  );
}

// Confirm button on confirm page
async function getConfirmButton(page) {
  return await pickVisible(
    page.getByRole('button', { name: /注文を確定する/ }),
    page.getByText('注文を確定する', { exact: true }),
    page.locator('button:has-text("注文を確定する")'),
    page.locator('input[type="submit"][value="注文を確定する"]'),
    page.locator('input[value="注文を確定する"]'),
    page.locator('a:has-text("注文を確定する")')
  );
}

/* -------------------- quantity -------------------- */

async function setQuantity(page, quantity) {
  const qty = Math.max(1, Number(quantity) || 1);

  const sel = page.locator('#qtySel');
  if (await sel.count()) {
    await sel.scrollIntoViewIfNeeded();
    try { await sel.selectOption({ label: String(qty) }); }
    catch {
      await sel.evaluate((el, q) => {
        el.value = String(q);
        el.dispatchEvent(new Event('change', { bubbles: true }));
        el.dispatchEvent(new Event('input',  { bubbles: true }));
      }, qty);
    }
    await page.waitForTimeout(120);
    return;
  }

  const guesses = [
    'select[name*="qty"]','select[id*="qty"]',
    'select[name*="quantity"]','select[id*="quantity"]',
    'select'
  ];
  for (const s of guesses) {
    const cand = page.locator(s).first();
    if (await cand.count()) {
      try { await cand.selectOption({ label: String(qty) }); }
      catch {
        await cand.evaluate((el, q) => {
          el.value = String(q);
          el.dispatchEvent(new Event('change', { bubbles: true }));
          el.dispatchEvent(new Event('input',  { bubbles: true }));
        }, qty);
      }
      await page.waitForTimeout(120);
      return;
    }
  }

  const numberInput = page.locator('input[type="number"]').first();
  if (await numberInput.count()) {
    await numberInput.fill(String(qty));
    await page.waitForTimeout(120);
  }
}

/* -------------------- open ORDER CART & go to confirm -------------------- */

async function openOrderCart(page) {
  for (const u of ORDER_CART_URLS) {
    try {
      const resp = await page.goto(u, { waitUntil: 'domcontentloaded', timeout: 20000 });
      if (!resp || (resp && resp.status() < 400)) {
        await page.waitForTimeout(200);
        return true;
      }
    } catch {}
  }
  return false;
}

async function pressNextOnOrderCartUntilConfirm(page, maxLoops = 60, stepMs = 300) {
  // Wait for NEXT button or confirm markers
  await Promise.race([
    page.waitForSelector('#sc_i_buy, a#sc_i_buy, .yBtnStack .yBtnText', { timeout: 8000 }).catch(()=>null),
    page.waitForSelector('button:has-text("注文を確定する"), input[value="注文を確定する"]', { timeout: 8000 }).catch(()=>null),
  ]);
  if (await waitOnConfirmPage(page, 800)) return true;

  for (let i = 0; i < maxLoops; i++) {
    await clearOverlays(page);

    const next = await getOrderCartNext(page);
    if (next) await clickHard(page, next);

    // DOM-level events too (anchor handlers sometimes attach late)
    await page.evaluate(() => {
      const el = document.getElementById('sc_i_buy') || document.querySelector('.yBtnStack .yBtnText');
      if (!el) return;
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden' || cs.pointerEvents === 'none') return;
      el.click();
      el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
      // Try submitting the closest form if exists
      const form = el.closest?.('form');
      form?.dispatchEvent?.(new Event('submit', { bubbles: true, cancelable: true }));
      form?.submit?.();
    }).catch(()=>{});

    const ok = await waitOnConfirmPage(page, stepMs);
    if (ok) return true;

    if (await isAccessDenied(page)) return false;
    await page.waitForTimeout(stepMs);
  }
  return false;
}

/* -------------------- security checkbox -------------------- */

async function skipSecurityCodeIfAvailable(page) {
  const byId = page.locator('input#securityCodeInput[type="checkbox"]');
  if (await byId.count()) {
    try { await byId.scrollIntoViewIfNeeded(); if (!(await byId.isChecked())) await byId.check(); await page.waitForTimeout(60); return true; }
    catch { await page.locator('label[for="securityCodeInput"]').click().catch(()=>{}); await page.waitForTimeout(60); return true; }
  }
  const byLabel = page.getByLabel('セキュリティコードを入力しない', { exact: true });
  if (await byLabel.count()) {
    try {
      if (!(await byLabel.isChecked().catch(()=>false))) {
        await byLabel.check().catch(()=>byLabel.click().catch(()=>{}));
      }
      await page.waitForTimeout(60);
      return true;
    } catch {}
  }
  return false;
}

// Try to fill the security code (CVV) input with multiple selectors
async function fillSecurityCodeIfPresent(page, cvv) {
  if (!cvv) return false;
  const candidates = [
    'input[name="creditCard.securityCode"]',
    'input.js_c_securityCode',
    'input[type="password"][name*="security"]',
    'input[type="text"][name*="security"]',
    'input[name*="cvv"]',
    // th "セキュリティコード" -> input in the next cell
    'xpath=//th[contains(normalize-space(.),"セキュリティコード")]/following-sibling::td//input[1]',
  ];
  for (const sel of candidates) {
    const el = page.locator(sel).first();
    if (await el.count()) {
      try {
        const digits = String(cvv).replace(/\D+/g, '').slice(0, 4);
        await el.scrollIntoViewIfNeeded().catch(()=>{});
        await el.fill(digits, { timeout: 2000 });
        await page.waitForTimeout(80);
        return true;
      } catch {}
    }
  }
  return false;
}

// Prefer skip-checkbox; if not available then fill CVV (fallback from env)
async function handleSecurityCode(page, cvvFromCaller) {
  // Try the "do not enter security code" option first
  const skipped = await skipSecurityCodeIfAvailable(page);
  if (skipped) return 'skipped';

  // Fallback CVV from environment if caller did not provide
  const cvv =
    (cvvFromCaller && String(cvvFromCaller).trim()) ||
    process.env.YODO_CVV ||
    process.env.CVV ||
    process.env.CARD_CVV ||
    '';

  const filled = await fillSecurityCodeIfPresent(page, cvv);
  return filled ? 'filled' : 'none';
}

/* -------------------- full flow -------------------- */

async function addToCartAndCheckout(page, { url, quantity = 1, autoClick = true, cvv }) {
  // 1) Product (www.yodobashi.com)
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });

  // 2) Quantity
  await setQuantity(page, quantity);

  // 3) Add to cart
  const addBtn = await getAddToCartButton(page);
  await clickHard(page, addBtn);

  // 4) Move to ORDER CART (order.yodobashi.com)
  await Promise.race([
    page.waitForSelector('text=カートに商品を追加しました', { timeout: 7000 }).catch(()=>null),
    page.waitForLoadState('domcontentloaded').catch(()=>null),
  ]);
  const cartOk = await openOrderCart(page);
  if (!cartOk) throw new Error('Không mở được ORDER CART (order.yodobashi.com)');

  // 5) On ORDER CART: press NEXT until confirm markers appear
  const toConfirm = await pressNextOnOrderCartUntilConfirm(page, 60, 300);
  if (!toConfirm) {
    // Try refresh Akamai token once via login then back to ORDER CART and retry
    await page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(()=>{});
    await openOrderCart(page);
    const retry = await pressNextOnOrderCartUntilConfirm(page, 60, 300);
    if (!retry) throw new Error('Không vào được trang xác nhận từ ORDER CART (nghi Akamai chặn)');
  }

  // 6) Security code handling: prefer skip; otherwise fill CVV (ENV fallback inside)
  await handleSecurityCode(page, cvv);

  // 7) Confirm
  if (autoClick) {
    const confirmBtn = await getConfirmButton(page);
    if (confirmBtn) {
      await clickHard(page, confirmBtn);
      await Promise.race([
        page.waitForSelector('text=ありがとうございました', { timeout: 10000 }).catch(()=>null),
        page.waitForSelector('text=注文番号', { timeout: 10000 }).catch(()=>null),
        page.waitForURL(/order\.yodobashi\.com\/yc\/order\/complete/i, { timeout: 10000 }).catch(()=>null),
        page.waitForLoadState('domcontentloaded').catch(()=>null),
      ]);
    }
  }
}

module.exports = { addToCartAndCheckout };
