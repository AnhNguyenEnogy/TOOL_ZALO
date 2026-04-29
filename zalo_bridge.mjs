// ZALO BRIDGE - CLEAN START 11.0 (ESM)
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { Zalo, ThreadType } from "zca-js";
import sizeOf from "image-size";

const apis = new Map();
const cancelledTasks = new Set();
let globalStop = false;

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

    // Custom API: Gửi tin nhắn cho người lạ từ nhóm (zsource=6 + srcId=groupId)
    api.custom("sendMessageStranger", async ({ ctx, utils, props }) => {
        const { msg, toId, srcGroupId } = props;
        const chatServiceUrl = api.zpwServiceMap.chat[0];
        const serviceURL = utils.makeURL(`${chatServiceUrl}/api/message`, { nretry: 0 });
        const params = {
            message: msg,
            clientId: Date.now(),
            imei: ctx.imei,
            ttl: 0,
            toid: toId,
            zsource: 6,
            srcId: srcGroupId,
        };
        const encryptedParams = utils.encodeAES(JSON.stringify(params));
        if (!encryptedParams) throw new Error("Failed to encrypt params");
        const finalUrl = new URL(serviceURL);
        finalUrl.pathname = finalUrl.pathname + "/sms";
        const response = await utils.request(finalUrl.toString(), {
            method: "POST",
            body: new URLSearchParams({ params: encryptedParams }),
        });
        return utils.resolve(response);
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

            // Lấy groupData — có thể undefined nếu chưa là thành viên
            let groupData = null;
            try {
                const fullInfo = await api.getGroupInfo(groupId);
                groupData = fullInfo?.gridInfoMap?.[groupId] || null;
            } catch {}

            // Nếu là thành viên và có memVerList → dùng danh sách UID từ groupData
            // Nếu không → sẽ thu thập UID từ getGroupLinkInfo pages
            let uids = groupData?.memVerList
                ? groupData.memVerList.map(v => v.split('_')[0])
                : [];

            // Lấy tên + avatar qua getGroupLinkInfo (phân trang, ~20 người/trang)
            let nameCache = new Map();
            try {
                const maxPages = uids.length > 0 ? Math.ceil(uids.length / 20) + 2 : 9999;
                for (let p = 1; p <= maxPages; p++) {
                    const page = await api.getGroupLinkInfo({ link: params.link, memberPage: p });
                    if (page.currentMems) {
                        page.currentMems.forEach(m => {
                            const uid = String(m.id || m.uid || "");
                            if (uid) {
                                nameCache.set(uid, { name: m.displayName || m.dName || "", avt: m.avatar || "" });
                                // Nếu chưa phải thành viên, tích lũy UID từ trang
                                if (!groupData?.memVerList && !uids.includes(uid)) uids.push(uid);
                            }
                        });
                    }
                    // Gửi tiến độ mỗi 10 trang
                    if (p % 10 === 0) {
                        send(id, { action: "scan_progress", page: p, cached: nameCache.size, total: uids.length });
                    }
                    if (!page.hasMoreMember) break;
                }
            } catch {}

            // Fallback: getUserInfo cho UID chưa có tên (batch 50 người/lần)
            const unnamed = uids.filter(uid => !nameCache.has(uid));
            if (unnamed.length > 0) {
                try {
                    for (let i = 0; i < unnamed.length; i += 50) {
                        const batch = unnamed.slice(i, i + 50);
                        const userInfo = await api.getUserInfo(batch);
                        if (userInfo) {
                            for (const [uid, info] of Object.entries(userInfo)) {
                                if (info && (info.displayName || info.zaloName || info.dName)) {
                                    nameCache.set(uid, {
                                        name: info.displayName || info.zaloName || info.dName,
                                        avt: info.avatar || ""
                                    });
                                }
                            }
                        }
                    }
                } catch {}
            }

            const members = uids.map((uid, index) => {
                const profile = nameCache.get(uid) || {};
                return {
                    id: uid,
                    dName: profile.name || "Thành viên " + (index + 1),
                    zaloName: "",
                    avatar: profile.avt || "",
                    role: groupData?.adminIds?.includes(uid) ? "Admin" : (groupData?.creatorId === uid ? "Owner" : "Member")
                };
            });
            res = { success: true, groupInfo: linkInfo, members };

        } else if (action === "batch_send_msg") {
            // GỬI TIN NHẮN: thử gửi thường, nếu thất bại thì gửi qua nhóm
            const ids = params.userIds || [], msg = params.message || "", delay = params.delayMs || 5000, img = params.imagePath;
            const sourceGroupId = params.sourceGroupId;
            const limit = params.limit && params.limit > 0 ? Math.min(params.limit, ids.length) : ids.length;
            let ok = 0, fail = 0;
            
            for (let i = 0; i < limit; i++) {
                if (isStopped(id)) break;
                const uid = String(ids[i]).trim();
                try {
                    try {
                        const data = img && fs.existsSync(img) ? { msg: msg || "", attachments: [path.resolve(img)] } : msg;
                        await api.sendMessage(data, uid, ThreadType.User);
                    } catch (e) {
                        if (sourceGroupId) {
                            await api.sendMessageStranger({ msg: msg || "", toId: uid, srcGroupId: String(sourceGroupId) });
                        } else throw e;
                    }
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
            // COMBO: Thử nhắn tin → Nếu người lạ: Kết bạn + Nhắn tin qua nhóm (riêng biệt)
            const ids = params.userIds || [], delay = params.delayMs || 5000, img = params.imagePath;
            const msg = params.message || "";
            const friendMsg = params.friendMessage || "Xin chào!";
            const sourceGroupId = params.sourceGroupId;
            const limit = params.limit && params.limit > 0 ? Math.min(params.limit, ids.length) : ids.length;
            const friendLimit = params.friendLimit || 50;
            let ok = 0, fail = 0, friendCount = 0;
            
            for (let i = 0; i < limit; i++) {
                if (isStopped(id)) break;
                const uid = String(ids[i]).trim();
                let method = "";
                try {
                    // Bước 1: Thử gửi tin nhắn trực tiếp (đã là bạn)
                    try {
                        const data = img && fs.existsSync(img) ? { msg: msg || "", attachments: [path.resolve(img)] } : msg;
                        await api.sendMessage(data, uid, ThreadType.User);
                        method = "sendMessage";
                    } catch (msgErr) {
                        // Bước 2: Người lạ → Kết bạn RIÊNG + Nhắn tin RIÊNG
                        if (friendCount < friendLimit) {
                            // 2a: Gửi lời mời kết bạn (dùng kịch bản Kết bạn)
                            const reqsrc = sourceGroupId ? 6 : 30;
                            const srcParams = sourceGroupId ? { uidTo: uid, groupid: String(sourceGroupId) } : { uidTo: uid };
                            await api.sendFriendRequest(friendMsg, uid, reqsrc, srcParams);
                            friendCount++;
                            
                            // 2b: Đợi 2 giây rồi gửi tin nhắn RIÊNG (dùng kịch bản Nhắn tin)
                            await new Promise(r => setTimeout(r, 2000));
                            
                            try {
                                if (sourceGroupId) {
                                    // Gửi tin nhắn qua nhóm context (zsource + srcId) → đến được người lạ
                                    await api.sendMessageStranger({ msg: msg || "", toId: uid, srcGroupId: String(sourceGroupId) });
                                } else {
                                    const data = img && fs.existsSync(img) ? { msg: msg || "", attachments: [path.resolve(img)] } : msg;
                                    await api.sendMessage(data, uid, ThreadType.User);
                                }
                                method = "friendRequest+sendMessage";
                            } catch (e2) {
                                // Kết bạn OK, tin nhắn chưa gửi được → vẫn OK kết bạn
                                method = "friendRequest";
                            }
                        } else {
                            // Hết quota kết bạn → chỉ thử nhắn tin qua nhóm
                            if (sourceGroupId) {
                                await api.sendMessageStranger({ msg: msg || "", toId: uid, srcGroupId: String(sourceGroupId) });
                                method = "sendMessageStranger";
                            } else throw msgErr;
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
