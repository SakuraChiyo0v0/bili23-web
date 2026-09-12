# -*- coding: utf-8 -*-
"""用**原版程序自己的代码**离屏渲染截图，作为「1:1 复刻」的基准图。

为什么这么做：靠人手动一张张截图不现实，而且基准要覆盖
「同一页面的不同窗口尺寸 / 不同状态（空表 / 已解析 / 已勾选）」——
只有把程序真跑起来才能拿到。

三条安全措施：
  1. QT_QPA_PLATFORM=offscreen —— 不弹任何窗口，不会打扰你；
  2. APPDATA 指向临时沙箱，先把真实配置**复制**过去再跑，全程不写真实配置与任务库；
  3. 只做只读操作（解析），不下载、不删改任何东西。

坑（已踩）：offscreen 平台下 Qt 读不到系统字体，中文会渲染成方框。
     必须手工 addApplicationFont 把微软雅黑喂进去。

用法：<原版 venv 的 python> _grab.py <输出目录> [要解析的链接]
"""
import os
import sys
import time
import shutil
import pathlib
import tempfile
import traceback

APP_SRC = r"C:\LocalSpace\Projects\Github-Proj\Bili23-Downloader\src"
REAL_APPDATA = os.environ.get("APPDATA", "")
DEFAULT_URL = "https://www.bilibili.com/video/BV1Z34y1r7ZV"

out_dir = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else ".").resolve()
test_url = sys.argv[2] if len(sys.argv) > 2 else DEFAULT_URL
# 第三个参数：主题。原版默认跟随系统，浅色/深色两套都要有基准。
THEME = (sys.argv[3] if len(sys.argv) > 3 else "light").lower()
out_dir.mkdir(parents=True, exist_ok=True)

# ---- 1. 沙箱化 APPDATA（必须在导入 app 的 config 之前）----
sandbox = pathlib.Path(tempfile.gettempdir()) / "bili23-shot" / "appdata"
dest = sandbox / "Bili23 Downloader"
if not dest.exists():
    src = pathlib.Path(REAL_APPDATA) / "Bili23 Downloader"
    if src.exists():
        shutil.copytree(
            src, dest,
            # 锁文件要丢掉（否则会被判定为「已在运行」）；
            # WAL/SHM 是 SQLite 临时文件，复制过来反而可能损坏，交给程序自己重建
            ignore=shutil.ignore_patterns("locks", "*.db-wal", "*.db-shm", "logs"),
        )
        print(f"[沙箱] 已复制真实配置 -> {dest}")
    else:
        print(f"[沙箱] 真实配置不存在，将使用全新配置 -> {dest}")
os.environ["APPDATA"] = str(sandbox)

# ---- 2. 离屏，不弹窗 ----
os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")
os.environ["QT_ENABLE_HIGHDPI_SCALING"] = "0"

sys.path.insert(0, APP_SRC)
os.chdir(APP_SRC)

FONTS = [
    r"C:\Windows\Fonts\msyh.ttc",      # 微软雅黑
    r"C:\Windows\Fonts\msyhbd.ttc",    # 微软雅黑 Bold
    r"C:\Windows\Fonts\msyhl.ttc",     # 微软雅黑 Light
    r"C:\Windows\Fonts\segoeui.ttf",   # Segoe UI
    r"C:\Windows\Fonts\seguisb.ttf",
]

try:
    from PySide6.QtWidgets import QApplication
    from PySide6.QtGui import QFontDatabase
    import main as M

    app = M.Application([sys.argv[0]])

    # 喂字体（offscreen 下 Qt 读不到系统字体库）
    for f in FONTS:
        if os.path.exists(f):
            fid = QFontDatabase.addApplicationFont(f)
            fams = QFontDatabase.applicationFontFamilies(fid) if fid != -1 else []
            print(f"[字体] {os.path.basename(f)} -> id={fid} 族={list(fams)}")
        else:
            print(f"[字体] 缺失 {f}")

    app.setup_app()

    # 切主题：要在建窗口之前，控件才会按对应主题构建
    from qfluentwidgets import setTheme, Theme
    setTheme(Theme.DARK if THEME == "dark" else Theme.LIGHT)
    print(f"[主题] 已设为 {THEME}")

    from gui.interface.main_window import MainWindow

    win = MainWindow()

    def settle(n=40, delay=0.0):
        for _ in range(n):
            app.processEvents()
            if delay:
                time.sleep(delay)

    def switch(route):
        """切到某个页面，并**回报是否真的切过去了**。
        之前这里踩过坑：只调 setCurrentItem 不校验，结果截出来的
        下载页/设置页其实是解析页 —— 四张图大小几乎一样，属于假成功。"""
        # 先看看这个 routeKey 到底存不存在（不存在时 setCurrentItem 会静默返回）
        keys = list(win.navigationInterface.items.keys())
        if route not in keys:
            print(f"[切页] routeKey '{route}' 不在导航里；可用：{keys}")
            return False
        try:
            win.navigationInterface.setCurrentItem(route)
        except Exception as e:
            print(f"[切页] setCurrentItem({route}) 抛错：{e}")
        settle(40)
        if win.stackedWidget.currentWidget().objectName() != route:
            # 真正的切页靠导航按钮的 clicked 信号触发 —— setCurrentItem 只更新选中态。
            # 注意 items[route] 本身就是 NavigationBarPushButton，没有 .widget。
            try:
                win.navigationInterface.items[route].click()
            except Exception as e:
                print(f"[切页] 点击兜底也失败：{e}")
            settle(60)
        cur = win.stackedWidget.currentWidget()
        name = cur.objectName() if cur is not None else "<None>"
        ok = (name == route)
        print(f"[切页] 请求={route} 实际={name} {'OK' if ok else '!! 没切过去'}")
        return ok

    def shot(name, w, h):
        win.resize(w, h)
        settle(30)
        path = out_dir / f"{name}-{w}x{h}.png"
        win.grab().save(str(path))
        print(f"[截图] {path.name}  ({path.stat().st_size} B)")

    settle(60)
    win.show()
    settle(60)
    print(f"[导航] 全部 routeKey：{list(win.navigationInterface.items.keys())}")

    # ---------- 解析页：空状态 ----------
    switch("ParseInterface")
    shot("parse-empty", 950, 600)

    # ---------- 解析页：真解析一次，拿到有内容的树 ----------
    try:
        pi = win.parse_interface
        pi.url_box.setText(test_url)
        print(f"[解析] 开始：{test_url}")
        pi.on_parse()
        # 解析在子线程里跑，这里靠 processEvents + sleep 等它回来
        for i in range(120):
            app.processEvents()
            time.sleep(0.25)
            if i == 40:
                print("[解析] 仍在等待…")
        settle(40)
        print(f"[解析] 列表项数：{pi.parse_list.get_total_items_count()}")
        for size in [(950, 600), (1200, 700), (1424, 900)]:
            shot("parse", size[0], size[1])
    except Exception:
        print("[解析] 失败：")
        traceback.print_exc()
        shot("parse", 950, 600)

    # ---------- 下载页 ----------
    switch("DownloadInterface")
    shot("download", 950, 600)
    shot("download", 1424, 900)

    # ---------- 设置页 ----------
    switch("SettingInterface")
    shot("setting", 950, 600)
    shot("setting", 1424, 900)

    # ---------- 弹窗 ----------
    # 大部分弹窗的构造签名是 (parent=None)，可以只构造不 exec()：
    # exec() 会阻塞在事件循环里，而我们要的只是它的渲染结果。
    import importlib

    DIALOGS = [
        ("DownloadOptionsDialog", "gui.dialog.download_options.dialog", ()),
        ("LoginDialog",           "gui.dialog.login",                     ()),
        ("CookieLoginDialog",     "gui.dialog.login",                     ()),
        ("AboutDialog",           "gui.dialog.main_window.about",         ()),
        ("ExitDialog",            "gui.dialog.main_window.exit",          ()),
        ("TermsOfUseDialog",      "gui.dialog.main_window.terms",         ()),
        ("BatchParseDialog",      "gui.dialog.misc.batch_parse",          ()),
        ("BatchSelectDialog",     "gui.dialog.misc.batch_select",         ()),
        ("JumpToPageDialog",      "gui.dialog.misc.jump_to_page",         ()),
        ("ParseHistoryDialog",    "gui.dialog.misc.parse_history",        ()),
        ("SearchDialog",          "gui.dialog.misc.search",               ()),
        ("LogViewerDialog",       "gui.dialog.log",                       ()),
        ("AutoSelectDialog",      "gui.dialog.setting.auto_select",       ()),
        ("CDNServerDialog",       "gui.dialog.setting.cdn_server",        ()),
        ("DanmakuStyleDialog",    "gui.dialog.setting.danmaku_style",     ()),
        ("MonitorClipboardDialog","gui.dialog.setting.monitor_clipboard",  ()),
        ("ParseListSettingsDialog","gui.dialog.setting.parse_list",       ()),
        ("ProxyDialog",           "gui.dialog.setting.proxy",             ()),
        ("RuleListDialog",        "gui.dialog.setting.rule_list",         ()),
        ("SelectAreaDialog",      "gui.dialog.setting.select_area",       ()),
        ("SpeedLimitSettingDialog","gui.dialog.setting.speed_limit",      ()),
        ("SubtitlesLanguageDialog","gui.dialog.setting.subtitles_language",()),
        ("SubtitlesStyleDialog",  "gui.dialog.setting.subtitles_style",   ()),
        ("UserAgentDialog",       "gui.dialog.setting.user_agent",        ()),
    ]

    dlg_dir = out_dir / "dialogs"
    dlg_dir.mkdir(exist_ok=True)
    # 需要构造数据的弹窗。键名是从各自源码里抠出来的：
    #   UpdateDialog: version/content/required/update_url
    #   MultiPartListsDialog: title/duration/url/attribute/data
    #   DuplicateDownloadDialog: title 等
    # 形状拿不准的（EditRuleDialog 的 rule_data、PriorityDialog 的 map_data）
    # 先给空值 —— 至少能把外框、标题栏、按钮布局录下来。
    #
    # ViewCoverDialog 用 NetworkRequestWorker 走 HTTP 取图，file:// 不行。
    # 不依赖外网：在本机起一个只读的静态服务，把基准图当封面喂给它。
    import http.server
    import threading
    import functools

    handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(out_dir))
    httpd = http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler)
    port = httpd.server_address[1]
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    cover_uri = f"http://127.0.0.1:{port}/parse-950x600.png"
    print(f"[弹窗] 本地静态服务 127.0.0.1:{port}，封面地址 {cover_uri}")
    DIALOGS_DATA = [
        ("UpdateDialog",           "gui.dialog.update",                     ({"version": "9.9.9", "content": "<p>更新内容示例</p>", "required": False, "update_url": "https://example.com"},)),
        ("AutoParseDialog",        "gui.dialog.misc.auto_parse",            ("https://www.bilibili.com/video/BV1Z34y1r7ZV", 12, 3)),
        ("DuplicateDownloadDialog","gui.dialog.misc.duplicate_download",    ({"title": "01【宁姆格福】"}, {"title": "01【宁姆格福】"})),
        ("InteractiveVideoDialog", "gui.dialog.misc.interactive_video",     ({},)),
        ("MultiPartListsDialog",   "gui.dialog.misc.multi_part_lists",      ({"title": "合集 / 分P 列表", "duration": 1234, "url": "", "attribute": 0, "data": []},)),
        ("ViewCoverDialog",        "gui.dialog.misc.view_cover",            (cover_uri,)),
        ("EditHostDialog",         "gui.dialog.setting.edit_host",          ("upos-sz-mirrorcos.bilivideo.com",)),
        ("EditRuleDialog",         "gui.dialog.setting.edit_rule",          ({},)),
        ("PriorityDialog",         "gui.dialog.setting.priority",           ({}, [])),
        ("StartingNumberDialog",   "gui.dialog.setting.starting_number",    ("起始编号", 1)),
    ]

    ok = 0
    for cls_name, mod_name, args in list(DIALOGS) + list(DIALOGS_DATA):
        try:
            mod = importlib.import_module(mod_name)
            cls = getattr(mod, cls_name)
            # ⚠️ 必须用关键字传 parent：有些弹窗的第一个参数不是 parent
            #    （如 SearchDialog(server_search_available, ...)），
            #    位置传参会把主窗口当成布尔值，报 'NoneType' has no attribute 'width'。
            d = cls(*args, parent=win)
            d.show()          # offscreen 下不会真的弹出来
            for _ in range(30):
                app.processEvents()
            # 关键：**先试抓一次**。grab() 会强制走一次布局/绘制，
            # 弹窗这时才拿到自己的真实尺寸；光跑 processEvents 是拿不到的
            # （实测跑 80 轮仍报 1424x900，即主窗口尺寸）。
            d.grab()
            for _ in range(20):
                app.processEvents()
            # 试抓之后若尺寸还是跟主窗口一样大，才说明确实没布局，这时 adjustSize 是安全的。
            # 注意不能无条件 adjustSize：带滚动区的弹窗（如 DownloadOptionsDialog）
            # 被 adjustSize 会把滚动内容压塌，画质/音质两行直接消失。
            if d.width() >= win.width() or d.height() >= win.height():
                d.adjustSize()
                for _ in range(40):
                    app.processEvents()
            # 有些弹窗要等异步结果（ViewCoverDialog 要等封面下载完）
            if cls_name == "ViewCoverDialog":
                for _ in range(60):
                    app.processEvents()
                    time.sleep(0.05)
            p = dlg_dir / f"{cls_name}.png"
            d.grab().save(str(p))
            print(f"[弹窗] {cls_name:<24} {d.width()}x{d.height()}  {p.stat().st_size} B")
            ok += 1
            d.close()
            d.deleteLater()
            for _ in range(5):
                app.processEvents()
        except Exception as e:
            print(f"[弹窗] {cls_name:<24} 失败：{type(e).__name__}: {e}")
    print(f"[弹窗] 成功 {ok}/{len(DIALOGS) + len(DIALOGS_DATA)}，输出目录 {dlg_dir}")

    print("[完成] 全部截图已生成")

except Exception:
    traceback.print_exc()
    sys.exit(1)
