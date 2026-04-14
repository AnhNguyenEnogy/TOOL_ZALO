/**
 * ZALO BRIDGE v2.4 - Messaging + Image Support
 */
import { Zalo } from "zca-js";
import readline from "node:readline";
import fs from "node:fs";

let zalo = null, api = null, cancelFlag = false;

const DEFAULT_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";
const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: false });

function send(id, data, error = null) {
    process.stdout.write(JSON.stringify({ id, data, error }) + "\n");
}

function cleanId(id) {
    return typeof id === "string" ? id.trim() : String(id);
}

async function resolveGroupId(input) {
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

// BATCH SEND MESSAGE + IMAGE
async function batchSendMessage(p) {
    if (!api) return { success:false, message:"Chưa đăng nhập" };
    cancelFlag = false;
    const ids = p.userIds, msg = p.message || "", delay = p.delayMs || 5000, img = p.imagePath;
    const limit = p.limit && p.limit > 0 ? Math.min(p.limit, ids.length) : ids.length;
    let ok = 0, fail = 0;

    for (let i = 0; i < limit && !cancelFlag; i++) {
        const uid = cleanId(ids[i]);
        try {
            // Priority: Send Image first, then text
            if (img && fs.existsSync(img)) {
                await api.sendImage(uid, img, ""); 
                // Add small delay between image and text
                await new Promise(r => setTimeout(r, 1000));
            }
            
            if (msg) {
                await api.sendMessage(uid, msg);
            }
            
            ok++;
            send("batch_progress", { action:"send_message", current:i+1, total:limit, userId:uid, ok:true, successCount:ok, failCount:fail });
        } catch (e) {
            fail++;
            send("batch_progress", { action:"send_message", current:i+1, total:limit, userId:uid, ok:false, error:e.message, successCount:ok, failCount:fail });
        }
        if (i < limit-1 && !cancelFlag) await new Promise(r => setTimeout(r, delay + Math.floor(Math.random()*2000)));
    }
    return { success:true, successCount:ok, failCount:fail, total:limit, cancelled: cancelFlag };
}

// BATCH FRIEND REQUEST
async function batchFriendReq(p) {
    if (!api) return { success:false, message:"Chưa đăng nhập" };
    cancelFlag = false;
    const ids = p.userIds, msg = p.message || "Xin chào!", delay = p.delayMs || 5000;
    const srcGroupId = p.sourceGroupId;
    const limit = p.limit && p.limit > 0 ? Math.min(p.limit, ids.length) : ids.length;
    let ok = 0, fail = 0;

    for (let i = 0; i < limit && !cancelFlag; i++) {
        const uid = cleanId(ids[i]);
        try {
            // Trying to solve "Invalid params" for public group members
            // by using api.post directly with standard headers
            await api.post("https://chat.zalo.me/api/friend/sendrequest", {
                toid: uid,
                msg: msg,
                source: srcGroupId ? 1 : 6,
                groupid: srcGroupId || ""
            });
            ok++;
            send("batch_progress", { action:"friend_request", current:i+1, total:limit, userId:uid, ok:true, successCount:ok, failCount:fail });
        } catch (e) {
            fail++;
            send("batch_progress", { action:"friend_request", current:i+1, total:limit, userId:uid, ok:false, error:e.message, successCount:ok, failCount:fail });
        }
        if (i < limit-1 && !cancelFlag) await new Promise(r => setTimeout(r, delay + Math.floor(Math.random()*2000)));
    }
    return { success:true, successCount:ok, failCount:fail, total:limit, cancelled: cancelFlag };
}

// BATCH INVITE TO GROUP
async function inviteToGroup(p) {
    if (!api) return { success:false, message:"Chưa đăng nhập" };
    cancelFlag = false;
    const ids = p.userIds, delay = p.delayMs || 3000;
    let gid = p.groupId;
    try { gid = await resolveGroupId(gid); } catch (e) { return { success: false, message: e.message }; }
    const limit = p.limit && p.limit > 0 ? Math.min(p.limit, ids.length) : ids.length;
    let ok = 0, fail = 0;

    for (let i = 0; i < limit && !cancelFlag; i++) {
        const uid = cleanId(ids[i]);
        try {
            await api.inviteUserToGroups(uid, [gid]);
            ok++;
            send("batch_progress", { action:"invite_to_group", current:i+1, total:limit, userId:uid, ok:true, successCount:ok, failCount:fail });
        } catch (e) {
            fail++;
            send("batch_progress", { action:"invite_to_group", current:i+1, total:limit, userId:uid, ok:false, error:e.message, successCount:ok, failCount:fail });
        }
        if (i < limit-1 && !cancelFlag) await new Promise(r => setTimeout(r, delay + Math.floor(Math.random()*2000)));
    }
    return { success:true, successCount:ok, failCount:fail, total:limit, cancelled: cancelFlag };
}

// MESSAGE HANDLER
rl.on("line", async (line) => {
    let msg;
    try { msg = JSON.parse(line.trim()); } catch { return; }
    const { id, action, params } = msg;
    if (action === "cancel") { cancelFlag = true; send(id, { cancelled: true }); return; }
    try {
        let r;
        switch (action) {
            case "ping":             r = { pong:true }; break;
            case "login_cookie":     r = await loginWithCookie(params); break;
            case "scan_group":       r = await scanGroupLink(params); break;
            case "batch_send_msg":   r = await batchSendMessage(params); break;
            case "batch_friend_req": r = await batchFriendReq(params); break;
            case "invite_to_group":  r = await inviteToGroup(params); break;
            default:                 r = { error:`Unknown: ${action}` };
        }
        send(id, r);
    } catch (e) { send(id, null, e.message); }
});

send("ready", { status: "ok" });
