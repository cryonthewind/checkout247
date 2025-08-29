// sites/big_core.js
// BigCamera robust checkout:
// - Open product directly; if redirected to category/search, click first item.
// - Quantity via <select name="GOODS_CNT"> with JS fallback (dispatch change/input).
// - Verify quantity on cart and update if needed.
// - Proceed to order with resilient selectors, human-like clicks, and retries.
// - If placeOrder=true (server maps from UI AutoClick), click final 「注文を確定する」.
//
// All comments are in English.

function mkLogger() {
    const lines = [];
    const log = (...args) => {
      const msg = args.map(x => (typeof x === 'object' ? JSON.stringify(x) : String(x))).join(' ');
      console.log('[big_core]', msg);
      lines.push(msg);
    };
    return { log, lines };
  }
  
  async function ensureHeaders(ctx, log) {
    try {
      await ctx.setExtraHTTPHeaders({
        'Accept-Language': 'ja,en-US;q=0.9,en;q=0.8',
        'Referer': 'https://www.biccamera.com/',
        'Upgrade-Insecure-Requests': '1',
      });
      log('set headers');
    } catch (e) { log('set headers skipped:', e?.message || e); }
  }
  
  async function safeGoto(pg, url, log, timeout = 45000) {
    try {
      await pg.goto(url, { waitUntil: 'domcontentloaded', timeout, referer: 'https://www.biccamera.com/' });
      log('goto ok:', url);
      return true;
    } catch (e) {
      log('goto failed:', url, e?.message || e);
      return false;
    }
  }
  
  function extractItemKeyFromUrl(u) {
    try {
      const m = String(u).match(/\/bc\/item\/(\d+)/);
      if (m && m[1]) return m[1];
      const url = new URL(u);
      const parts = url.pathname.split('/').filter(Boolean);
      const last = parts.pop() || '';
      const d = last.match(/\d+/)?.[0];
      return d || url.searchParams.get('q') || '';
    } catch { return ''; }
  }
  
  // ----- human-like click to defeat odd JS bindings
  async function humanClick(pg, locator, timeout = 12000) {
    await locator.scrollIntoViewIfNeeded().catch(()=>{});
    const box = await locator.boundingBox({ timeout }).catch(()=>null);
    if (box) {
      await pg.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 8 }).catch(()=>{});
      await pg.waitForTimeout(120 + Math.floor(Math.random()*120));
      await pg.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    } else {
      await locator.click({ timeout });
    }
  }
  
  // Click and adopt popup/new page if any; otherwise stay on same page
  async function clickAndAdopt(pg, locator, log, navTimeout = 45000) {
    const ctx = pg.context();
    await locator.scrollIntoViewIfNeeded().catch(()=>{});
  
    // Race: popup or same-tab navigation or just DOM change
    const popupPromise = ctx.waitForEvent('page', { timeout: 6000 }).catch(() => null);
    await humanClick(pg, locator, 12000);
    const popup = await popupPromise;
    const target = popup || pg;
  
    try {
      await target.waitForLoadState('domcontentloaded', { timeout: navTimeout });
    } catch {}
    return target;
  }
  
  // ---------- search/category helpers ----------
  async function findFirstItemLink(pg, log) {
    try { await pg.waitForLoadState('domcontentloaded', { timeout: 15000 }); } catch {}
    try { await pg.waitForLoadState('networkidle', { timeout: 8000 }); } catch {}
    for (let i = 0; i < 7; i++) {
      const link = pg.locator('a[href*="/bc/item/"]').first();
      if (await link.count()) return link;
      await pg.evaluate(() => window.scrollBy(0, window.innerHeight * 0.9)).catch(()=>{});
      await pg.waitForTimeout(350);
    }
    log('no /bc/item/ link visible on search/category page');
    return null;
  }
  
  // ---------- open product (no MyPage search) ----------
  async function ensureOnProductPage(pg, url, log) {
    if (/\/bc\/item\/\d+/.test(pg.url())) return pg;
  
    // 1) Direct open
    const ok = await safeGoto(pg, url, log, 45000);
    if (ok && /\/bc\/item\/\d+/.test(pg.url())) return pg;
  
    // 2) If category/search → click first item
    if (/biccamera\.com/.test(pg.url())) {
      const first = await findFirstItemLink(pg, log);
      if (first) return await clickAndAdopt(pg, first, log, 45000);
    }
  
    // 3) Force home then assign
    await safeGoto(pg, 'https://www.biccamera.com/', log, 30000);
    try {
      await pg.evaluate(u => { location.href = u; }, url);
      await pg.waitForLoadState('domcontentloaded', { timeout: 45000 });
      if (/\/bc\/item\/\d+/.test(pg.url())) return pg;
    } catch {}
  
    // 4) Fallback: open category?q=<key> → click first item
    const key = extractItemKeyFromUrl(url) || url;
    await safeGoto(pg, `https://www.biccamera.com/bc/category/?q=${encodeURIComponent(key)}`, log, 45000);
    const first = await findFirstItemLink(pg, log);
    if (first) return await clickAndAdopt(pg, first, log, 45000);
  
    throw new Error('Cannot open product page');
  }
  
  // ---------- quantity helpers ----------
  const PROD_QTY_SELECTORS = [
    'select[name="GOODS_CNT"]', 'input[name="GOODS_CNT"]',
    'select[name*="quantity"]','select[id*="quantity"]','select[name*="qty"]','select[id*="qty"]','select[name*="count"]',
    'input[name*="quantity"]','input[id*="quantity"]','input[name*="qty"]','input[id*="qty"]',
  ];
  
  async function setSelectToNumber(sel, n) {
    try { await sel.selectOption({ value: String(n) }); return true; } catch {}
    const opt = sel.locator(`option[value="${n}"], option:has-text("^${n}$")`).first();
    if (await opt.count()) {
      const v = await opt.evaluate(el => el.value || el.textContent.trim());
      try { await sel.selectOption(v); return true; } catch {}
    }
    // JS fallback
    try {
      await sel.evaluate((el, v) => {
        const opts = Array.from(el.options);
        const hit = opts.find(o => o.value == v) || opts.find(o => (o.textContent || '').trim() == String(v));
        if (hit) el.value = hit.value; else el.value = String(v);
        el.dispatchEvent(new Event('input',  { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      }, String(n));
      return true;
    } catch {}
    return false;
  }
  
  async function setQuantityOnProduct(pg, quantity, log) {
    if (!(Number(quantity) > 1)) return false;
  
    const firstCtl = pg.locator(PROD_QTY_SELECTORS.join(',')).first();
    if (await firstCtl.count()) {
      const tag = await firstCtl.evaluate(el => el.tagName.toLowerCase()).catch(()=> '');
      if (tag === 'select') {
        const ok = await setSelectToNumber(firstCtl, quantity);
        if (ok) { log('set quantity on product (select):', quantity); return true; }
      } else {
        try {
          await firstCtl.fill(String(quantity), { timeout: 3000 });
          await firstCtl.evaluate(el => el.dispatchEvent(new Event('change', { bubbles: true }))).catch(()=>{});
          log('set quantity on product (input):', quantity);
          return true;
        } catch {}
      }
    }
  
    // Try all fallbacks
    for (const css of PROD_QTY_SELECTORS) {
      const loc = pg.locator(css).first();
      if (!(await loc.count())) continue;
      const tag = await loc.evaluate(el => el.tagName.toLowerCase()).catch(()=> '');
      if (tag === 'select') {
        const ok = await setSelectToNumber(loc, quantity);
        if (ok) { log('set quantity on product (select-fallback):', quantity); return true; }
      } else {
        try {
          await loc.fill(String(quantity), { timeout: 3000 });
          await loc.evaluate(el => el.dispatchEvent(new Event('change', { bubbles: true }))).catch(()=>{});
          log('set quantity on product (input-fallback):', quantity);
          return true;
        } catch {}
      }
    }
  
    log('quantity control not found/failed on product; will adjust in cart');
    return false;
  }
  
  async function ensureCartQuantity(pg, quantity, log) {
    if (!(Number(quantity) > 1)) return pg;
  
    let qtySel = pg.locator(
      'select[name="GOODS_CNT"], select[name*="quantity"], select[id*="quantity"], select[name*="qty"], select[id*="qty"], select[name*="count"]'
    ).first();
    if (!(await qtySel.count())) qtySel = pg.locator('select').first();
  
    if (await qtySel.count()) {
      const ok = await setSelectToNumber(qtySel, quantity);
      if (ok) {
        // Update button(s)
        const updateBtn = pg.locator(
          'button:has-text("変更"), input[type="submit"][value*="変更"], button:has-text("更新"), button:has-text("再計算"), a:has-text("数量を更新")'
        ).first();
        if (await updateBtn.count()) {
          pg = await clickAndAdopt(pg, updateBtn, log, 30000);
          log('cart quantity updated via button');
        } else {
          await pg.waitForTimeout(800);
          log('cart quantity set (auto update)');
        }
      } else {
        log('failed to set quantity on cart select');
      }
    } else {
      log('cart quantity selector not found');
    }
    return pg;
  }
  
  // ---------- add-to-cart ----------
  function cartTextRegex() { return /カート|かご|カゴ|ショッピングカート/; }
  
 // Chỉ bắt nút "カートに入れる" của sản phẩm, bỏ nút upsell "一緒にカートに入れる"
async function findAddToCartLocatorInFrame(frame) {
    // helper: true nếu là nút upsell (có chữ "一緒に")
    const isTogetherBtn = async (loc) => {
      const txt = (await loc.innerText().catch(() => '')) || '';
      const val = (await loc.getAttribute('value').catch(() => '')) || '';
      return /一緒に/.test(txt) || /一緒に/.test(val);
    };
  
    // 1) Ưu tiên tên A11y khớp tuyệt đối "カートに入れる"
    for (const name of [/^\s*カートに入れる\s*$/]) {
      let loc = frame.getByRole('button', { name }).first();
      if (await loc.count()) { if (!(await isTogetherBtn(loc))) return loc; }
  
      loc = frame.getByRole('link', { name }).first();
      if (await loc.count()) { if (!(await isTogetherBtn(loc))) return loc; }
    }
  
    // 2) input submit chính xác value
    let loc = frame.locator('input[type="submit"][value="カートに入れる"]').first();
    if (await loc.count()) { if (!(await isTogetherBtn(loc))) return loc; }
  
    // 3) Các id/button chuẩn của trang sản phẩm
    for (const sel of ['#cartin', '#cartIn', '#cartButton', '#js-cartin-btn']) {
      const cand = frame.locator(sel).first();
      if (await cand.count()) { if (!(await isTogetherBtn(cand))) return cand; }
    }
  
    // 4) Tổng quát nhưng lọc bỏ "一緒に"
    const generics = frame.locator(
      'button:has-text("カートに入れる"), a:has-text("カートに入れる"), input[type="submit"][value*="カート"]'
    );
    const n = await generics.count();
    for (let i = 0; i < n; i++) {
      const el = generics.nth(i);
      if (!(await isTogetherBtn(el))) return el;
    }
  
    return null;
  }  
  
  async function findAddToCartLocator(pg) {
    let cand = await findAddToCartLocatorInFrame(pg);
    if (cand) return cand;
    for (const f of pg.frames()) {
      if (f === pg.mainFrame()) continue;
      cand = await findAddToCartLocatorInFrame(f);
      if (cand) return cand;
    }
    return null;
  }
  
  async function tryAddToCart(pg, quantity, log) {
    await setQuantityOnProduct(pg, quantity, log).catch(()=>{});
  
    let addBtn = null;
    for (let i = 0; i < 5; i++) {
      addBtn = await findAddToCartLocator(pg);
      if (addBtn) break;
      await pg.waitForTimeout(500);
    }
    if (!addBtn) {
      const oos = await pg.locator(':text("在庫なし"), :text("販売終了")').first().count();
      if (oos) throw new Error('Item is unavailable (在庫なし/販売終了)');
      throw new Error('Add-to-cart button not found');
    }
    const afterClick = await clickAndAdopt(pg, addBtn, log, 45000);
    return afterClick;
  }
  
  // ---------- cart / order ----------
  async function gotoCartPageFromAny(pg, log) {
    // Prefer the confirmation "カートに進む"
    let toCart = pg.getByRole('button', { name: /カートに進む/ }).first();
    if (!(await toCart.count())) toCart = pg.getByRole('link', { name: /カートに進む/ }).first();
    if (!(await toCart.count())) toCart = pg.locator('a:has-text("カートに進む"), button:has-text("カートに進む")').first();
    if (await toCart.count()) return await clickAndAdopt(pg, toCart, log, 45000);
  
    // Direct cart URLs
    const alt = pg.locator('a:has-text("カートを見る"), a[href*="/bc/cart/"], a[href*="Cart.jsp"]').first();
    if (await alt.count()) return await clickAndAdopt(pg, alt, log, 45000);
  
    // Hard goto fallbacks
    if (!(await safeGoto(pg, 'https://www.biccamera.com/bc/cart/', log, 45000))) {
      await safeGoto(pg, 'https://www.biccamera.com/bc/cart/Cart.jsp', log, 45000);
    }
    return pg;
  }
  
  // Stronger proceed button discovery (cart -> order)
  // Tìm nút "注文画面に進む" trên trang giỏ; loại bỏ "店舗に取り置く"
async function findProceedOnCart(pg) {
    // helper: loại nút "店舗に取り置く"
    const isStorePickup = async (loc) => {
      const txt = (await loc.innerText().catch(() => '')) || '';
      const val = (await loc.getAttribute('value').catch(() => '')) || '';
      return /店舗に取り置く/.test(txt) || /店舗に取り置く/.test(val);
    };
  
    // Ưu tiên khớp đúng "注文画面に進む"
    let btn = pg.getByRole('button', { name: /^\s*注文画面に進む\s*$/ }).first();
    if (await btn.count()) { if (!(await isStorePickup(btn))) return btn; }
    btn = pg.getByRole('link', { name: /^\s*注文画面に進む\s*$/ }).first();
    if (await btn.count()) { if (!(await isStorePickup(btn))) return btn; }
  
    // Fallback: các label thường gặp khác (không phải 店舗に取り置く)
    const candidates = pg.locator([
      'a:has-text("注文画面に進む")',
      'button:has-text("注文画面に進む")',
      'a:has-text("ご購入手続きへ")', 'button:has-text("ご購入手続きへ")',
      'a:has-text("レジへ進む")',     'button:has-text("レジへ進む")',
      'form[action*="/order/"] button[type="submit"]',
      'form[action*="/order/"] input[type="submit"]',
      'a[href*="/order/"], a[href*="/bc/order/"]'
    ].join(',')).filter({ hasNotText: '店舗に取り置く' });
  
    const n = await candidates.count();
    for (let i = 0; i < n; i++) {
      const el = candidates.nth(i);
      if (!(await isStorePickup(el))) return el;
    }
    return null;
  }
  
  
  async function acceptAgreementsIfAny(pg) {
    const labels = pg.locator('label:has-text("同意"), label:has-text("規約"), label:has-text("承諾")');
    const cnt = await labels.count();
    for (let i = 0; i < cnt; i++) {
      const lbl = labels.nth(i);
      const cb = lbl.locator('input[type="checkbox"]').first();
      if (await cb.count()) {
        const on = await cb.isChecked().catch(()=>false);
        if (!on) { try { await lbl.click({ timeout: 800 }); } catch {} }
      }
    }
  }
  
  // Wait for URL to contain order path (best-effort)
  async function waitForOrderUrl(pg) {
    try { await pg.waitForURL(/\/order\/|\/bc\/order\//, { timeout: 45000 }); } catch {}
  }
  
  // Đi qua các bước; nếu placeOrder=true thì bấm 「注文を確定する」
async function advanceOrderSteps(pg, log, { maxSteps = 3, placeOrder = false } = {}) {
    const nextRe  = /次へ|確認へ|入力へ|進む|続ける|お支払い/;
  
    // Tự chấp nhận các dialog (nếu có)
    const onDialog = d => d.accept().catch(()=>{});
    pg.on('dialog', onDialog);
  
    for (let step = 0; step < maxSteps + 1; step++) {
      // Bắt các checkbox đồng ý nếu có
      const labels = pg.locator('label:has-text("同意"), label:has-text("規約"), label:has-text("承諾")');
      const cnt = await labels.count();
      for (let i = 0; i < cnt; i++) {
        const lbl = labels.nth(i);
        const cb = lbl.locator('input[type="checkbox"]').first();
        if (await cb.count()) {
          const on = await cb.isChecked().catch(()=>false);
          if (!on) { try { await lbl.click({ timeout: 800 }); } catch {} }
        }
      }
  
      // Nút cuối: 「注文を確定する」
      let finalBtn =
        pg.getByRole('button', { name: /^\s*注文を確定する\s*$/ }).first();
      if (!(await finalBtn.count()))
        finalBtn = pg.getByRole('link', { name: /^\s*注文を確定する\s*$/ }).first();
      if (!(await finalBtn.count()))
        finalBtn = pg.locator('a:has-text("注文を確定する"), button:has-text("注文を確定する")').first();
  
      if (await finalBtn.count()) {
        if (placeOrder) {
          await finalBtn.scrollIntoViewIfNeeded().catch(()=>{});
          await finalBtn.click({ timeout: 20000 }).catch(async () => {
            // click kiểu "người" nếu cần
            const box = await finalBtn.boundingBox().catch(()=>null);
            if (box) {
              await pg.mouse.move(box.x + box.width/2, box.y + box.height/2, { steps: 8 }).catch(()=>{});
              await pg.mouse.click(box.x + box.width/2, box.y + box.height/2);
            }
          });
          await pg.waitForLoadState('domcontentloaded', { timeout: 25000 }).catch(()=>{});
          log('FINAL: clicked 「注文を確定する」');
        } else {
          log('Đã tới trang cuối. Dừng tại đây (placeOrder=false).');
        }
        pg.off('dialog', onDialog);
        return pg;
      }
  
      // Các nút "tiếp theo"
      let nextBtn = pg.getByRole('button', { name: nextRe }).first();
      if (!(await nextBtn.count())) nextBtn = pg.getByRole('link', { name: nextRe }).first();
      if (!(await nextBtn.count()))
        nextBtn = pg.locator('a:has-text("次へ"), a:has-text("確認へ"), a:has-text("入力へ"), a:has-text("進む"), a:has-text("続ける"), a:has-text("お支払い")').first();
  
      if (await nextBtn.count()) {
        await nextBtn.scrollIntoViewIfNeeded().catch(()=>{});
        await nextBtn.click({ timeout: 12000 }).catch(async () => {
          const box = await nextBtn.boundingBox().catch(()=>null);
          if (box) {
            await pg.mouse.move(box.x + box.width/2, box.y + box.height/2, { steps: 8 }).catch(()=>{});
            await pg.mouse.click(box.x + box.width/2, box.y + box.height/2);
          }
        });
        await pg.waitForLoadState('domcontentloaded', { timeout: 25000 }).catch(()=>{});
        continue;
      }
  
      log('Không tìm thấy nút tiếp theo ở bước này');
      pg.off('dialog', onDialog);
      return pg;
    }
  
    log('Đã đạt maxSteps');
    pg.off('dialog', onDialog);
    return pg;
  }  
  
  async function proceedToCheckout(pg, log, { quantity = 1, maxSteps = 3, placeOrder = false } = {}) {
    // If we are on "added to cart" page, go to cart
    const confirm = await pg.locator('text=/カートに商品を追加しました/').first().count();
    if (confirm) pg = await gotoCartPageFromAny(pg, log);
    if (!/\/bc\/cart\//.test(pg.url())) pg = await gotoCartPageFromAny(pg, log);
  
    // Ensure quantity on cart
    pg = await ensureCartQuantity(pg, quantity, log);
  
    // Find proceed button (robust) with retries
    let proceedBtn = await findProceedOnCart(pg);
    for (let i = 0; i < 2 && !proceedBtn; i++) {
      await pg.waitForTimeout(500);
      proceedBtn = await findProceedOnCart(pg);
    }
    if (!proceedBtn) throw new Error('Proceed button not found on cart');
  
    // Click proceed with retries if URL doesn't change
    for (let attempt = 0; attempt < 3; attempt++) {
      const beforeUrl = pg.url();
      pg = await clickAndAdopt(pg, proceedBtn, log, 45000);
      await waitForOrderUrl(pg);
      const afterUrl = pg.url();
      if (afterUrl !== beforeUrl || /\/order\/|\/bc\/order\//.test(afterUrl)) break;
      await pg.waitForTimeout(600);
    }
  
    // Walk steps (click final if placeOrder=true)
    pg = await advanceOrderSteps(pg, log, { maxSteps, placeOrder });
    return pg;
  }
  
  // ---------- public entry ----------
  async function addToCartAndCheckout(page, { url, quantity = 1, autoClick = true, placeOrder = false, maxSteps = 3 }) {
    const { log, lines } = mkLogger();
  
    // Local generous timeouts (do not rely on global 8s)
    page.setDefaultTimeout(20000);
    page.setDefaultNavigationTimeout(45000);
  
    await ensureHeaders(page.context(), log);
  
    // 1) product page
    const prodPg = await ensureOnProductPage(page, url, log);
    await prodPg.waitForTimeout(500);
  
    // 2) add to cart
    let nextPg = prodPg;
    if (autoClick) {
      nextPg = await tryAddToCart(prodPg, quantity, log);
    } else {
      log('autoClick=false, stop at product page');
      return { status: 'ok', lines };
    }
  
    // 3) cart → order
    try {
      await proceedToCheckout(nextPg, log, { quantity, maxSteps, placeOrder });
    } catch (e) {
      log('proceed failed:', e?.message || e);
      throw e;
    }
  
    return { status: 'ok', lines };
  }
  
  module.exports = { addToCartAndCheckout };
  