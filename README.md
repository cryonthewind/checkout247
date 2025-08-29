# AliExpress Checkout Runner (Web UI)

Web UI tối giản chạy tại `http://localhost:3000` để mở nhiều link checkout AliExpress,
tự chọn phương thức thanh toán theo 4 số cuối thẻ (nếu cung cấp) và tùy chọn bấm `注文する / Place order`.
Trình duyệt sẽ **giữ mở** để bạn xác nhận thủ công.

## Cài đặt
```bash
npm i
npm run install:browsers
cp .env.example .env
# Chỉnh .env: HEADLESS=false, USE_CHROME=true, STORAGE_STATE=aliexpress-auth.json
```

Đăng nhập 1 lần để tạo `aliexpress-auth.json` bằng script `login-once.js` của bạn.

## Chạy
```bash
npm run restart

## STOP
```
npm run stop-port

# mở http://localhost:3000
```
# ALIEXPRESS
Khi bi anti bot thi xoa het cookie di run lai

## BIG
1. Step 1
# macOS
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome \
  --remote-debugging-port=9222 \
  --user-data-dir="$HOME/.bigcamera-chrome" \
  --lang=ja-JP
2. Step 2
BIG_USE_CDP=1 BIG_CDP_PORT=9222 node server.js