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
npm run dev
# mở http://localhost:3000
```
# ALIEXPRESS
Khi bi anti bot thi xoa het cookie di run lai
