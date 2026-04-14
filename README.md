# 🔍 Zalo Group Member Scanner - GUI

Ứng dụng desktop quét danh sách thành viên nhóm Zalo từ link nhóm.  
Lọc bỏ trưởng nhóm / phó nhóm — xuất CSV (Excel) hoặc JSON.

## ⚡ Cài đặt nhanh

```bash
# Node.js portable đã có sẵn, chỉ cần Python 3.8+
# Không cần cài thêm thư viện Python
```

## 🚀 Chạy

**Double-click `RUN.bat`**

Hoặc:
```bash
python app.py
```

## 📋 Hướng dẫn sử dụng

### Bước 1 — Lấy IMEI + Cookie
1. Cài extension **ZaloDataExtractor** trên Chrome  
   → [Tải tại đây](https://github.com/JustKemForFun/ZaloDataExtractor)
2. Đăng nhập Zalo Web: https://chat.zalo.me
3. Mở extension → Copy **IMEI** và **Cookie**

### Bước 2 — Đăng nhập trong app
1. Dán **IMEI** vào ô IMEI
2. Dán **Cookie** (JSON) vào ô Cookie
3. Bấm **🔑 Đăng nhập**

### Bước 3 — Quét nhóm
1. Dán link nhóm Zalo (ví dụ: `https://zalo.me/g/xxxxxxx`)
2. Bấm **🚀 BẮT ĐẦU QUÉT**
3. Chờ thanh tiến trình hoàn tất

### Bước 4 — Lọc & Xuất
- ✅ Tick **"Loại bỏ Trưởng nhóm & Phó nhóm"** để loại admin
- Bấm **📊 CSV** hoặc **📋 JSON** để xuất file

## 🏗️ Cấu trúc

```
TEST_ZALO/
├── app.py              # GUI chính (Python tkinter)
├── zalo_bridge.mjs     # Backend Node.js (zca-js API)
├── scanner.mjs         # CLI scanner (backup)
├── RUN.bat             # Launcher
├── package.json        # Dependencies
├── nodejs_portable/    # Node.js v20 portable
└── node_modules/       # zca-js library
```

## ⚠️ Lưu ý quan trọng

- Sử dụng **tài khoản phụ** để tránh bị khóa
- Delay tự động 2-5 giây giữa các request
- Không quét quá nhiều nhóm liên tiếp
- API unofficial → có thể bị hỏng khi Zalo cập nhật
