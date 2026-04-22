// ZALO BRIDGE - CLEAN START 10.0 (ESM)
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { Zalo, ThreadType } from "zca-js";
import sizeOf from "image-size";

const apis = new Map();
const cancelledTasks = new Set();
let globalStop = false; // Cần được reset mỗi khi chạy task mới

function send(id, data, error = null) {
    process.stdout.write(JSON.stringify({ id, data, error }) + "\n");
}

function isStopped(taskId) {
    return globalStop || (taskId && cancelledTasks.has(String(taskId)));
}

async function smartSleep(ms, taskId) {
    const start = Date.now();
    while (Date.now() - start < ms) {
        if (isStopped(taskId)) return true;
        await new Promise(r => setTimeout(r, 500));
    }
    return false;
}

async function getApi(p) {
    const key = p.imei || "default";
    if (!p.forceLogin && apis.has(key)) return apis.get(key);
    const zalo = new Zalo({ 
        selfListen: false, checkUpdate: false, logging: false,
        imageMetadataGetter: async (imgPath) => {
            const buffer = fs.readFileSync(imgPath);
            const dim = sizeOf(buffer);
            return { width: dim.width, height: dim.height, size: buffer.length };
        }
    });

    let cookie = p.cookie;
    if (typeof cookie === "string") { try { cookie = JSON.parse(cookie); } catch {} }

    const api = await zalo.login({ 
        cookie, imei: p.imei, 
        userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36" 
    });
    apis.set(key, api);
    return api;
}

const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: false });

rl.on("line", async (line) => {
    if (!line.trim()) return;
    try {
        const { id, action, params } = JSON.parse(line);
        if (action === "cancel") { globalStop = true; cancelledTasks.add(String(id)); return; }
        
        // RESET STOP FLAG FOR NEW TASKS
        if (["batch_send_msg", "batch_combo", "batch_friend_req", "invite_to_group", "scan_group"].includes(action)) {
            globalStop = false;
            cancelledTasks.delete(String(id));
        }

        const api = await getApi(params);
        let res;

        if (action === "login") {
            res = { success: true };
        } else if (action === "scan_group") {
            const linkInfo = await api.getGroupLinkInfo({ link: params.link });
            const groupId = String(linkInfo.groupId);
            const fullInfo = await api.getGroupInfo(groupId);
            const groupData = fullInfo.gridInfoMap[groupId];
            const uids = (groupData.memVerList || []).map(v => v.split('_')[0]);
            
            let nameCache = new Map();
            try {
                for (let p = 1; p <= 3; p++) {
                    const page = await api.getGroupLinkInfo({ link: params.link, memberPage: p });
                    if (page.currentMems) {
                        page.currentMems.forEach(m => {
                            nameCache.set(m.id, { name: m.displayName || m.dName, avt: m.avatar || "" });
                        });
                    }
                    if (!page.hasMoreMember) break;
                }
            } catch {}

            const members = uids.map((uid, index) => {
                const profile = nameCache.get(uid) || {};
                return {
                    id: uid,
                    dName: profile.name || "Thành viên " + (index + 1),
                    zaloName: "",
                    avatar: profile.avt || "",
                    role: groupData.adminIds?.includes(uid) ? "Admin" : (groupData.creatorId === uid ? "Owner" : "Member")
                };
            });
            res = { success: true, groupInfo: linkInfo, members };
        } else if (action === "batch_send_msg") {
            const ids = params.userIds || [], msg = params.message || "", delay = params.delayMs || 5000, img = params.imagePath;
            const limit = params.limit && params.limit > 0 ? Math.min(params.limit, ids.length) : ids.length;
            let ok = 0, fail = 0;
            
            for (let i = 0; i < limit; i++) {
                if (isStopped(id)) break;
                const uid = String(ids[i]).trim();
                try {
                    const data = img && fs.existsSync(img) ? { msg: msg || "", attachments: [path.resolve(img)] } : msg;
                    await api.sendMessage(data, uid, ThreadType.User);
                    ok++;
                    send(id, { action: "send_message", uid, ok: true, current: i + 1, total: limit, method: "sendMessage" });
                } catch (e) {
                    fail++;
                    send(id, { action: "send_message", uid, ok: false, error: e.message, current: i + 1, total: limit });
                }
                if (i < limit - 1) await smartSleep(delay, id);
            }
            res = { success: true, successCount: ok, failCount: fail };
        } else if (action === "batch_combo") {
            // COMBO: Kết bạn trước → đợi 2s → Gửi tin nhắn riêng
            const ids = params.userIds || [], delay = params.delayMs || 5000, img = params.imagePath;
            const msg = params.message || "";           // Nội dung tin nhắn marketing
            const friendMsg = params.friendMessage || "Xin chào!";  // Lời chào kết bạn
            const sourceGroupId = params.sourceGroupId;
            const limit = params.limit && params.limit > 0 ? Math.min(params.limit, ids.length) : ids.length;
            const friendLimit = params.friendLimit || 50;
            let ok = 0, fail = 0, friendCount = 0;
            
            for (let i = 0; i < limit; i++) {
                if (isStopped(id)) break;
                const uid = String(ids[i]).trim();
                let method = "";
                try {
                    // Bước 1: Thử gửi tin nhắn trước (nếu đã là bạn)
                    try {
                        const data = img && fs.existsSync(img) ? { msg: msg || "", attachments: [path.resolve(img)] } : msg;
                        await api.sendMessage(data, uid, ThreadType.User);
                        method = "sendMessage";
                    } catch (msgErr) {
                        // Bước 2: Người lạ → Kết bạn trước
                        if (friendCount < friendLimit) {
                            const reqsrc = sourceGroupId ? 6 : 30;
                            const srcParams = sourceGroupId ? { uidTo: uid, groupid: String(sourceGroupId) } : { uidTo: uid };
                            await api.sendFriendRequest(friendMsg, uid, reqsrc, srcParams);
                            friendCount++;
                            
                            // Bước 3: Đợi 2 giây rồi gửi tin nhắn riêng
                            await new Promise(r => setTimeout(r, 2000));
                            
                            try {
                                const data = img && fs.existsSync(img) ? { msg: msg || "", attachments: [path.resolve(img)] } : msg;
                                await api.sendMessage(data, uid, ThreadType.User);
                                method = "friendRequest+sendMessage";
                            } catch (e2) {
                                // Kết bạn OK nhưng gửi tin thất bại (chưa accept) → vẫn tính kết bạn thành công
                                method = "friendRequest";
                            }
                        } else {
                            throw msgErr; // Đã hết quota kết bạn
                        }
                    }
                    ok++;
                    send(id, { action: "send_message", uid, ok: true, current: i + 1, total: limit, method });
                } catch (e) {
                    fail++;
                    send(id, { action: "send_message", uid, ok: false, error: e.message, current: i + 1, total: limit });
                }
                if (i < limit - 1) await smartSleep(delay, id);
            }
            res = { success: true, successCount: ok, failCount: fail };
        } else if (action === "batch_friend_req") {
            const ids = params.userIds || [], msg = params.message || "", delay = params.delayMs || 5000;
            const sourceGroupId = params.sourceGroupId;
            const limit = ids.length;
            let ok = 0, fail = 0;

            for (let i = 0; i < limit; i++) {
                if (isStopped(id)) break;
                const uid = String(ids[i]).trim();
                try {
                    const reqsrc = sourceGroupId ? 6 : 30;
                    const srcParams = sourceGroupId ? { uidTo: uid, groupid: String(sourceGroupId) } : { uidTo: uid };
                    await api.sendFriendRequest(msg || "Xin chào!", uid, reqsrc, srcParams);
                    ok++;
                    send(id, { action: "send_message", uid, ok: true, current: i + 1, total: limit });
                } catch (e) {
                    fail++;
                    send(id, { action: "send_message", uid, ok: false, error: e.message, current: i + 1, total: limit });
                }
                if (i < limit - 1) await smartSleep(delay, id);
            }
            res = { success: true, successCount: ok, failCount: fail };
        } else if (action === "invite_to_group") {
            const ids = params.userIds || [], targetGroupId = params.groupId, delay = params.delayMs || 5000;
            const limit = ids.length;
            let ok = 0, fail = 0;

            for (let i = 0; i < limit; i++) {
                if (isStopped(id)) break;
                const uid = String(ids[i]).trim();
                try {
                    await api.addUserToGroup(uid, targetGroupId);
                    ok++;
                    send(id, { action: "send_message", uid, ok: true, current: i + 1, total: limit });
                } catch (e) {
                    fail++;
                    send(id, { action: "send_message", uid, ok: false, error: e.message, current: i + 1, total: limit });
                }
                if (i < limit - 1) await smartSleep(delay, id);
            }
            res = { success: true, successCount: ok, failCount: fail };
        }
        if (res) send(id, res);
    } catch (e) {
        const parsed = (() => { try { return JSON.parse(line); } catch { return {}; } })();
        send(parsed.id || null, null, e.message);
    }
});

send("ready", { status: "ok" });
