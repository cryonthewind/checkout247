// login-once.js
// Optional tool to export storageState after manual login (not required if using userDataDir).

const fs = require('fs');
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({
    headless: false,
    channel: 'chrome',
    args: ['--disable-blink-features=AutomationControlled']
  });
  const context = await browser.newContext({
    viewport: { width: 1420, height: 900 },
    locale: 'ja-JP',
    timezoneId: 'Asia/Tokyo'
  });
  const page = await context.newPage();

  // 1) Go to login page and let user login manually
  await page.goto('https://login.aliexpress.com/', { waitUntil: 'domcontentloaded' });
  console.log('Please login manually, then press Enter here...');
  process.stdin.setEncoding('utf8');
  process.stdin.once('data', async () => {
    // 2) Export storage state
    const state = await context.storageState();
    fs.writeFileSync('./storageState.json', JSON.stringify(state, null, 2));
    console.log('Saved storageState.json');
    await browser.close();
    process.exit(0);
  });
})();
