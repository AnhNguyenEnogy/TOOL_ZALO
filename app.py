"""
╔══════════════════════════════════════════════════════════╗
║         ZALO GROUP SCANNER - GUI v2.0                    ║
║  Multi-account · Excel Export · Friend Request           ║
║  Group Invite · Admin Filter                             ║
╚══════════════════════════════════════════════════════════╝
"""

import sys, os, json, subprocess, threading, csv, time, re
import tkinter as tk
from tkinter import ttk, messagebox, filedialog
from datetime import datetime
from pathlib import Path

try:
    from openpyxl import Workbook
    from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
    HAS_OPENPYXL = True
except ImportError:
    HAS_OPENPYXL = False

BASE_DIR = Path(__file__).parent
CREDENTIALS_FILE = BASE_DIR / "credentials.json"
SCAN_DATA_DIR = BASE_DIR / "scan_data"
LAST_SESSION_FILE = BASE_DIR / "last_session.json"

DEFAULT_USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/130.0.0.0 Safari/537.36"
)

# ============================================================
# THEME
# ============================================================
C = {
    "bg": "#0d1117", "card": "#161b22", "card2": "#1c2333",
    "input": "#21262d", "hover": "#30363d", "border": "#30363d",
    "accent": "#58a6ff", "green": "#3fb950", "orange": "#f78166",
    "purple": "#d2a8ff", "red": "#f85149", "yellow": "#d29922",
    "text": "#e6edf3", "dim": "#8b949e", "bright": "#ffffff",
    "stripe": "#1a2030", "grad1": "#1f6feb", "grad2": "#8b5cf6",
}
F = {
    "title": ("Segoe UI", 16, "bold"), "h2": ("Segoe UI", 12, "bold"),
    "body": ("Segoe UI", 10), "sm": ("Segoe UI", 9),
    "mono": ("Consolas", 9), "btn": ("Segoe UI", 10, "bold"),
    "stat": ("Segoe UI", 24, "bold"), "statlbl": ("Segoe UI", 9),
}

# ============================================================
# BRIDGE
# ============================================================
class ZaloBridge:
    def __init__(self, node_path, bridge_path, on_event=None):
        self.node_path = node_path
        self.bridge_path = bridge_path
        self.on_event = on_event
        self.proc = None
        self.mid = 0
        self.pending = {}
        self.running = False

    def start(self):
        try:
            self.proc = subprocess.Popen(
                [self.node_path, self.bridge_path],
                stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                text=True, encoding="utf-8", bufsize=1,
                creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0,
            )
            self.running = True
            threading.Thread(target=self._read, daemon=True).start()
            return True
        except Exception as e:
            print(f"[Bridge] {e}")
            return False

    def stop(self):
        self.running = False
        if self.proc:
            try: self.proc.terminate(); self.proc.wait(3)
            except: pass

    def _read(self):
        while self.running and self.proc and self.proc.poll() is None:
            try:
                line = self.proc.stdout.readline().strip()
                if not line: continue
                msg = json.loads(line)
                mid, data, err = msg.get("id"), msg.get("data"), msg.get("error")
                events = ("scan_progress", "scan_error", "batch_progress", "ready")
                if mid in events:
                    if self.on_event: self.on_event(mid, data)
                elif mid in self.pending:
                    self.pending.pop(mid)(data, err)
            except json.JSONDecodeError: continue
            except: break

    def send(self, action, params=None, callback=None):
        if not self.proc or self.proc.poll() is not None:
            if callback: callback(None, "Bridge stopped")
            return
        self.mid += 1
        m = str(self.mid)
        if callback: self.pending[m] = callback
        try:
            self.proc.stdin.write(json.dumps({"id": m, "action": action, "params": params or {}}) + "\n")
            self.proc.stdin.flush()
        except Exception as e:
            if callback: callback(None, str(e))


# ============================================================
# WIDGETS
# ============================================================
class GradientCanvas(tk.Canvas):
    def __init__(self, master, c1, c2, h=50, **kw):
        super().__init__(master, height=h, highlightthickness=0, **kw)
        self.c1, self.c2 = c1, c2
        self.bind("<Configure>", self._draw)

    def _draw(self, e=None):
        self.delete("g")
        w, h = self.winfo_width(), self.winfo_height()
        r1,g1,b1 = int(self.c1[1:3],16), int(self.c1[3:5],16), int(self.c1[5:7],16)
        r2,g2,b2 = int(self.c2[1:3],16), int(self.c2[3:5],16), int(self.c2[5:7],16)
        for i in range(max(w,1)):
            t = i/max(w,1)
            c = f"#{int(r1+(r2-r1)*t):02x}{int(g1+(g2-g1)*t):02x}{int(b1+(b2-b1)*t):02x}"
            self.create_line(i,0,i,h,fill=c,tags="g")


class Btn(tk.Frame):
    def __init__(self, master, text, cmd=None, color=C["accent"], fg="white", **kw):
        bg = master.cget("bg") if hasattr(master,'cget') else C["bg"]
        super().__init__(master, bg=bg, **kw)
        self.color, self.cmd = color, cmd
        r,g,b = int(color[1:3],16), int(color[3:5],16), int(color[5:7],16)
        self.hover = f"#{min(255,r+30):02x}{min(255,g+30):02x}{min(255,b+30):02x}"
        self.lbl = tk.Label(self, text=text, font=F["btn"], bg=color, fg=fg,
                            padx=16, pady=6, cursor="hand2")
        self.lbl.pack(fill="x")
        self.lbl.bind("<Enter>", lambda e: self.lbl.config(bg=self.hover))
        self.lbl.bind("<Leave>", lambda e: self.lbl.config(bg=self.color))
        self.lbl.bind("<Button-1>", lambda e: self.cmd() if self.cmd else None)

    def set_enabled(self, ok):
        if ok:
            self.lbl.config(bg=self.color, cursor="hand2")
            self.lbl.bind("<Button-1>", lambda e: self.cmd() if self.cmd else None)
        else:
            self.lbl.config(bg=C["hover"], cursor="")
            self.lbl.unbind("<Button-1>")


def make_entry(parent, **kw):
    return tk.Entry(parent, font=F["mono"], bg=C["input"], fg=C["text"],
                    insertbackground=C["text"], highlightbackground=C["border"],
                    highlightthickness=1, relief="flat", bd=5, **kw)


def make_label(parent, text, **kw):
    return tk.Label(parent, text=text, font=F["sm"], bg=C["card"], fg=C["dim"], **kw)


def make_card(parent, title, color=C["accent"]):
    f = tk.LabelFrame(parent, text=f"  {title}  ", font=F["h2"],
                      bg=C["card"], fg=color, highlightbackground=C["border"],
                      highlightthickness=1, padx=10, pady=8, labelanchor="n")
    return f


# ============================================================
# MAIN APP
# ============================================================
class App:
    def __init__(self, root):
        self.root = root
        root.title("Zalo Group Scanner v2.1")
        root.geometry("1200x820")
        root.minsize(1050, 720)
        root.configure(bg=C["bg"])

        self.bridge = None
        self.logged_in = False
        self.scan_result = None
        self.filtered = []
        self.filter_admin = tk.BooleanVar(value=True)
        self.accounts = self._load_accounts()
        self.current_account = None
        self.batch_running = False
        self.image_path = tk.StringVar()
        self.scan_history = self._load_scan_history()

        SCAN_DATA_DIR.mkdir(exist_ok=True)
        self.node_path = self._find_node()
        self._build_ui()
        self._start_bridge()
        
        # Restore last session
        self.root.after(1000, self._load_last_session)

    # ---- Node.js ----
    def _find_node(self):
        p = BASE_DIR / "nodejs_portable" / "node-v20.12.2-win-x64" / "node.exe"
        if p.exists(): return str(p)
        import shutil
        return shutil.which("node")

    # ---- Accounts ----
    def _load_accounts(self):
        try:
            if CREDENTIALS_FILE.exists():
                d = json.loads(CREDENTIALS_FILE.read_text("utf-8"))
                if isinstance(d, list): return d
                if isinstance(d, dict):
                    if "accounts" in d: return d["accounts"]
                    return [d]  # migrate old single-account format
        except: pass
        return []

    def _save_accounts(self):
        CREDENTIALS_FILE.write_text(
            json.dumps({"accounts": self.accounts}, ensure_ascii=False, indent=2), "utf-8")

    # ---- Scan Data Persistence ----
    def _load_scan_history(self):
        """Load danh sách scan đã lưu"""
        history = []
        if SCAN_DATA_DIR.exists():
            for f in sorted(SCAN_DATA_DIR.glob("*.json"), key=lambda x: x.stat().st_mtime, reverse=True):
                try:
                    d = json.loads(f.read_text("utf-8"))
                    history.append({"file": f, "name": d.get("group",{}).get("name","?"),
                                    "count": d.get("memberCount",0),
                                    "time": d.get("scanTime","?")})
                except: pass
        return history

    def _save_scan_data(self, scan_result):
        """Tự động lưu kết quả quét vào scan_data/"""
        g = scan_result.get("groupInfo", {})
        mems = scan_result.get("members", [])
        name = re.sub(r'[<>:"/\\|?*]', '_', g.get("name","group"))[:60]
        ts = datetime.now().strftime("%Y%m%d_%H%M%S")
        fp = SCAN_DATA_DIR / f"{name}_{ts}.json"

        data = {
            "group": {
                "id": g.get("groupId"), "name": g.get("name"), "desc": g.get("desc"),
                "totalMember": g.get("totalMember"), "creatorId": g.get("creatorId"),
                "adminIds": g.get("adminIds", []),
            },
            "scanTime": datetime.now().isoformat(),
            "memberCount": len(mems),
            "members": mems,
        }
        fp.write_text(json.dumps(data, ensure_ascii=False, indent=2), "utf-8")
        self.scan_history.insert(0, {"file": fp, "name": g.get("name","?"),
                                     "count": len(mems), "time": data["scanTime"]})
        return fp

    def _save_last_session(self):
        """Lưu toàn bộ thông số và data phiên làm việc"""
        try:
            data = {
                "link": self.link_entry.get().strip(),
                "delay": self.delay_entry.get().strip(),
                "limit": self.limit_entry.get().strip(),
                "friend_msg": self.friend_msg.get().strip(),
                "target_group_id": self.group_id_entry.get().strip(),
                "scan_result": self.scan_result
            }
            LAST_SESSION_FILE.write_text(json.dumps(data, ensure_ascii=False), "utf-8")
        except: pass

    def _load_last_session(self):
        """Khôi phục toàn bộ thông số từ file"""
        try:
            if LAST_SESSION_FILE.exists():
                d = json.loads(LAST_SESSION_FILE.read_text("utf-8"))
                
                # Restore inputs
                if d.get("link"):
                    self.link_entry.delete(0, "end")
                    self.link_entry.insert(0, d["link"])
                if d.get("delay"):
                    self.delay_entry.delete(0, "end")
                    self.delay_entry.insert(0, d["delay"])
                if d.get("limit"):
                    self.limit_entry.get()
                    self.limit_entry.delete(0, "end")
                    self.limit_entry.insert(0, d["limit"])
                if d.get("friend_msg"):
                    self.friend_msg.delete(0, "end")
                    self.friend_msg.insert(0, d["friend_msg"])
                if d.get("target_group_id"):
                    self.group_id_entry.delete(0, "end")
                    self.group_id_entry.insert(0, d["target_group_id"])

                self.scan_result = d.get("scan_result")
                if self.scan_result:
                    self._log("🔄 Đã khôi phục toàn bộ cài đặt & data phiên trước.", "info")
                    self._apply_filter()
        except: pass

    # ---- UI ----
    def _build_ui(self):
        main = tk.Frame(self.root, bg=C["bg"])
        main.pack(fill="both", expand=True, padx=8, pady=8)

        # LEFT
        left = tk.Frame(main, bg=C["bg"], width=330)
        left.pack(side="left", fill="y", padx=(0,10))
        left.pack_propagate(False)

        self._build_account_section(left)
        self._build_scan_section(left)
        self._build_filter_section(left)
        self._build_action_section(left)

        # RIGHT
        right = tk.Frame(main, bg=C["bg"])
        right.pack(side="left", fill="both", expand=True)

        self._build_stats(right)
        self._build_table(right)
        self._build_log(right)

    # ---- ACCOUNT SECTION ----
    def _build_account_section(self, parent):
        card = make_card(parent, "🔐 TÀI KHOẢN", C["accent"])
        card.pack(fill="x", pady=(0,5))

        self.login_status = tk.Label(card, text="⏳ Đang chờ...", font=F["sm"],
                                     bg=C["card"], fg=C["yellow"])
        self.login_status.pack(fill="x")

        # Account dropdown
        row_acc = tk.Frame(card, bg=C["card"])
        row_acc.pack(fill="x", pady=2)
        tk.Label(row_acc, text="Acc:", font=F["sm"], bg=C["card"], fg=C["dim"]).pack(side="left")
        self.acc_var = tk.StringVar()
        self.acc_combo = ttk.Combobox(row_acc, textvariable=self.acc_var, state="readonly", font=F["mono"])
        self.acc_combo.pack(side="left", fill="x", expand=True, padx=(5,0))
        self._refresh_account_list()

        btn_row = tk.Frame(card, bg=C["card"])
        btn_row.pack(fill="x", pady=2)
        Btn(btn_row, "🔑 Login", cmd=self._do_login, color=C["accent"]).pack(side="left", expand=True, fill="x", padx=(0,2))
        Btn(btn_row, "➕ Thêm", cmd=self._add_account, color="#2d6a4f").pack(side="left", expand=True, fill="x", padx=(1,1))
        Btn(btn_row, "🗑️ Xóa", cmd=self._delete_account, color=C["red"]).pack(side="left", expand=True, fill="x", padx=(2,0))

    def _refresh_account_list(self):
        names = [a.get("name", a.get("imei", "?")[:20]) for a in self.accounts]
        self.acc_combo["values"] = names
        if names:
            self.acc_combo.current(0)

    def _add_account(self):
        win = tk.Toplevel(self.root)
        win.title("Thêm tài khoản")
        win.geometry("520x480")
        win.configure(bg=C["bg"])
        win.transient(self.root)
        win.grab_set()

        card = tk.Frame(win, bg=C["card"], padx=16, pady=16)
        card.pack(fill="both", expand=True, padx=16, pady=16)

        tk.Label(card, text="Tên tài khoản:", font=F["body"], bg=C["card"],
                 fg=C["text"]).pack(anchor="w")
        name_e = make_entry(card)
        name_e.pack(fill="x", pady=(2,8))

        tk.Label(card, text="IMEI:", font=F["body"], bg=C["card"],
                 fg=C["text"]).pack(anchor="w")
        imei_e = make_entry(card)
        imei_e.pack(fill="x", pady=(2,8))

        tk.Label(card, text="Cookie (JSON array từ ZaloDataExtractor):", font=F["body"],
                 bg=C["card"], fg=C["text"]).pack(anchor="w")
        cookie_t = tk.Text(card, font=F["mono"], bg=C["input"], fg=C["text"],
                           insertbackground=C["text"], height=8, relief="flat", bd=5, wrap="word")
        cookie_t.pack(fill="x", pady=(2,8))

        tk.Label(card, text="User-Agent:", font=F["body"], bg=C["card"],
                 fg=C["text"]).pack(anchor="w")
        ua_e = make_entry(card)
        ua_e.insert(0, DEFAULT_USER_AGENT)
        ua_e.pack(fill="x", pady=(2,8))

        def save():
            name = name_e.get().strip() or f"Account {len(self.accounts)+1}"
            imei = imei_e.get().strip()
            raw = cookie_t.get("1.0", "end").strip()
            ua = ua_e.get().strip() or DEFAULT_USER_AGENT
            if not imei or not raw:
                messagebox.showwarning("Thiếu", "Cần IMEI và Cookie!", parent=win)
                return
            try:
                cookie = json.loads(raw)
            except:
                messagebox.showerror("Lỗi", "Cookie phải là JSON hợp lệ!", parent=win)
                return
            self.accounts.append({"name": name, "imei": imei, "cookie": cookie, "userAgent": ua})
            self._save_accounts()
            self._refresh_account_list()
            self.acc_combo.current(len(self.accounts) - 1)
            self._log(f"✅ Thêm tài khoản: {name}", "ok")
            win.destroy()

        Btn(card, "💾 Lưu tài khoản", cmd=save, color=C["green"]).pack(fill="x", pady=(4,0))

    def _delete_account(self):
        idx = self.acc_combo.current()
        if idx < 0: return
        name = self.accounts[idx].get("name", "?")
        if not messagebox.askyesno("Xác nhận", f"Xóa tài khoản '{name}'?"):
            return
        self.accounts.pop(idx)
        self._save_accounts()
        self._refresh_account_list()
        self._log(f"🗑️ Đã xóa tài khoản: {name}", "warn")

    # ---- SCAN SECTION ----
    def _build_scan_section(self, parent):
        card = make_card(parent, "🔍 QUÉT NHÓM", C["green"])
        card.pack(fill="x", pady=(0,5))

        make_label(card, "Link nhóm Zalo:").pack(anchor="w")
        self.link_entry = make_entry(card)
        self.link_entry.pack(fill="x", pady=(2,4))
        self.link_entry.insert(0, "https://zalo.me/g/")

        style = ttk.Style()
        style.theme_use("clam")
        style.configure("G.Horizontal.TProgressbar", troughcolor=C["input"],
                         background=C["green"], thickness=5)
        self.pvar = tk.DoubleVar()
        ttk.Progressbar(card, variable=self.pvar, maximum=100,
                        style="G.Horizontal.TProgressbar").pack(fill="x", pady=(2,2))
        self.plabel = tk.Label(card, text="", font=F["sm"], bg=C["card"], fg=C["dim"])
        self.plabel.pack(fill="x")

        self.scan_btn = Btn(card, "🚀 BẮT ĐẦU QUÉT", cmd=self._do_scan, color=C["green"])
        self.scan_btn.pack(fill="x", pady=(4,0))

    # ---- FILTER ----
    def _build_filter_section(self, parent):
        card = make_card(parent, "⚙️ BỘ LỌC · XUẤT FILE", C["purple"])
        card.pack(fill="x", pady=(0,5))

        tk.Checkbutton(card, text=" Loại bỏ Trưởng/Phó nhóm", variable=self.filter_admin,
                       font=F["body"], bg=C["card"], fg=C["text"], selectcolor=C["input"],
                       activebackground=C["card"], activeforeground=C["text"],
                       command=self._apply_filter).pack(anchor="w")

        row = tk.Frame(card, bg=C["card"])
        row.pack(fill="x", pady=(6,0))
        Btn(row, "📊 Excel", cmd=self._export_excel, color="#2d6a4f").pack(
            side="left", expand=True, fill="x", padx=(0,3))
        Btn(row, "📄 CSV", cmd=self._export_csv, color="#1a535c").pack(
            side="left", expand=True, fill="x", padx=(3,3))
        Btn(row, "📋 JSON", cmd=self._export_json, color="#6930c3").pack(
            side="left", expand=True, fill="x", padx=(3,0))

        Btn(card, "📂 IMPORT Excel (Load data cũ)", cmd=self._import_excel,
            color="#3f6791").pack(fill="x", pady=(6,0))

    # ---- ACTION SECTION ----
    def _build_action_section(self, parent):
        card = make_card(parent, "🚀 HÀNH ĐỘNG HÀNG LOẠT", C["orange"])
        card.pack(fill="x", pady=(0,5))

        # Row: Delay + Limit
        row_dl = tk.Frame(card, bg=C["card"])
        row_dl.pack(fill="x", pady=(0,4))

        dl_f = tk.Frame(row_dl, bg=C["card"])
        dl_f.pack(side="left", expand=True, fill="x", padx=(0,4))
        make_label(dl_f, "Delay (giây):").pack(anchor="w")
        self.delay_entry = make_entry(dl_f, width=8)
        self.delay_entry.insert(0, "30")
        self.delay_entry.pack(fill="x")

        lm_f = tk.Frame(row_dl, bg=C["card"])
        lm_f.pack(side="left", expand=True, fill="x", padx=(4,0))
        make_label(lm_f, "Giới hạn (0=tất cả):").pack(anchor="w")
        self.limit_entry = make_entry(lm_f, width=8)
        self.limit_entry.insert(0, "0")
        self.limit_entry.pack(fill="x")

        make_label(card, "Lời nhắn kết bạn:").pack(anchor="w", pady=(4,0))
        self.friend_msg = make_entry(card)
        self.friend_msg.insert(0, "Xin chào! Mình muốn kết bạn.")
        self.friend_msg.pack(fill="x", pady=(2,4))

        make_label(card, "ID nhóm mời / URL nhóm:").pack(anchor="w")
        self.group_id_entry = make_entry(card)
        self.group_id_entry.pack(fill="x", pady=(2,4))

        # Chọn ảnh
        self.image_path = tk.StringVar(value="Chưa chọn ảnh...")
        row_img = tk.Frame(card, bg=C["card"])
        row_img.pack(fill="x", pady=(4,2))
        make_label(row_img, "Hình ảnh quảng cáo:").pack(side="left")
        tk.Label(card, textvariable=self.image_path, font=F["sm"],
                 bg=C["card"], fg=C["accent"], wraplength=280).pack(fill="x")
        Btn(card, "🖼️ Chọn ảnh gửi kèm", cmd=self._pick_image, color="#4b5563").pack(fill="x", pady=(2,4))

        self.action_progress = tk.Label(card, text="", font=F["sm"],
                                        bg=C["card"], fg=C["dim"])
        self.action_progress.pack(fill="x", pady=(2,2))

        r1 = tk.Frame(card, bg=C["card"])
        r1.pack(fill="x", pady=(4,3))
        Btn(r1, "👋 Kết bạn", cmd=self._batch_friend,
            color=C["accent"]).pack(side="left", expand=True, fill="x", padx=(0,3))
        Btn(r1, "📨 Mời nhóm", cmd=self._batch_invite,
            color=C["orange"]).pack(side="left", expand=True, fill="x", padx=(3,0))

        Btn(card, "💬 Gửi Tin nhắn + Ảnh (Hiệu quả nhất)", cmd=self._batch_message,
            color=C["green"]).pack(fill="x", pady=(2,4))

        self.stop_btn = Btn(card, "⛔ DỪNG", cmd=self._do_cancel, color=C["red"])
        self.stop_btn.pack(fill="x", pady=(2,0))

        # ---- Scan History ----
        sep = tk.Frame(card, bg=C["border"], height=1)
        sep.pack(fill="x", pady=(8,4))
        make_label(card, "📂 Lịch sử quét (load lại):").pack(anchor="w")
        self.history_var = tk.StringVar()
        self.history_combo = ttk.Combobox(card, textvariable=self.history_var,
                                          state="readonly", font=F["mono"])
        self.history_combo.pack(fill="x", pady=(2,2))
        self._refresh_history()
        Btn(card, "📂 Load data đã lưu", cmd=self._load_history_item,
            color="#374151").pack(fill="x", pady=(2,0))

    # ---- STATS ----
    def _build_stats(self, parent):
        row = tk.Frame(parent, bg=C["bg"])
        row.pack(fill="x", pady=(0,4))

        def stat(parent, icon, lbl, color):
            f = tk.Frame(parent, bg=C["card2"], highlightbackground=C["border"],
                         highlightthickness=1, padx=8, pady=4)
            tk.Label(f, text=icon, font=F["body"], bg=C["card2"], fg=color).pack(side="left")
            v = tk.Label(f, text="0", font=("Segoe UI",11,"bold"), bg=C["card2"], fg=C["bright"])
            v.pack(side="left", padx=5)
            tk.Label(f, text=lbl, font=("Segoe UI",8), bg=C["card2"], fg=C["dim"]).pack(side="left")
            return f, v

        self.s_total_f, self.s_total = stat(row, "👥", "Tổng", C["accent"])
        self.s_total_f.pack(side="left", fill="x", expand=True, padx=(0,2))
        self.s_admin_f, self.s_admin = stat(row, "👑", "Admin", C["yellow"])
        self.s_admin_f.pack(side="left", fill="x", expand=True, padx=2)
        self.s_member_f, self.s_member = stat(row, "✅", "Mems", C["green"])
        self.s_member_f.pack(side="left", fill="x", expand=True, padx=(2,0))

    # ---- TABLE ----
    def _build_table(self, parent):
        tf = tk.Frame(parent, bg=C["card"], highlightbackground=C["border"], highlightthickness=1)
        tf.pack(fill="both", expand=True, pady=(0,6))

        hdr = tk.Frame(tf, bg=C["card2"], pady=5, padx=8)
        hdr.pack(fill="x")
        self.tbl_title = tk.Label(hdr, text="📋 DANH SÁCH THÀNH VIÊN", font=F["h2"],
                                  bg=C["card2"], fg=C["text"])
        self.tbl_title.pack(side="left")
        
        # Select All Buttons
        sel_row = tk.Frame(hdr, bg=C["card2"])
        sel_row.pack(side="right")
        tk.Button(sel_row, text="☑ Tất cả", font=F["sm"], bg="#2d3748", fg="white", 
                  relief="flat", padx=5, command=lambda: self._toggle_all(True)).pack(side="left", padx=2)
        tk.Button(sel_row, text="☐ Bỏ chọn", font=F["sm"], bg="#2d3748", fg="white", 
                  relief="flat", padx=5, command=lambda: self._toggle_all(False)).pack(side="left", padx=2)

        self.tbl_count = tk.Label(hdr, text="", font=("Segoe UI",8,"bold"),
                                  bg=C["accent"], fg="white", padx=6, pady=1)
        self.tbl_count.pack(side="right", padx=(10,0))

        cols = ("check", "stt", "id", "name", "zname", "role", "status")
        st = ttk.Style()
        st.configure("T.Treeview", background=C["card"], foreground=C["text"],
                      fieldbackground=C["card"], borderwidth=0, font=F["sm"], rowheight=28)
        st.configure("T.Treeview.Heading", background=C["card2"], foreground=C["bright"],
                      font=F["body"], borderwidth=0, relief="flat")
        st.map("T.Treeview", background=[("selected",C["grad1"])], foreground=[("selected","white")])

        tc = tk.Frame(tf, bg=C["card"])
        tc.pack(fill="both", expand=True, padx=1)
        self.tree = ttk.Treeview(tc, columns=cols, show="headings", style="T.Treeview",
                                  selectmode="extended")
        
        col_defs = [
            ("check", "Chon", 35, "center"),
            ("stt", "STT", 45, "center"),
            ("id", "Zalo ID", 155, "w"),
            ("name", "Tên hiển thị", 180, "w"),
            ("zname", "Tên Zalo", 150, "w"),
            ("role", "Vai trò", 100, "center"),
            ("status", "Trạng thái", 120, "center")
        ]
        
        for cid, txt, w, anc in col_defs:
            self.tree.heading(cid, text=txt if cid != "check" else "☑")
            self.tree.column(cid, width=w, minwidth=w, anchor=anc)

        self.tree.tag_configure("ok", foreground=C["green"])
        self.tree.tag_configure("warn", foreground=C["yellow"])
        self.tree.tag_configure("error", foreground=C["red"])
        self.tree.tag_configure("owner", foreground=C["red"])
        self.tree.tag_configure("admin", foreground=C["yellow"])
        self.tree.tag_configure("stripe", background=C["stripe"])
        
        # Click checkbox toggle
        self.tree.bind("<Button-1>", self._on_tree_click)

        sb = ttk.Scrollbar(tc, orient="vertical", command=self.tree.yview)
        self.tree.configure(yscrollcommand=sb.set)
        sb.pack(side="right", fill="y")
        self.tree.pack(fill="both", expand=True)

    # ---- LOG ----
    def _build_log(self, parent):
        lf = tk.Frame(parent, bg=C["card"], highlightbackground=C["border"],
                      highlightthickness=1, height=110)
        lf.pack(fill="x"); lf.pack_propagate(False)
        tk.Frame(lf, bg=C["card2"], pady=3, padx=8).pack(fill="x")
        tk.Label(lf, text="📝 LOG", font=F["body"], bg=C["card2"], fg=C["dim"]).place(x=8, y=2)
        self.log = tk.Text(lf, font=F["mono"], bg=C["card"], fg=C["dim"], height=4,
                           state="disabled", relief="flat", bd=6, wrap="word")
        self.log.pack(fill="both", expand=True, pady=(20,0))
        for t,c in [("info",C["accent"]),("ok",C["green"]),("warn",C["yellow"]),("error",C["red"])]:
            self.log.tag_configure(t, foreground=c)

    def _log(self, msg, tag="info"):
        ts = datetime.now().strftime("%H:%M:%S")
        self.log.config(state="normal")
        self.log.insert("end", f"[{ts}] {msg}\n", tag)
        self.log.see("end")
        self.log.config(state="disabled")

    # ============================================================
    # BRIDGE
    # ============================================================
    def _start_bridge(self):
        if not self.node_path:
            self.login_status.config(text="❌ Node.js not found!", fg=C["red"])
            return
        bp = str(BASE_DIR / "zalo_bridge.mjs")
        self.bridge = ZaloBridge(self.node_path, bp, on_event=lambda e,d: self.root.after(0, self._evt, e, d))
        if self.bridge.start():
            self._log("Bridge khởi động...")
        else:
            self.login_status.config(text="❌ Bridge failed", fg=C["red"])

    def _evt(self, eid, data):
        if eid == "ready":
            if self.accounts:
                self.login_status.config(text="⚡ Tự động đăng nhập...", fg=C["yellow"])
                self._log("⚡ Tìm thấy tài khoản đã lưu, tự động đăng nhập...")
                self.root.after(300, self._do_login)
            else:
                self.login_status.config(text="🟢 Sẵn sàng — Thêm tài khoản để bắt đầu", fg=C["green"])
                self._log("Bridge sẵn sàng.", "ok")
        elif eid == "scan_progress":
            t = data.get("totalMember",1)
            f = data.get("totalFetched",0)
            p = min(100, f/max(t,1)*100)
            self.pvar.set(p)
            self.plabel.config(text=f"Trang {data.get('page')} • {f}/{t} ({p:.0f}%)")
        elif eid == "scan_error":
            self._log(f"⚠ Lỗi trang {data.get('page')}: {data.get('error')}", "warn")
        elif eid == "batch_progress":
            d = data
            act = {"friend_request":"Kết bạn","add_to_group":"Thêm vào nhóm",
                   "invite_to_group":"Mời vào nhóm", "send_message": "Gửi tin"}.get(d.get("action"), d.get("action"))
            ok_icon = "✅" if d.get("ok") else "❌"
            self.action_progress.config(
                text=f"{act}: {d.get('current')}/{d.get('total')} | ✅{d.get('successCount')} ❌{d.get('failCount')}")
            uid = d.get("userId","")
            
            # Cập nhật trạng thái trong bảng
            for item_id in self.tree.get_children():
                vals = list(self.tree.item(item_id, "values"))
                if vals[2] == uid:
                    new_status = "Thành công" if d.get("ok") else "Thất bại"
                    vals[6] = new_status
                    self.tree.item(item_id, values=vals, tags=(*self.tree.item(item_id,"tags"), "ok" if d.get("ok") else "error"))
                    break

            if d.get("ok"):
                self._log(f"✅ {act} {uid} ({d.get('current')}/{d.get('total')})", "ok")
            else:
                err_msg = d.get("error", "Không rõ lỗi")
                self._log(f"❌ {act} {uid} thất bại: {err_msg} ({d.get('current')}/{d.get('total')})", "warn")

    # ============================================================
    # LOGIN
    # ============================================================
    def _do_login(self):
        if not self.bridge: return
        idx = self.acc_combo.current()
        if idx < 0 or idx >= len(self.accounts):
            messagebox.showwarning("Chọn tài khoản", "Thêm tài khoản trước!")
            return
        acc = self.accounts[idx]
        self.current_account = acc
        self.login_status.config(text="⏳ Đang đăng nhập...", fg=C["yellow"])
        self._log(f"Đăng nhập: {acc.get('name', '?')}...")

        def cb(data, err):
            self.root.after(0, self._login_result, data, err)
        self.bridge.send("login_cookie", {
            "imei": acc["imei"], "cookie": acc["cookie"],
            "userAgent": acc.get("userAgent", DEFAULT_USER_AGENT),
        }, cb)

    def _login_result(self, data, err):
        if err:
            self.login_status.config(text=f"❌ {err}", fg=C["red"])
            self._log(f"Đăng nhập thất bại: {err}", "error")
            return
        if data and data.get("success"):
            self.logged_in = True
            name = self.current_account.get("name","?") if self.current_account else "?"
            self.login_status.config(text=f"🟢 {name} — Đã đăng nhập!", fg=C["green"])
            self._log(f"✅ Đăng nhập thành công: {name}", "ok")
        else:
            msg = data.get("message","?") if data else "?"
            self.login_status.config(text=f"❌ {msg}", fg=C["red"])
            self._log(f"Thất bại: {msg}", "error")

    # ============================================================
    # SCAN
    # ============================================================
    def _do_scan(self):
        if not self.logged_in:
            messagebox.showwarning("!", "Đăng nhập trước!")
            return
        link = self.link_entry.get().strip()
        if "zalo.me/g/" not in link:
            messagebox.showwarning("!", "Link phải có dạng https://zalo.me/g/xxxxx")
            return
        self.scan_btn.set_enabled(False)
        self.pvar.set(0)
        self.plabel.config(text="Đang quét...")
        self._log(f"🔍 Quét: {link}")

        def cb(d, e): self.root.after(0, self._scan_done, d, e)
        self.bridge.send("scan_group", {"link": link}, cb)

    def _scan_done(self, data, err):
        self.scan_btn.set_enabled(True)
        if err:
            self.plabel.config(text=f"❌ {err}")
            self._log(f"Lỗi: {err}", "error")
            return
        if not data or not data.get("success"):
            m = data.get("message","?") if data else "?"
            self.plabel.config(text=f"❌ {m}")
            self._log(f"Lỗi: {m}", "error")
            return
        self.scan_result = data
        g = data.get("groupInfo",{})
        n = len(data.get("members",[]))
        self.pvar.set(100)
        gid = g.get('groupId','?')
        self.plabel.config(text=f"✅ {n}/{g.get('totalMember','?')} thành viên")
        self._log(f"✅ Quét xong \"{g.get('name')}\" — {n} thành viên", "ok")
        self._log(f"🆔 Mã ID Nhóm này: {gid} (Dùng để mời nhóm)", "info")

        # Tự động lưu data
        try:
            fp = self._save_scan_data(data)
            self._log(f"📂 Đã tự động lưu: {fp.name}", "ok")
            self._refresh_history()
            self._save_last_session()
        except Exception as e:
            self._log(f"Không thể tự động lưu: {e}", "warn")

        self._apply_filter()

    def _refresh_history(self):
        self.scan_history = self._load_scan_history()
        names = [f"({h['count']}) {h['name']} - {h['time'][:16].replace('T',' ')}" for h in self.scan_history]
        self.history_combo["values"] = names
        if names: self.history_combo.current(0)

    def _load_history_item(self):
        idx = self.history_combo.current()
        if idx < 0: return
        item = self.scan_history[idx]
        try:
            d = json.loads(item["file"].read_text("utf-8"))
            # Convert save format back to scan result format
            self.scan_result = {
                "success": True,
                "groupInfo": d.get("group"),
                "members": d.get("members")
            }
            self._log(f"📂 Đã load data từ: {item['file'].name}", "ok")
            self._apply_filter()
        except Exception as e:
            messagebox.showerror("Lỗi", f"Không thể load file: {e}")

    def _do_cancel(self):
        if self.bridge:
            self.bridge.send("cancel")
            self._log("⛔ Đang yêu cầu dừng...", "warn")
            self.batch_running = False

    # ============================================================
    # FILTER
    # ============================================================
    def _apply_filter(self):
        if not self.scan_result: return
        g = self.scan_result.get("groupInfo",{})
        mems = self.scan_result.get("members",[])
        cid = g.get("creatorId","")
        aids = set(g.get("adminIds",[]))

        all_d = []
        ac = 0
        for m in mems:
            mid = m.get("id","")
            
            # Nếu data đã có role sẵn (từ Excel import hoặc history)
            existing_role = m.get("role")
            
            if mid == cid:
                role, is_a = "👑 Trưởng nhóm", True
            elif mid in aids:
                role, is_a = "⭐ Phó nhóm", True
            if existing_role and ("Trưởng" in str(existing_role) or "Phó" in str(existing_role)):
                role, is_a = existing_role, True
            else:
                role, is_a = existing_role or "Thành viên", False
                
            if is_a: ac += 1
            all_d.append({
                "id": mid, 
                "dName": m.get("dName", m.get("displayName","")),
                "zaloName": m.get("zaloName",""), 
                "role": role, 
                "is_admin": is_a,
                "status": m.get("last_status", "Sẵn sàng"),
                "checked": m.get("checked", True)
            })

        self.filtered = [m for m in all_d if not m["is_admin"]] if self.filter_admin.get() else all_d
        rc = len(mems) - ac

        self.s_total.config(text=str(len(mems)))
        self.s_admin.config(text=str(ac))
        self.s_member.config(text=str(rc))

        self.tree.delete(*self.tree.get_children())
        for i, m in enumerate(self.filtered):
            tags = []
            if "Trưởng" in m["role"]: tags.append("owner")
            elif "Phó" in m["role"]: tags.append("admin")
            if i%2==1: tags.append("stripe")
            
            check_mark = "☑" if m["checked"] else "☐"
            
            self.tree.insert("","end", values=(check_mark, i+1, m["id"], m["dName"], m["zaloName"], m["role"], m["status"]),
                            tags=tuple(tags))

        ft = "(lọc admin)" if self.filter_admin.get() else "(tất cả)"
        self.tbl_count.config(text=f" {len(self.filtered)} {ft} ")
        self.tbl_title.config(text=f"📋 {g.get('name','N/A')}")

    # ============================================================
    # EXPORT
    # ============================================================
    def _safe_name(self, n):
        return re.sub(r'[<>:"/\\|?*]', '_', n or "group")[:80]

    def _get_save_path(self, ext):
        if not self.filtered:
            messagebox.showinfo("!", "Chưa có dữ liệu!")
            return None
        g = self.scan_result.get("groupInfo",{}) if self.scan_result else {}
        nm = self._safe_name(g.get("name","zalo"))
        return filedialog.asksaveasfilename(
            defaultextension=ext,
            initialfile=f"{nm}_{datetime.now().strftime('%Y%m%d_%H%M')}{ext}",
            filetypes=[(f"{ext.upper()} files", f"*{ext}"), ("All", "*.*")])

    def _export_excel(self):
        if not HAS_OPENPYXL:
            messagebox.showerror("!", "Cần cài openpyxl:\npip install openpyxl")
            return
        fp = self._get_save_path(".xlsx")
        if not fp: return

        g = self.scan_result.get("groupInfo",{}) if self.scan_result else {}
        wb = Workbook()
        ws = wb.active
        ws.title = "Thành viên"

        # Style
        hdr_font = Font(bold=True, color="FFFFFF", size=11)
        hdr_fill = PatternFill(start_color="1F6FEB", end_color="1F6FEB", fill_type="solid")
        thin = Side(style="thin", color="CCCCCC")
        border = Border(left=thin, right=thin, top=thin, bottom=thin)

        # Info rows
        ws.append([f"Nhóm: {g.get('name','')}"])
        ws.append([f"Tổng thành viên: {g.get('totalMember','')}"])
        ws.append([f"Quét lúc: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}"])
        ws.append([f"Lọc admin: {'Có' if self.filter_admin.get() else 'Không'}"])
        ws.append([])

        # Header
        headers = ["STT", "Zalo ID", "Tên hiển thị", "Tên Zalo", "Vai trò"]
        ws.append(headers)
        for cell in ws[6]:
            cell.font = hdr_font
            cell.fill = hdr_fill
            cell.alignment = Alignment(horizontal="center")
            cell.border = border

        # Data
        for i, m in enumerate(self.filtered):
            row = [i+1, m["id"], m["dName"], m["zaloName"], m["role"]]
            ws.append(row)
            for cell in ws[ws.max_row]:
                cell.border = border

        # Column widths
        ws.column_dimensions["A"].width = 6
        ws.column_dimensions["B"].width = 22
        ws.column_dimensions["C"].width = 28
        ws.column_dimensions["D"].width = 24
        ws.column_dimensions["E"].width = 16

        wb.save(fp)
        self._log(f"💾 Excel: {fp}", "ok")
        messagebox.showinfo("✅", f"Đã xuất {len(self.filtered)} thành viên!\n{fp}")

    def _export_csv(self):
        fp = self._get_save_path(".csv")
        if not fp: return
        g = self.scan_result.get("groupInfo",{}) if self.scan_result else {}
        with open(fp, "w", newline="", encoding="utf-8-sig") as f:
            w = csv.writer(f)
            w.writerow([f"# Nhóm: {g.get('name','')}"])
            w.writerow([f"# Tổng: {g.get('totalMember','')}"])
            w.writerow([f"# Lúc: {datetime.now().strftime('%Y-%m-%d %H:%M')}"])
            w.writerow([])
            w.writerow(["STT","Zalo ID","Tên hiển thị","Tên Zalo","Vai trò"])
            for i,m in enumerate(self.filtered):
                w.writerow([i+1, m["id"], m["dName"], m["zaloName"], m["role"]])
        self._log(f"💾 CSV: {fp}", "ok")
        messagebox.showinfo("✅", f"Đã xuất {len(self.filtered)} thành viên!\n{fp}")

    def _export_json(self):
        fp = self._get_save_path(".json")
        if not fp: return
        g = self.scan_result.get("groupInfo",{}) if self.scan_result else {}
        data = {
            "group": {"id":g.get("groupId"),"name":g.get("name"),"totalMember":g.get("totalMember")},
            "scanTime": datetime.now().isoformat(),
            "count": len(self.filtered),
            "members": [{"i":i+1,"id":m["id"],"name":m["dName"],"zalo":m["zaloName"],"role":m["role"]}
                        for i,m in enumerate(self.filtered)],
        }
        Path(fp).write_text(json.dumps(data, ensure_ascii=False, indent=2), "utf-8")
        self._log(f"💾 JSON: {fp}", "ok")
        messagebox.showinfo("✅", f"Đã xuất {len(self.filtered)} thành viên!\n{fp}")

    def _import_excel(self):
        if not HAS_OPENPYXL:
            messagebox.showerror("!", "Cần cài openpyxl để load Excel.")
            return
        
        fp = filedialog.askopenfilename(
            title="Chọn file Excel",
            filetypes=[("Excel files", "*.xlsx"), ("All files", "*.*")]
        )
        if not fp: return

        try:
            import openpyxl
            wb = openpyxl.load_workbook(fp)
            ws = wb.active
            
            group_name = "Imported"
            # Thử tìm tên nhóm ở dòng 1
            row1 = str(ws.cell(row=1, column=1).value or "")
            if "Nhóm:" in row1:
                group_name = row1.replace("Nhóm:", "").strip()

            members = []
            # Tìm dòng header (thường là dòng 6 dựa trên cấu trúc export)
            header_row = 1
            for r in range(1, 10):
                if str(ws.cell(row=r, column=2).value).strip() == "Zalo ID":
                    header_row = r
                    break
            
            for r in range(header_row + 1, ws.max_row + 1):
                cell_val = ws.cell(row=r, column=2).value
                if cell_val is None: continue
                
                # Xử lý số lớn trong Excel không bị biến thành 1.23E+18
                if isinstance(cell_val, (int, float)):
                    mid = "{:.0f}".format(cell_val)
                else:
                    mid = str(cell_val).strip()
                
                name = str(ws.cell(row=r, column=3).value or "").strip()
                zname = str(ws.cell(row=r, column=4).value or "").strip()
                role = str(ws.cell(row=r, column=5).value or "").strip()
                
                if mid and mid != "None" and len(mid) > 5:
                    members.append({
                        "id": mid,
                        "dName": name,
                        "zaloName": zname,
                        "role": role # mapping will be done in _apply_filter
                    })

            if not members:
                messagebox.showwarning("!", "Không tìm thấy dữ liệu thành viên hợp lệ trong file Excel!")
                return

            self.scan_result = {
                "success": True,
                "groupInfo": {"name": group_name, "groupId": "excel_import"},
                "members": members
            }
            self._log(f"📥 Đã import {len(members)} thành viên từ Excel.", "ok")
            self._apply_filter()
            self._save_last_session()
            
        except Exception as e:
            messagebox.showerror("Lỗi", f"Không thể đọc file Excel: {e}")

    # ============================================================
    # BATCH ACTIONS
    # ============================================================
    def _get_selected_ids(self):
        # 1. Nếu có hàng đang bôi đậm (selection) -> lấy theo selection
        sel = self.tree.selection()
        if sel:
            return [self.tree.item(s)["values"][2] for s in sel]
        
        # 2. Nếu không bôi đậm -> lấy tất cả những hàng đang hiện ☑
        ids = []
        for item_id in self.tree.get_children():
            vals = self.tree.item(item_id, "values")
            if vals[0] == "☑":
                ids.append(vals[2])
        return ids

    def _toggle_all(self, state):
        mark = "☑" if state else "☐"
        for item_id in self.tree.get_children():
            vals = list(self.tree.item(item_id, "values"))
            vals[0] = mark
            self.tree.item(item_id, values=vals)

    def _on_tree_click(self, event):
        region = self.tree.identify("region", event.x, event.y)
        if region == "heading": return
        
        item_id = self.tree.identify_row(event.y)
        column = self.tree.identify_column(event.x)
        
        if item_id and column == "#1": # Column check
            vals = list(self.tree.item(item_id, "values"))
            vals[0] = "☑" if vals[0] == "☐" else "☐"
            self.tree.item(item_id, values=vals)
            return "break" # Prevent selection change if clicking checkbox

    def _get_delay(self):
        try: return max(1, int(float(self.delay_entry.get().strip()))) * 1000
        except: return 5000

    def _get_limit(self):
        try: return max(0, int(self.limit_entry.get().strip()))
        except: return 0

    def _batch_friend(self):
        if not self.logged_in:
            messagebox.showwarning("!", "Đăng nhập trước!")
            return
        ids = self._get_selected_ids()
        if not ids:
            messagebox.showinfo("!", "Không có thành viên nào!")
            return
        
        limit = self._get_limit()
        actual_ids = ids[:limit] if limit > 0 else ids
        
        if not messagebox.askyesno("Xác nhận",
                f"Gửi lời kết bạn đến {len(actual_ids)} người?\n"
                f"Delay: {self.delay_entry.get()}s/người"):
            return

        msg = self.friend_msg.get().strip()
        delay = self._get_delay()
        self.batch_running = True
        self._log(f"👋 Bắt đầu kết bạn {len(actual_ids)} người (delay {delay}ms)...")
        self.action_progress.config(text=f"Kết bạn: 0/{len(actual_ids)}...")

        self._save_last_session()
        def cb(d, e):
            self.root.after(0, self._batch_done, "Kết bạn", d, e)
        
        params = {
            "userIds": ids, "message": msg, "delayMs": delay, "limit": limit
        }
        # Thêm sourceGroupId nếu có
        if self.scan_result and self.scan_result.get("groupInfo"):
            params["sourceGroupId"] = self.scan_result["groupInfo"].get("groupId")

        self.bridge.send("batch_friend_req", params, cb)

    def _batch_invite(self):
        if not self.logged_in:
            messagebox.showwarning("!", "Đăng nhập trước!")
            return
        gid = self.group_id_entry.get().strip()
        if not gid:
            messagebox.showwarning("!", "Nhập Group ID của nhóm cần mời vào!")
            return
        ids = self._get_selected_ids()
        if not ids:
            messagebox.showinfo("!", "Không có thành viên nào!")
            return

        limit = self._get_limit()
        actual_ids = ids[:limit] if limit > 0 else ids

        if not messagebox.askyesno("Xác nhận",
                f"Mời {len(actual_ids)} người vào nhóm {gid}?\n"
                f"Delay: {self.delay_entry.get()}s/người"):
            return

        delay = self._get_delay()
        self.batch_running = True
        self._log(f"📨 Mời {len(actual_ids)} người vào nhóm {gid}...")
        self.action_progress.config(text=f"Mời: 0/{len(actual_ids)}...")
        self._save_last_session()

        def cb(d, e):
            self.root.after(0, self._batch_done, "Mời nhóm", d, e)
        self.bridge.send("invite_to_group", {
            "groupId": gid, "userIds": ids, "delayMs": delay, "limit": limit
        }, cb)

    def _batch_done(self, action, data, err):
        self.batch_running = False
        if err:
            self._log(f"❌ {action} lỗi: {err}", "error")
            self.action_progress.config(text=f"❌ {err}")
            return
        if data:
            if data.get("cancelled"):
                self._log(f"⛔ {action} đã bị dừng bởi người dùng.", "warn")
                self.action_progress.config(text=f"⛔ Đã dừng.")
                return
            s, f, t = data.get("successCount",0), data.get("failCount",0), data.get("total",0)
            self._log(f"✅ {action} xong: {s}/{t} thành công, {f} thất bại", "ok")
            self.action_progress.config(text=f"✅ {s}/{t} thành công · {f} thất bại")

    # ---- CLEANUP ----
    def _pick_image(self):
        fp = filedialog.askopenfilename(
            title="Chọn ảnh quảng cáo",
            filetypes=[("Image files", "*.jpg *.jpeg *.png *.webp"), ("All files", "*.*")]
        )
        if fp:
            self.image_path.set(fp)

    def _batch_message(self):
        if not self.logged_in:
            messagebox.showwarning("!", "Đăng nhập trước!")
            return
        ids = self._get_selected_ids()
        if not ids:
            messagebox.showinfo("!", "Không có thành viên nào!")
            return
        
        limit = self._get_limit()
        actual_ids = ids[:limit] if limit > 0 else ids
        img = self.image_path.get()
        msg = self.friend_msg.get().strip()
        
        if not messagebox.askyesno("Xác nhận",
                f"Gửi tin nhắn + ảnh cho {len(actual_ids)} người?\n"
                f"Delay: {self.delay_entry.get()}s/người"):
            return

        delay = self._get_delay()
        self.batch_running = True
        self._log(f"💬 Bắt đầu gửi tin nhắn {len(actual_ids)} người...")
        self.action_progress.config(text=f"Tin nhắn: 0/{len(actual_ids)}...")
        self._save_last_session()

        def cb(d, e):
            self.root.after(0, self._batch_done, "Gửi tin nhắn", d, e)
        
        self.bridge.send("batch_send_msg", {
            "userIds": ids, 
            "message": msg, 
            "imagePath": img,
            "delayMs": delay, 
            "limit": limit
        }, cb)

    def on_close(self):
        if self.bridge: self.bridge.stop()
        self.root.destroy()


# ============================================================
if __name__ == "__main__":
    root = tk.Tk()
    app = App(root)
    root.protocol("WM_DELETE_WINDOW", app.on_close)
    root.mainloop()
