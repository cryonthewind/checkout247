# 🧰 Checkout Runner (Web UI)

Web UI tối giản tại **http://localhost:3000** để chạy nhiều link checkout (AliExpress, BigCamera).

**Tính năng chính**
- Mỗi lần bấm **Run** sẽ **mở 1 tab mới** (tab cũ vẫn tiếp tục chạy).
- Có thể **Import JSON** danh sách link + số lượng.
- Tùy chọn **tự bấm nút đặt hàng** (Place order / 注文する) nếu bật trên UI.
- Trình duyệt luôn **giữ mở** để bạn kiểm tra/xác nhận thủ công.
- BigCamera có cơ chế **chống lỗi HTTP/2** (khuyên dùng CDP) và **refresh an toàn**.

---

## 1) Yêu cầu

- Node.js LTS (≥ 18)
- Playwright (dùng kênh `chrome`)
- macOS / Windows / Linux đều được

---

## 2) Cài & chạy
npm i
npm run install:browsers
cp .env.example .env
npm run restart

## 3)  Dừng & giải phóng cổng
npm run stop-port

# BigCamera chế độ CDP (khuyên dùng)
# 1) Mở Chrome với --remote-debugging-port=9222 (xem mục 5A)
# 2) Chạy server:
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome \
  --remote-debugging-port=9222 \
  --user-data-dir="$HOME/.bigcamera-chrome" \
  --lang=ja-JP
BIG_USE_CDP=1 BIG_CDP_PORT=9222 node server.js


### LINK CHEKOUT EDION 

#### CART
https://www.edion.com/order/EPO00100.html
### 注文内容の確認
https://www.edion.com/order/EPO00400.html