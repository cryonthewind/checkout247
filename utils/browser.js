// utils/browser.js
// Open a URL inside a site's persistent context, with "optimistic then warm & retry" strategy.

const { getContext } = require('../context');

/**
 * Open a URL in a new page of the given site's context.
 * - First try direct navigation
 * - If CSS/JS failed (ORB/CORS/302 to HTML), warm homepage (for AE) then retry once
 *
 * @param {string} url
 * @param {'ali'|'yodo'|'default'} site
 * @param {{ prewarmOnFail?: boolean }} opts
 */
async function openUrl(url, site = 'default', opts = { prewarmOnFail: true }) {
  const ctx = await getContext(site);
  const page = await ctx.newPage();

  await page.setExtraHTTPHeaders({ 'accept-language': 'ja,en;q=0.8' });

  // Track if critical resources failed (stylesheet/script)
  let hadCssOrScriptFail = false;
  page.on('response', (res) => {
    const rt = res.request().resourceType();
    if ((rt === 'stylesheet' || rt === 'script') && !res.ok()) {
      hadCssOrScriptFail = true;
      console.log('[RES-FAIL]', rt, res.status(), res.url());
    }
  });
  page.on('requestfailed', (req) => {
    const rt = req.resourceType();
    if (rt === 'stylesheet' || rt === 'script') {
      hadCssOrScriptFail = true;
      console.log('[REQ-FAIL]', rt, req.failure()?.errorText, req.url());
    }
  });

  // 1) Try direct first
  try {
    await page.goto(url, { waitUntil: 'load', timeout: 30000 });
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
  } catch (e) {
    hadCssOrScriptFail = true;
    console.log('[OPEN] direct goto error:', e.message);
  }

  // 2) If failed and it's AliExpress, warm homepage then retry once
  const isAli = /aliexpress\.com/i.test(url);
  if (opts?.prewarmOnFail && isAli && hadCssOrScriptFail) {
    console.log('[OPEN] warm & retry for AE …');
    try {
      await page.goto('https://ja.aliexpress.com/', { waitUntil: 'load', timeout: 30000 });
      await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    } catch (e) {
      console.log('[OPEN] warm home failed (ignored):', e.message);
    }
    try {
      await page.goto(url, { waitUntil: 'load', timeout: 30000 });
      await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    } catch (e) {
      console.log('[OPEN] retry goto failed:', e.message);
    }
  }

  return page;
}

module.exports = { openUrl };
