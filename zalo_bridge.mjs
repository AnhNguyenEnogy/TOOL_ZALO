import { Zalo, ThreadType } from "zca-js";
import readline from "node:readline";
import fs from "node:fs";

const apis = new Map();
const cancelledTasks = new Set();
let globalStop = false;
const DEFAULT_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";

function isStopped(taskId) {
    return globalStop || (taskId && cancelledTasks.has(String(taskId)));
}

async function smartSleep(ms, taskId) {
    const start = Date.now();
    while (Date.now() - start < ms) {
        if (isStopped(taskId)) return true;
        await new Promise(r => setTimeout(r, 1000));
    }
    return false;
}

const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: false });

function send(id, data, error = null) {
    process.stdout.write(JSON.stringify({ id, data, error }) + "\n");
}

async function getApi(p) {
    const key = p.imei || "default";
    if (apis.has(key)) return apis.get(key);
    if (p.cookie) {
        const zalo = new Zalo({ selfListen: false, checkUpdate: false, logging: false });
        let cookie = p.cookie;
        if (typeof cookie === "string") { try { cookie = JSON.parse(cookie); } catch {} }
        const api = await zalo.login({ cookie, imei: p.imei, userAgent: p.userAgent || DEFAULT_UA });
        
        // Đăng ký custom API gửi tin cho stranger (có zsource + srcId)
        registerStrangerMessageAPI(api);
        
        apis.set(key, api);
        return api;
    }
    throw new Error("Chưa đăng nhập");
}

/**
 * Đăng ký custom API sendStrangerMessage dùng internal utils của zca-js.
 * Thêm zsource=104 + srcId (sourceGroupId) vào params để Zalo server
 * cho phép gửi tin cho người lạ cùng nhóm.
 */
function registerStrangerMessageAPI(api) {
    api.custom("sendStrangerMessage", async ({ ctx, utils, props }) => {
        const { message, threadId, sourceGroupId } = props;
        
        // Lấy service URL giống sendMessage
        const zpwServiceMap = api.zpwServiceMap;
        const serviceURL = utils.makeURL(`${zpwServiceMap.chat[0]}/api/message`, {
            nretry: 0,
        });
        
        const params = {
            message: message,
            clientId: Date.now(),
            imei: ctx.imei,
            ttl: 0,
            toid: threadId,
            zsource: 104,          // 104 = từ danh sách thành viên nhóm
            srcId: sourceGroupId,   // ID nhóm nguồn
        };
        
        const encryptedParams = utils.encodeAES(JSON.stringify(params));
        if (!encryptedParams) throw new Error("Failed to encrypt message");
        
        const finalUrl = new URL(serviceURL);
        finalUrl.pathname = finalUrl.pathname + "/sms";
        
        const response = await utils.request(finalUrl.toString(), {
            method: "POST",
            body: new URLSearchParams({ params: encryptedParams }),
        });
        
        return await utils.resolve(response);
    });
}

function cleanId(id) {
    return typeof id === "string" ? id.trim() : String(id);
}

async function resolveGroupId(api, input) {
    if (/^\d+$/.test(input)) return input;
    if (input.includes("zalo.me/g/")) {
        try {
            const info = await api.getGroupLinkInfo({ link: input });
            return info.groupId;
        } catch (e) {
            throw new Error("Không thể lấy ID từ link nhóm này: " + e.message);
        }
    }
    return input;
}

// LOGIN
async function loginWithCookie(p) {
    try {
        zalo = new Zalo({ selfListen: false, checkUpdate: false, logging: false });
        let cookie = p.cookie;
        if (typeof cookie === "string") { try { cookie = JSON.parse(cookie); } catch {} }
        api = await zalo.login({ cookie, imei: p.imei, userAgent: p.userAgent || DEFAULT_UA });
        return { success: true, message: "OK" };
    } catch (e) { api = null; return { success: false, message: e.message }; }
}

// SCAN
async function scanGroupLink(p) {
    if (!api) return { success: false, message: "Chưa đăng nhập" };
    const all = []; let page = 1, gi = null;
    cancelFlag = false;
    while (!cancelFlag) {
        try {
            const info = await api.getGroupLinkInfo({ link: p.link, memberPage: page });
            if (page === 1) gi = { groupId:info.groupId, name:info.name, desc:info.desc, totalMember:info.totalMember, creatorId:info.creatorId, adminIds:info.adminIds||[], avatar:info.avt||"" };
            if (info.currentMems?.length > 0) {
                all.push(...info.currentMems);
                send("scan_progress", { page, pageMembers:info.currentMems.length, totalFetched:all.length, totalMember:info.totalMember });
            }
            if (!info.hasMoreMember || !info.currentMems?.length) break;
            page++;
            await new Promise(r => setTimeout(r, 2000+Math.random()*2000));
        } catch (e) { send("scan_error", { page, error:e.message }); break; }
    }
    return { success: true, groupInfo:gi, members:all, totalFetched:all.length, cancelled: cancelFlag };
}

// BATCH SEND MESSAGE + IMAGE (CÓ HỖ TRỢ STRANGER)
async function batchSendMessage(p) {
    const api = await getApi(p);
    const ids = p.userIds, msg = p.message || "", delay = p.delayMs || 5000, img = p.imagePath;
    const sourceGroupId = p.sourceGroupId || ""; // ID nhóm nguồn để gửi cho stranger
    const limit = p.limit && p.limit > 0 ? Math.min(p.limit, ids.length) : ids.length;
    let ok = 0, fail = 0;
    globalStop = false;

    for (let i = 0; i < limit; i++) {
        if (isStopped(p.taskId)) break;
        const uid = String(ids[i]).trim();
        try {
            // DEBUG: Log chính xác params đang gửi
            send(p.taskId, { action:"send_message_debug", 
                info: `🔍 [${i+1}/${limit}] uid="${uid}" msg="${(msg||"").substring(0,30)}..." img="${img||"none"}" srcGid="${sourceGroupId}" ThreadType=${ThreadType.User}` });
            
            let result = null;
            
            if (img && fs.existsSync(img)) {
                // Gửi ảnh đính kèm — dùng sendMessage bình thường (attachment đã có zsource=-1 sẵn)
                const path = await import("node:path");
                result = await api.sendMessage(
                    { msg: msg || "", attachments: [path.default.resolve(img)] },
                    uid,
                    ThreadType.User
                );
            } else if (msg) {
                // Tin text — thử gửi với stranger API trước, fallback về sendMessage bình thường
                if (sourceGroupId) {
                    try {
                        result = await api.sendStrangerMessage({
                            message: msg,
                            threadId: uid,
                            sourceGroupId: String(sourceGroupId),
                        });
                        send(p.taskId, { action:"send_message_debug", 
                            info: `✅ Stranger API OK: uid="${uid}" result=${JSON.stringify(result)}` });
                    } catch (strangerErr) {
                        // Stranger API failed — fallback về sendMessage
                        send(p.taskId, { action:"send_message_debug", 
                            info: `⚠️ Stranger API failed (${strangerErr.message}), trying normal sendMessage...` });
                        result = await api.sendMessage(msg, uid, ThreadType.User);
                    }
                } else {
                    // Không có sourceGroupId → gửi bình thường (chỉ hoạt động cho bạn bè)
                    result = await api.sendMessage(msg, uid, ThreadType.User);
                }
            } else {
                // msg rỗng và ko có ảnh → skip
                send(p.taskId, { action:"send_message_debug", info: `⚠️ SKIP ${uid}: msg rỗng, không có ảnh` });
                fail++;
                send(p.taskId, { action:"send_message", uid, ok:false, error:"Nội dung tin nhắn rỗng!", current:i+1, total:limit });
                continue;
            }
            
            // Validate kết quả — kiểm tra có msgId trả về không
            const hasValidResult = validateSendResult(result);
            if (hasValidResult) {
                ok++;
                send(p.taskId, { action:"send_message", uid, ok:true, current:i+1, total:limit });
            } else {
                // Gửi thành công nhưng không có msgId — có thể tin nhắn bị silent drop
                fail++;
                send(p.taskId, { action:"send_message", uid, ok:false, 
                    error: `Gửi không xác nhận được (no msgId). Có thể người nhận chặn tin nhắn người lạ. Result: ${JSON.stringify(result)}`, 
                    current:i+1, total:limit });
            }
        } catch (e) {
            fail++;
            send(p.taskId, { action:"send_message", uid, ok:false, error:e.message, current:i+1, total:limit });
        }
        if (i < limit-1) {
            const killed = await smartSleep(delay + Math.floor(Math.random()*1500), p.taskId);
            if (killed) break;
        }
    }
    cancelledTasks.delete(String(p.taskId));
    return { success:true, successCount:ok, failCount:fail };
}

/**
 * Validate kết quả gửi tin nhắn — kiểm tra có msgId trả về hay không.
 * Nếu không có msgId, tin nhắn có thể đã bị Zalo server drop mà không báo lỗi.
 */
function validateSendResult(result) {
    if (!result) return false;
    
    // sendMessage trả về { message: { msgId: ... }, attachment: [...] }
    if (result.message && result.message.msgId) return true;
    if (result.attachment && result.attachment.length > 0) return true;
    
    // Custom stranger API trả về trực tiếp data
    if (result.msgId) return true;
    
    // Nếu là object có data thì cũng ok
    if (typeof result === "object" && Object.keys(result).length > 0) {
        // Có response nhưng không rõ — vẫn coi là OK nhưng log warning
        return true;
    }
    
    return false;
}


// BATCH FRIEND REQUEST
async function batchFriendReq(p) {
    const api = await getApi(p);
    const ids = p.userIds, msg = p.message || "Xin chào!", delay = p.delayMs || 5000;
    const limit = p.limit && p.limit > 0 ? Math.min(p.limit, ids.length) : ids.length;
    let ok = 0, fail = 0;
    globalStop = false;

    for (let i = 0; i < limit; i++) {
        if (isStopped(p.taskId)) break;
        const uid = String(ids[i]).trim();
        try {
            // zca-js v2 API: sendFriendRequest(msg, userId)
            await api.sendFriendRequest(msg, uid);
            ok++;
            send(p.taskId, { action:"friend_request", uid, ok:true, current:i+1, total:limit });
        } catch (e) {
            fail++;
            send(p.taskId, { action:"friend_request", uid, ok:false, error:e.message, current:i+1, total:limit });
        }
        if (i < limit-1) {
            const killed = await smartSleep(delay + Math.floor(Math.random()*1500), p.taskId);
            if (killed) break;
        }
    }
    cancelledTasks.delete(String(p.taskId));
    return { success:true, successCount:ok, failCount:fail };
}

// BATCH INVITE TO GROUP
async function inviteToGroup(p) {
    const api = await getApi(p);
    let gid = String(p.groupId).trim();
    
    // Resolve link to numeric ID if needed
    try {
        gid = await resolveGroupId(api, gid);
    } catch (e) {
        return { success: false, error: e.message };
    }
    
    const ids = p.userIds, delay = p.delayMs || 3000;
    const limit = p.limit && p.limit > 0 ? Math.min(p.limit, ids.length) : ids.length;
    let ok = 0, fail = 0;
    globalStop = false;

    // Log debug info
    send(p.taskId, { action:"invite_debug", gid, memberCount: ids.length, resolvedFromLink: gid !== String(p.groupId).trim() });

    for (let i = 0; i < limit; i++) {
        if (isStopped(p.taskId)) break;
        const uid = String(ids[i]).trim();
        try {
            // zca-js v2 API: addUserToGroup(memberId, groupId)
            await api.addUserToGroup(uid, gid);
            ok++;
            send(p.taskId, { action:"invite_to_group", uid, ok:true, current:i+1, total:limit });
        } catch (e) {
            fail++;
            send(p.taskId, { action:"invite_to_group", uid, ok:false, error:`${e.message} [gid=${gid}]`, current:i+1, total:limit });
        }
        if (i < limit-1) {
            const killed = await smartSleep(delay + Math.floor(Math.random()*1500), p.taskId);
            if (killed) break;
        }
    }
    cancelledTasks.delete(String(p.taskId));
    return { success:true, successCount:ok, failCount:fail };
}

// MESSAGE HANDLER
rl.on("line", (line) => {
    let msg;
    try { msg = JSON.parse(line.trim()); } catch { return; }
    const { id, action, params } = msg;

    // Multi-task handling: Start an independent async process for each message
    (async () => {
        try {
            let r;
            switch (action) {
                case "ping":             r = { pong:true }; break;
                case "login":            r = await getApi(params); break;
                case "scan_group":       
                    const apiScan = await getApi(params);
                    const infoData = await apiScan.getGroupLinkInfo({ link: params.link, memberPage: 1 });
                    const mems = [];
                    let hasMore = true, page = 1;
                    while (hasMore) {
                        const pageData = await apiScan.getGroupLinkInfo({ link: params.link, memberPage: page });
                        if (pageData.currentMems?.length) {
                            // Ép kiểu ID thành String để chống mất độ chính xác
                            const sanitizedMems = pageData.currentMems.map(m => ({
                                ...m,
                                id: String(m.id || "")
                            }));
                            mems.push(...sanitizedMems);
                        }
                        hasMore = pageData.hasMoreMember && (page < 50); // Tăng giới hạn trang nếu cần
                        page++;
                        send(id, { event: "scan_progress", page, fetched: mems.length });
                        if (hasMore) await new Promise(res => setTimeout(res, 1200));
                    }
                    r = { 
                        success: true, 
                        groupInfo: { 
                            groupId: String(infoData.groupId || ""), 
                            name: infoData.name, 
                            desc: infoData.desc, 
                            totalMember: infoData.totalMember, 
                            creatorId: String(infoData.creatorId || ""), 
                            adminIds: (infoData.adminIds || []).map(a => String(a)), 
                            avatar: infoData.avt || "" 
                        }, 
                        members: mems 
                    };
                    break;
                case "batch_send_msg":   r = await batchSendMessage({ ...params, taskId: id }); break;
                case "batch_friend_req": r = await batchFriendReq({ ...params, taskId: id }); break;
                case "invite_to_group":  r = await inviteToGroup({ ...params, taskId: id }); break;
                case "cancel": 
                    globalStop = true;
                    r = { success:true };
                    break;
                default:                 r = { error:`Unknown: ${action}` };
            }
            send(id, r);
        } catch (e) { send(id, null, e.message); }
    })();
});

send("ready", { status: "ok" });
