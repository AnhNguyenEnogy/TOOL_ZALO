/**
 * ===================================================
 *  ZALO GROUP MEMBER SCANNER
 *  Quét danh sách thành viên nhóm Zalo từ link nhóm
 * ===================================================
 *  Sử dụng: node scanner.mjs
 *  Input: Link nhóm Zalo (https://zalo.me/g/xxxxxxx)
 *  Output: File Excel (.xlsx) + Console
 * ===================================================
 */

import { Zalo } from "zca-js";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";

// ============================================================
// CẤU HÌNH
// ============================================================
const CONFIG = {
    // Delay giữa các trang (ms) - tránh bị Zalo detect bot
    PAGE_DELAY_MIN: 2000,
    PAGE_DELAY_MAX: 5000,
    
    // Delay giữa các request getUserInfo (ms)
    INFO_DELAY_MIN: 1000,
    INFO_DELAY_MAX: 3000,
    
    // Số member ID tối đa mỗi batch khi gọi getGroupMembersInfo
    MEMBER_BATCH_SIZE: 20,
    
    // Thư mục xuất kết quả
    OUTPUT_DIR: "./output",
    
    // File lưu session (để không phải quét QR lại)
    SESSION_FILE: "./session.json",
};

// ============================================================
// UTILITY FUNCTIONS
// ============================================================

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function randomDelay(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

function timestamp() {
    return new Date().toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" });
}

function log(msg, type = "INFO") {
    const colors = {
        INFO: "\x1b[36m",    // Cyan
        OK: "\x1b[32m",      // Green
        WARN: "\x1b[33m",    // Yellow
        ERROR: "\x1b[31m",   // Red
        SCAN: "\x1b[35m",    // Magenta
        DATA: "\x1b[34m",    // Blue
    };
    const reset = "\x1b[0m";
    const color = colors[type] || colors.INFO;
    console.log(`${color}[${type}]${reset} ${timestamp()} | ${msg}`);
}

function askQuestion(question) {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
    });
    return new Promise(resolve => {
        rl.question(question, answer => {
            rl.close();
            resolve(answer.trim());
        });
    });
}

function sanitizeFilename(name) {
    return name.replace(/[<>:"/\\|?*]/g, "_").substring(0, 100);
}

function ensureDir(dirPath) {
    if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
    }
}

// ============================================================
// CSV EXPORT (không cần thêm thư viện)
// ============================================================

function escapeCSV(value) {
    if (value == null) return "";
    const str = String(value);
    if (str.includes(",") || str.includes('"') || str.includes("\n")) {
        return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
}

function exportToCSV(members, groupInfo, outputPath) {
    const BOM = "\uFEFF"; // UTF-8 BOM for Excel compatibility
    const headers = [
        "STT",
        "Zalo ID",
        "Tên hiển thị",
        "Tên Zalo",
        "Avatar",
        "Loại tài khoản",
        "Trạng thái",
    ];
    
    const rows = members.map((m, i) => [
        i + 1,
        m.id || "",
        m.displayName || m.dName || "",
        m.zaloName || "",
        m.avatar || "",
        m.type || "",
        m.accountStatus || "",
    ]);
    
    const csv = BOM + [
        `# Nhóm: ${groupInfo.name}`,
        `# Tổng thành viên: ${groupInfo.totalMember}`,
        `# Quét lúc: ${timestamp()}`,
        `# Link: ${groupInfo.link || "N/A"}`,
        "",
        headers.map(escapeCSV).join(","),
        ...rows.map(row => row.map(escapeCSV).join(",")),
    ].join("\n");
    
    fs.writeFileSync(outputPath, csv, "utf-8");
    return outputPath;
}

// ============================================================
// JSON EXPORT
// ============================================================

function exportToJSON(members, groupInfo, outputPath) {
    const data = {
        group: {
            id: groupInfo.groupId,
            name: groupInfo.name,
            description: groupInfo.desc,
            totalMember: groupInfo.totalMember,
            creatorId: groupInfo.creatorId,
            adminIds: groupInfo.adminIds,
            avatar: groupInfo.avt,
            link: groupInfo.link || null,
        },
        scanTime: new Date().toISOString(),
        memberCount: members.length,
        members: members.map((m, i) => ({
            index: i + 1,
            id: m.id,
            displayName: m.displayName || m.dName || "",
            zaloName: m.zaloName || "",
            avatar: m.avatar || "",
            type: m.type,
            accountStatus: m.accountStatus,
        })),
    };
    
    fs.writeFileSync(outputPath, JSON.stringify(data, null, 2), "utf-8");
    return outputPath;
}

// ============================================================
// MAIN SCANNER
// ============================================================

class ZaloGroupScanner {
    constructor() {
        this.zalo = null;
        this.api = null;
    }
    
    /**
     * Đăng nhập bằng QR Code
     */
    async login() {
        log("Khởi tạo kết nối Zalo...", "INFO");
        this.zalo = new Zalo();
        
        log("Quét mã QR bằng Zalo trên điện thoại để đăng nhập...", "WARN");
        log("(Mở Zalo → Quét QR → Quét mã hiển thị trên terminal)", "WARN");
        
        try {
            this.api = await this.zalo.loginQR();
            log("✅ Đăng nhập thành công!", "OK");
            return true;
        } catch (err) {
            log(`❌ Đăng nhập thất bại: ${err.message}`, "ERROR");
            return false;
        }
    }
    
    /**
     * Quét danh sách thành viên từ link nhóm
     */
    async scanGroupByLink(groupLink) {
        if (!this.api) {
            log("Chưa đăng nhập! Gọi login() trước.", "ERROR");
            return null;
        }
        
        log(`🔍 Bắt đầu quét link: ${groupLink}`, "SCAN");
        
        // --- Bước 1: Lấy thông tin nhóm từ link (trang 1) ---
        let firstPage;
        try {
            firstPage = await this.api.getGroupLinkInfo({
                link: groupLink,
                memberPage: 1,
            });
        } catch (err) {
            log(`❌ Không thể lấy thông tin nhóm: ${err.message}`, "ERROR");
            log("Kiểm tra lại link nhóm hoặc link đã hết hạn.", "WARN");
            return null;
        }
        
        log(`📋 Nhóm: "${firstPage.name}"`, "DATA");
        log(`👥 Tổng thành viên: ${firstPage.totalMember}`, "DATA");
        log(`👑 Admin: ${firstPage.adminIds?.length || 0} người`, "DATA");
        log(`📝 Mô tả: ${firstPage.desc || "(Không có)"}`, "DATA");
        
        // --- Bước 2: Thu thập tất cả thành viên qua phân trang ---
        let allMembers = [...firstPage.currentMems];
        let page = 1;
        
        log(`📄 Trang 1: Lấy được ${firstPage.currentMems.length} thành viên`, "SCAN");
        
        if (firstPage.hasMoreMember) {
            log("📃 Nhóm có nhiều thành viên, tiếp tục quét các trang tiếp...", "SCAN");
            
            while (firstPage.hasMoreMember) {
                page++;
                const delay = randomDelay(CONFIG.PAGE_DELAY_MIN, CONFIG.PAGE_DELAY_MAX);
                log(`⏳ Chờ ${delay}ms trước khi quét trang ${page}...`, "INFO");
                await sleep(delay);
                
                try {
                    const nextPage = await this.api.getGroupLinkInfo({
                        link: groupLink,
                        memberPage: page,
                    });
                    
                    if (nextPage.currentMems && nextPage.currentMems.length > 0) {
                        allMembers.push(...nextPage.currentMems);
                        log(`📄 Trang ${page}: +${nextPage.currentMems.length} thành viên (Tổng: ${allMembers.length}/${firstPage.totalMember})`, "SCAN");
                        firstPage.hasMoreMember = nextPage.hasMoreMember;
                    } else {
                        log(`📄 Trang ${page}: Hết dữ liệu`, "INFO");
                        break;
                    }
                } catch (err) {
                    log(`⚠️ Lỗi trang ${page}: ${err.message}. Tiếp tục...`, "WARN");
                    break;
                }
            }
        }
        
        log(`\n✅ HOÀN TẤT! Đã quét ${allMembers.length}/${firstPage.totalMember} thành viên`, "OK");
        
        // Gắn thêm link vào groupInfo
        firstPage.link = groupLink;
        
        return {
            groupInfo: firstPage,
            members: allMembers,
        };
    }
    
    /**
     * Lấy thêm thông tin chi tiết (display name, avatar HD, ...)
     * cho các member đã quét
     */
    async enrichMemberDetails(members) {
        if (!this.api) return members;
        
        log(`🔎 Đang lấy thêm thông tin chi tiết cho ${members.length} thành viên...`, "SCAN");
        
        const enriched = [...members];
        const memberIds = members.map(m => m.id);
        
        // Chia thành các batch nhỏ
        for (let i = 0; i < memberIds.length; i += CONFIG.MEMBER_BATCH_SIZE) {
            const batch = memberIds.slice(i, i + CONFIG.MEMBER_BATCH_SIZE);
            const batchNum = Math.floor(i / CONFIG.MEMBER_BATCH_SIZE) + 1;
            const totalBatches = Math.ceil(memberIds.length / CONFIG.MEMBER_BATCH_SIZE);
            
            try {
                const details = await this.api.getGroupMembersInfo(batch);
                
                if (details && details.profiles) {
                    for (const [id, profile] of Object.entries(details.profiles)) {
                        const idx = enriched.findIndex(m => m.id === id);
                        if (idx !== -1) {
                            enriched[idx] = { ...enriched[idx], ...profile };
                        }
                    }
                }
                
                log(`📦 Batch ${batchNum}/${totalBatches}: OK`, "DATA");
            } catch (err) {
                log(`⚠️ Batch ${batchNum}/${totalBatches}: ${err.message}`, "WARN");
            }
            
            if (i + CONFIG.MEMBER_BATCH_SIZE < memberIds.length) {
                const delay = randomDelay(CONFIG.INFO_DELAY_MIN, CONFIG.INFO_DELAY_MAX);
                await sleep(delay);
            }
        }
        
        log(`✅ Đã enriched ${enriched.length} thành viên`, "OK");
        return enriched;
    }
}

// ============================================================
// GIAO DIỆN DÒNG LỆNH
// ============================================================

async function main() {
    console.log("\x1b[36m");
    console.log("╔══════════════════════════════════════════════════╗");
    console.log("║    🔍 ZALO GROUP MEMBER SCANNER                 ║");
    console.log("║    Quét danh sách thành viên từ link nhóm       ║");
    console.log("║    Powered by zca-js                            ║");
    console.log("╚══════════════════════════════════════════════════╝");
    console.log("\x1b[0m");
    
    const scanner = new ZaloGroupScanner();
    
    // --- Đăng nhập ---
    const loggedIn = await scanner.login();
    if (!loggedIn) {
        log("Không thể đăng nhập. Thoát.", "ERROR");
        process.exit(1);
    }
    
    // --- Vòng lặp quét ---
    while (true) {
        console.log("");
        const groupLink = await askQuestion(
            "\x1b[33m[?] Nhập link nhóm Zalo (hoặc 'exit' để thoát): \x1b[0m"
        );
        
        if (groupLink.toLowerCase() === "exit" || groupLink.toLowerCase() === "q") {
            log("👋 Tạm biệt!", "INFO");
            break;
        }
        
        if (!groupLink.includes("zalo.me/g/")) {
            log("Link không hợp lệ! Phải có dạng: https://zalo.me/g/xxxxxxx", "ERROR");
            continue;
        }
        
        // Quét thành viên
        const result = await scanner.scanGroupByLink(groupLink);
        if (!result) continue;
        
        const { groupInfo, members } = result;
        
        // Hỏi có muốn lấy thêm chi tiết không
        const wantDetails = await askQuestion(
            "\x1b[33m[?] Lấy thêm thông tin chi tiết? (y/n, mặc định: n): \x1b[0m"
        );
        
        let finalMembers = members;
        if (wantDetails.toLowerCase() === "y") {
            finalMembers = await scanner.enrichMemberDetails(members);
        }
        
        // --- Hiển thị bảng kết quả trên console ---
        console.log("");
        log("═══════════════════ KẾT QUẢ ═══════════════════", "OK");
        console.log("");
        
        // Header
        const header = `${"STT".padEnd(5)} | ${"Zalo ID".padEnd(20)} | ${"Tên hiển thị".padEnd(25)} | ${"Tên Zalo".padEnd(20)}`;
        console.log(`\x1b[1m${header}\x1b[0m`);
        console.log("─".repeat(header.length));
        
        // Rows
        finalMembers.forEach((m, i) => {
            const name = (m.displayName || m.dName || "N/A").substring(0, 24);
            const zName = (m.zaloName || "N/A").substring(0, 19);
            console.log(
                `${String(i + 1).padEnd(5)} | ${(m.id || "").padEnd(20)} | ${name.padEnd(25)} | ${zName.padEnd(20)}`
            );
        });
        
        console.log("─".repeat(header.length));
        console.log(`Tổng: ${finalMembers.length} thành viên\n`);
        
        // --- Xuất file ---
        ensureDir(CONFIG.OUTPUT_DIR);
        const safeName = sanitizeFilename(groupInfo.name);
        const dateStr = new Date().toISOString().slice(0, 10);
        
        // CSV
        const csvPath = path.join(CONFIG.OUTPUT_DIR, `${safeName}_${dateStr}.csv`);
        exportToCSV(finalMembers, groupInfo, csvPath);
        log(`📊 Xuất CSV: ${csvPath}`, "OK");
        
        // JSON
        const jsonPath = path.join(CONFIG.OUTPUT_DIR, `${safeName}_${dateStr}.json`);
        exportToJSON(finalMembers, groupInfo, jsonPath);
        log(`📋 Xuất JSON: ${jsonPath}`, "OK");
        
        console.log("");
    }
    
    process.exit(0);
}

// ============================================================
// RUN
// ============================================================
main().catch(err => {
    log(`Fatal error: ${err.message}`, "ERROR");
    console.error(err);
    process.exit(1);
});
