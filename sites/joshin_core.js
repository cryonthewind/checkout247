// sites/joshin_core.js
// Purpose: Playwright automation for Joshin — open product page and click "Add to cart" only.
// This file is CommonJS-safe (no import.meta / ESM).
// All comments in English.

const { chromium } = require('playwright');

async function pickVisible(...locs) {
  // Return the first visible locator among candidates
  for (const loc of locs) {
    try {
      if (await loc.count()) {
        const first = loc.first();
        await first.waitFor({ state: 'visible', timeout: 2000 });
        return first;
      }
    } catch {}
  }
  return null;
}

async function clickHard(page, locator) {
  // Try several ways to click stubborn buttons
  if (!locator) return false;
  try { await locator.scrollIntoViewIfNeeded().catch(()=>{}); await locator.click({ timeout: 2500 }); return true; } catch {}
  try { await locator.click({ timeout: 1500, force: true }); return true; } catch {}
  try { await locator.evaluate(el => el.click()); return true; } catch {}
  try {
    const b = await locator.boundingBox();
    if (b) { await page.mouse.click(b.x + b.width/2, b.y + b.height/2); return true; }
  } catch {}
  return false;
}

async function getAddToCartButton(page) {
  // Joshin product pages usually have a large red "カートに入れる" button on the right panel.
  const btn = await pickVisible(
    page.locator('button#js-cartAdd'),
    page.locator('button[data-action*="cart"]'),
    page.locator('button.c-btn.-cart'),
    page.locator('form[action*="cart"] button[type="submit"]'),
    page.getByRole('button', { name: /カートに入れる/ }),
    page.getByText('カートに入れる', { exact: false }),
    page.locator('a:has-text("カートに入れる")'),
    page.locator('button:has-text("カート")')
  );
  if (!btn) throw new Error('Could not find "カートに入れる" (Add to Cart) button on Joshin page');
  return btn;
}

async function addToCartOnly(pageOrNull, { url, autoClick = true }) {
  // Accept either a Page or null; if null, launch an ad-hoc browser
  let browser, page;
  if (pageOrNull && typeof pageOrNull.goto === 'function') {
    page = pageOrNull;
  } else {
    browser = await chromium.launch({ headless: false, args: ['--disable-blink-features=AutomationControlled'] });
    const context = await browser.newContext();
    page = await context.newPage();
  }

  // 1) Go to product page
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 });

  // 2) Click "Add to cart" (no quantity logic; default is 1 on site)
  if (autoClick) {
    const btn = await getAddToCartButton(page);
    await clickHard(page, btn);
  }

  // 3) Best-effort wait for cart confirmation/toast
  await Promise.race([
    page.waitForSelector('text=カートに追加', { timeout: 5000 }).catch(()=>null),
    page.waitForTimeout(1200)
  ]);

  const current = page.url();

  // 4) Close owned browser if we created one
  if (browser) await browser.close().catch(()=>{});

  return { ok: true, url, at: current };
}

module.exports = { addToCartOnly };
