// sites/big_core.js
// BigCamera checkout flow with robust "reload-until-product" behavior.
// - Reload ONLY when we are NOT on a product page (error/search/category).
// - If we ARE on the product page but it's out of stock → stop (no reload) and throw "OutOfStock".
// - Avoid upsell 「一緒にカートに入れる」; use the true 「カートに入れる」.
// - Set quantity on product when possible; re-verify in cart.
// - Proceed through cart/order; optionally click 「注文を確定する」 when placeOrder=true.

const wait = (ms) => new Promise(r => setTimeout(r, ms));
const rand = (min, max) => Math.floor(min + Math.random() * (max - min + 1));

/** ===== Tunable parameters ===== */
const OPEN_MAX_RETRIES = 60;       // attempts to reach a product page
const OPEN_DELAY_MIN   = 900;      // ms between attempts (min)
const OPEN_DELAY_MAX   = 2200;     // ms between attempts (max)
const GOTO_TIMEOUT     = 45000;    // goto timeout per attempt

function mkLogger() {
  const lines = [];
  const log = (...args) => {
    const msg = args.map(x => (typeof x === 'object' ? JSON.stringify(x) : String(x))).join(' ');
    console.log('[big_core]', msg);
    lines.push(msg);
  };
  return { log, lines };
}

/* ---------------- headers ---------------- */
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

/* ---------------- URL helpers ---------------- */
function isItemUrl(u) { return /\/bc\/item\/\d+/.test(String(u)); }
function isCategoryLikeUrl(u) { return /\/bc\/category\/\?q=/.test(String(u)); }

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

/* ---------------- error/out-of-stock detection ---------------- */
function looksLikeErrorText(txt) {
  return /エラー|エラーページ|ただいまアクセスが集中|ご迷惑をおかけ|アクセスが制限|Service Unavailable|Not Found|お探しのページが見つかりません/i
    .test(txt || '');
}
async function isErrorPage(pg) {
  try {
    const body = pg.locator('body').first();
    if (!(await body.count())) return false;
    const txt = (await body.innerText().catch(()=>'')) || '';
    return looksLikeErrorText(txt);
  } catch { return false; }
}

// --- UPDATED: detect "out of stock" on product page (also checks URL keywords) ---
async function isOutOfStockPage(pg) {
  try {
    // 1) URL-level signals
    const url = (pg.url?.() || '').toLowerCase();
    const urlSignals = [
      // generic error / unavailability keywords
      'error', 'err', '404', 'notfound', 'unavailable', 'serviceunavailable',
      // stock related
      'soldout', 'sold-out', 'outofstock', 'out-of-stock', 'stockout', 'no-stock', 'nostock',
      // sales status
      'discontinued', 'saleend', 'endofsale', 'end-of-sale'
    ];
    if (urlSignals.some(k => url.includes(k))) return true;

    // 2) DOM-level signals (Japanese phrases commonly shown for OOS)
    const body = pg.locator('body').first();
    if (!(await body.count())) return false;
    const txt = (await body.innerText().catch(()=>'')) || '';

    const patterns = [
      /在庫なし/, /在庫切れ/, /売り切れ/, /完売/,
      /販売終了/, /販売休止/, /販売期間外/,
      /お取り扱いできません/, /予約受付終了/,
      /次回入荷未定/, /入荷予定未定/
    ];
    if (patterns.some(re => re.test(txt))) return true;

    // 3) Quick locator hint (badge/label)
    const soldBadge = pg.locator('text=/在庫なし|在庫切れ|売り切れ|販売終了|販売休止|次回入荷未定|入荷予定未定/').first();
    if (await soldBadge.count()) return true;

    return false;
  } catch {
    return false;
  }
}

/* ---------------- resilient goto (HTTP/2 soft-retry) ---------------- */
async function safeGoto(pg, url, log, timeout = GOTO_TIMEOUT) {
  const isH2 = (m)=>/ERR_HTTP2_PROTOCOL_ERROR|HTTP\/2/i.test(String(m||''));
  for (let i=1;i<=3;i++){
    try {
      await pg.goto(url, { waitUntil: 'domcontentloaded', timeout, referer: 'https://www.biccamera.com/' });
      log('goto ok:', url);
      return true;
    } catch (e) {
      const m = e?.message || e;
      log(`goto failed [${i}/3]:`, url, m);
      if (isH2(m) && i<3) {
        try { await pg.reload({ waitUntil: 'domcontentloaded', timeout: 20000 }); } catch {}
        await wait(rand(200,500));
        continue;
      }
      return false;
    }
  }
  return false;
}

/* ---------------- human click & popup adoption ---------------- */
async function humanClick(pg, locator, timeout = 12000) {
  await locator.scrollIntoViewIfNeeded().catch(()=>{});
  const box = await locator.boundingBox({ timeout }).catch(()=>null);
  if (box) {
    await pg.mouse.move(box.x + box.width/2, box.y + box.height/2, { steps: 8 }).catch(()=>{});
    await wait(rand(120, 260));
    await pg.mouse.click(box.x + box.width/2, box.y + box.height/2);
  } else {
    await locator.click({ timeout });
  }
}
async function clickAndAdopt(pg, locator, log, navTimeout = 45000) {
  const ctx = pg.context();
  await locator.scrollIntoViewIfNeeded().catch(()=>{});
  const popupPromise = ctx.waitForEvent('page', { timeout: 6000 }).catch(() => null);
  await humanClick(pg, locator, 12000);
  const popup = await popupPromise;
  const target = popup || pg;
  try { await target.waitForLoadState('domcontentloaded', { timeout: navTimeout }); } catch {}
  return target;
}

/* ---------------- find add-to-cart (avoid "一緒に…") ---------------- */
async function isTogetherBtn(loc){
  const txt = (await loc.innerText().catch(()=>'')) || '';
  const val = (await loc.getAttribute('value').catch(()=>'')) || '';
  return /一緒に/.test(txt) || /一緒に/.test(val);
}
function btnNameExact() {
  return /^\s*(カートに入れる|ショッピングカートに入れる|カートへ入れる)\s*$/;
}
async function findAddToCartInFrame(frame) {
  // 1) A11y exact
  let loc = frame.getByRole('button', { name: btnNameExact() }).first();
  if (await loc.count()) { if (!(await isTogetherBtn(loc))) return loc; }
  loc = frame.getByRole('link', { name: btnNameExact() }).first();
  if (await loc.count()) { if (!(await isTogetherBtn(loc))) return loc; }

  // 2) Inputs (exact)
  for (const v of ['カートに入れる','ショッピングカートに入れる','カートへ入れる']) {
    let cand = frame.locator(`input[type="submit"][value="${v}"]`).first();
    if (await cand.count()) { if (!(await isTogetherBtn(cand))) return cand; }
  }

  // 3) Known IDs/classes
  for (const sel of ['#cartin','#cartIn','#cartButton','#js-cartin-btn','.bcs_btnCart','#btnCartIn']) {
    const cand = frame.locator(sel).first();
    if (await cand.count()) { if (!(await isTogetherBtn(cand))) return cand; }
  }

  // 4) Generic contains (still filter upsell)
  const generics = frame.locator([
    'button:has-text("カートに入れる")',
    'a:has-text("カートに入れる")',
    'button:has-text("ショッピングカートに入れる")',
    'a:has-text("ショッピングカートに入れる")',
    'button:has-text("カートへ入れる")',
    'a:has-text("カートへ入れる")',
    'input[type="submit"][value*="カート"]'
  ].join(','));
  const n = await generics.count();
  for (let i=0;i<n;i++){
    const el = generics.nth(i);
    if (!(await isTogetherBtn(el))) return el;
  }
  return null;
}
async function findAddToCart(pg) {
  let loc = await findAddToCartInFrame(pg);
  if (loc) return loc;
  for (const f of pg.frames()) {
    if (f === pg.mainFrame()) continue;
    loc = await findAddToCartInFrame(f);
    if (loc) return loc;
  }
  return null;
}
async function waitAddToCartReady(pg, btn, log, ms=5000) {
  try { await btn.waitFor({ state: 'visible', timeout: ms }); } catch {}
  // wait until not disabled (best-effort)
  for (let t=0; t<ms; t+=300) {
    const disabled = await btn.isDisabled?.().catch(()=>false);
    if (!disabled) return true;
    await wait(300);
  }
  log('add-to-cart still disabled after wait');
  return true;
}

/* ---------------- quantity helpers ---------------- */
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
  try {
    await sel.evaluate((el, v) => {
      const opts = Array.from(el.options);
      const hit = opts.find(o => o.value == v) || opts.find(o => (o.textContent || '').trim() == String(v));
      el.value = hit ? hit.value : String(v);
      el.dispatchEvent(new Event('input',  { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }, String(n));
    return true;
  } catch {}
  return false;
}
async function setQuantityOnProduct(pg, quantity, log) {
  if (!(Number(quantity) > 1)) return false;
  const ctl = pg.locator(PROD_QTY_SELECTORS.join(',')).first();
  if (await ctl.count()) {
    const tag = await ctl.evaluate(el => el.tagName.toLowerCase()).catch(()=> '');
    if (tag === 'select') {
      if (await setSelectToNumber(ctl, quantity)) { log('set quantity on product (select):', quantity); return true; }
    } else {
      try { await ctl.fill(String(quantity), { timeout: 3000 }); await ctl.evaluate(el => el.dispatchEvent(new Event('change', { bubbles: true }))).catch(()=>{}); log('set quantity on product (input):', quantity); return true; } catch {}
    }
  }
  log('quantity not set on product; will adjust in cart');
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
      const updateBtn = pg.locator(
        'button:has-text("変更"), input[type="submit"][value*="変更"], button:has-text("更新"), button:has-text("再計算"), a:has-text("数量を更新")'
      ).first();
      if (await updateBtn.count()) {
        pg = await clickAndAdopt(pg, updateBtn, log, 30000);
        log('cart quantity updated via button');
      } else {
        await wait(700);
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

/* ---------------- search/category helpers ---------------- */
async function findFirstItemLink(pg, log) {
  try { await pg.waitForLoadState('domcontentloaded', { timeout: 15000 }); } catch {}
  try { await pg.waitForLoadState('networkidle', { timeout: 8000 }); } catch {}
  for (let i = 0; i < 7; i++) {
    const link = pg.locator('a[href*="/bc/item/"]').first();
    if (await link.count()) return link;
    await pg.evaluate(() => window.scrollBy(0, window.innerHeight * 0.9)).catch(()=>{});
    await wait(300);
  }
  log('no /bc/item/ link visible on search/category page');
  return null;
}

/* ---------------- reload-until-product (STOP when on product page) ---------------- */
async function openProductWithRefresh(pg, url, log, {
  maxRetries = OPEN_MAX_RETRIES,
  minDelayMs = OPEN_DELAY_MIN,
  maxDelayMs = OPEN_DELAY_MAX,
} = {}) {
  const key = extractItemKeyFromUrl(url) || url;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    log(`product open attempt ${attempt}/${maxRetries}`);

    // 1) Direct goto
    const ok = await safeGoto(pg, url, log, GOTO_TIMEOUT);
    if (!ok) {
      await wait(rand(minDelayMs, maxDelayMs));
      continue;
    }

    // 2) Error page → retry
    if (await isErrorPage(pg)) {
      log('error page detected → retry');
      await wait(rand(minDelayMs, maxDelayMs));
      try { await pg.reload({ waitUntil: 'domcontentloaded', timeout: GOTO_TIMEOUT }); } catch {}
      continue;
    }

    // 3) Category/Search → click first item
    if (!isItemUrl(pg.url()) && isCategoryLikeUrl(pg.url())) {
      const first = await findFirstItemLink(pg, log);
      if (first) {
        pg = await clickAndAdopt(pg, first, log, GOTO_TIMEOUT);
        if (await isErrorPage(pg)) {
          log('clicked first item → error page → retry');
          await wait(rand(minDelayMs, maxDelayMs));
          continue;
        }
      }
    }

    // 4) On product page? STOP refreshing (even if button not visible yet).
    if (isItemUrl(pg.url())) {
      log('landed on product page (stop refreshing).');
      return pg;
    }

    // 5) Fallback: search by key each loop
    await safeGoto(pg, `https://www.biccamera.com/bc/category/?q=${encodeURIComponent(key)}`, log, GOTO_TIMEOUT);
    const first = await findFirstItemLink(pg, log);
    if (first) {
      pg = await clickAndAdopt(pg, first, log, GOTO_TIMEOUT);
      if (isItemUrl(pg.url())) {
        log('product page via search (stop refreshing).');
        return pg;
      }
    }

    // 6) Wait and loop
    await wait(rand(minDelayMs, maxDelayMs));
  }

  throw new Error('Cannot reach product page');
}

/* ---------------- cart / order ---------------- */
async function gotoCartPageFromAny(pg, log) {
  let toCart = pg.getByRole('button', { name: /カートに進む/ }).first();
  if (!(await toCart.count())) toCart = pg.getByRole('link', { name: /カートに進む/ }).first();
  if (!(await toCart.count())) toCart = pg.locator('a:has-text("カートを見る"), a[href*="/bc/cart/"], a[href*="Cart.jsp"]').first();
  if (await toCart.count()) return await clickAndAdopt(pg, toCart, log, GOTO_TIMEOUT);

  await safeGoto(pg, 'https://www.biccamera.com/bc/cart/', log, GOTO_TIMEOUT);
  return pg;
}
async function findProceedOnCart(pg) {
  const isStorePickup = async (loc) => {
    const txt = (await loc.innerText().catch(() => '')) || '';
    const val = (await loc.getAttribute('value').catch(() => '')) || '';
    return /店舗に取り置く/.test(txt) || /店舗に取り置く/.test(val);
  };

  let btn = pg.getByRole('button', { name: /^\s*注文画面に進む\s*$/ }).first();
  if (await btn.count()) { if (!(await isStorePickup(btn))) return btn; }

  btn = pg.getByRole('link', { name: /^\s*注文画面に進む\s*$/ }).first();
  if (await btn.count()) { if (!(await isStorePickup(btn))) return btn; }

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
async function waitForOrderUrl(pg) {
  try { await pg.waitForURL(/\/order\/|\/bc\/order\//, { timeout: 45000 }); } catch {}
}
async function advanceOrderSteps(pg, log, { maxSteps = 3, placeOrder = false } = {}) {
  const nextRe  = /次へ|確認へ|入力へ|進む|続ける|お支払い/;
  const onDialog = d => d.accept().catch(()=>{});
  pg.on('dialog', onDialog);

  for (let step = 0; step < maxSteps + 1; step++) {
    await acceptAgreementsIfAny(pg).catch(()=>{});

    // Final confirm
    let finalBtn = pg.getByRole('button', { name: /^\s*注文を確定する\s*$/ }).first();
    if (!(await finalBtn.count()))
      finalBtn = pg.getByRole('link', { name: /^\s*注文を確定する\s*$/ }).first();
    if (!(await finalBtn.count()))
      finalBtn = pg.locator('a:has-text("注文を確定する"), button:has-text("注文を確定する")').first();

    if (await finalBtn.count()) {
      if (placeOrder) {
        await humanClick(pg, finalBtn, 20000);
        await pg.waitForLoadState('domcontentloaded', { timeout: 25000 }).catch(()=>{});
        log('FINAL: clicked 「注文を確定する」');
      } else {
        log('Reached final confirm. Stop here (placeOrder=false).');
      }
      pg.off('dialog', onDialog);
      return pg;
    }

    // Next/continue
    let nextBtn = pg.getByRole('button', { name: nextRe }).first();
    if (!(await nextBtn.count())) nextBtn = pg.getByRole('link', { name: nextRe }).first();
    if (!(await nextBtn.count()))
      nextBtn = pg.locator('a:has-text("次へ"), a:has-text("確認へ"), a:has-text("入力へ"), a:has-text("進む"), a:has-text("続ける"), a:has-text("お支払い")').first();

    if (await nextBtn.count()) {
      await humanClick(pg, nextBtn, 12000);
      await waitForOrderUrl(pg);
      await pg.waitForLoadState('domcontentloaded', { timeout: 45000 }).catch(()=>{});
      await wait(rand(280, 520));
      continue;
    }

    log('no next button found on this step');
    pg.off('dialog', onDialog);
    return pg;
  }

  log('maxSteps reached');
  pg.off('dialog', onDialog);
  return pg;
}
async function gotoCartThenOrder(pg, quantity, log, { maxSteps, placeOrder }) {
  // If "added to cart" banner present, go to cart
  const confirm = await pg.locator('text=/カートに商品を追加しました/').first().count().catch(()=>0);
  if (confirm) pg = await gotoCartPageFromAny(pg, log);
  if (!/\/bc\/cart\//.test(pg.url())) pg = await gotoCartPageFromAny(pg, log);

  // Ensure quantity in cart
  pg = await ensureCartQuantity(pg, quantity, log);

  const proceedBtn = await findProceedOnCart(pg);
  if (!proceedBtn) throw new Error('Proceed button not found on cart');
  pg = await clickAndAdopt(pg, proceedBtn, log, 45000);

  // Walk steps
  pg = await advanceOrderSteps(pg, log, { maxSteps, placeOrder });
  return pg;
}

/* ---------------- PUBLIC API ---------------- */
async function addToCartAndCheckout(page, { url, quantity = 1, autoClick = true, placeOrder = false, maxSteps = 3 }) {
  const { log, lines } = mkLogger();

  // Local generous timeouts for this page
  page.setDefaultTimeout(20000);
  page.setDefaultNavigationTimeout(45000);

  await ensureHeaders(page.context(), log);

  // 1) ONLY reload when NOT on product page (error/search/category)
  const prodPg = await openProductWithRefresh(page, url, log, {
    maxRetries: OPEN_MAX_RETRIES,
    minDelayMs: OPEN_DELAY_MIN,
    maxDelayMs: OPEN_DELAY_MAX,
  });
  await prodPg.waitForTimeout(350);

  if (!autoClick) {
    log('autoClick=false, stop at product page');
    return { status: 'ok', lines };
  }

  // 2) Set quantity (best-effort)
  await setQuantityOnProduct(prodPg, quantity, log).catch(()=>{});

  // 3) Find and click true add-to-cart (no reload if out-of-stock)
  let addBtn = await findAddToCart(prodPg);
  if (!addBtn) {
    if (await isOutOfStockPage(prodPg)) {
      log('out-of-stock detected on product page → stop (no reload).');
      throw new Error('OutOfStock');
    }
    // Lazy-load rescue
    await prodPg.evaluate(() => window.scrollBy(0, window.innerHeight * 0.6)).catch(()=>{});
    await wait(300);
    addBtn = await findAddToCart(prodPg);
  }
  if (!addBtn) {
    throw new Error('Add-to-cart button not found on product page');
  }

  await waitAddToCartReady(prodPg, addBtn, log, 5000);
  const afterClickPg = await clickAndAdopt(prodPg, addBtn, log, 45000);

  // 4) Cart → Order
  try {
    await gotoCartThenOrder(afterClickPg, quantity, log, { maxSteps, placeOrder });
  } catch (e) {
    log('proceed failed:', e?.message || e);
    throw e;
  }

  return { status: 'ok', lines };
}

module.exports = { addToCartAndCheckout };
