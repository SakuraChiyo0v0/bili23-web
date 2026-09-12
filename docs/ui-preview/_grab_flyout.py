# -*- coding: utf-8 -*-
"""抓原版**收藏夹浮层**（FavoriteFlyoutWidget）的离屏渲染图，作为重做的基准。

沿用 _grab.py 的三条安全措施：offscreen、APPDATA 沙箱（复制真实配置再跑）、只读。
用法：<原版 venv 的 python> _grab_flyout.py <输出目录> [light|dark]
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

out_dir = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else ".").resolve()
THEME = (sys.argv[2] if len(sys.argv) > 2 else "light").lower()
out_dir.mkdir(parents=True, exist_ok=True)

sandbox = pathlib.Path(tempfile.gettempdir()) / "bili23-shot-flyout" / "appdata"
dest = sandbox / "Bili23 Downloader"
if not dest.exists():
    src = pathlib.Path(REAL_APPDATA) / "Bili23 Downloader"
    if src.exists():
        shutil.copytree(src, dest, ignore=shutil.ignore_patterns("locks", "*.db-wal", "*.db-shm", "logs"))
        print(f"[沙箱] 已复制真实配置 -> {dest}")
    else:
        print(f"[沙箱] 真实配置不存在，将使用全新配置 -> {dest}")
os.environ["APPDATA"] = str(sandbox)

os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")
os.environ["QT_ENABLE_HIGHDPI_SCALING"] = "0"

sys.path.insert(0, APP_SRC)
os.chdir(APP_SRC)

FONTS = [
    r"C:\Windows\Fonts\msyh.ttc",
    r"C:\Windows\Fonts\msyhbd.ttc",
    r"C:\Windows\Fonts\msyhl.ttc",
    r"C:\Windows\Fonts\segoeui.ttf",
    r"C:\Windows\Fonts\seguisb.ttf",
]

try:
    from PySide6.QtWidgets import QApplication
    from PySide6.QtGui import QFontDatabase
    from PySide6.QtCore import QSize
    import main as M

    app = M.Application([sys.argv[0]])
    for f in FONTS:
        if os.path.exists(f):
            QFontDatabase.addApplicationFont(f)

    app.setup_app()

    from qfluentwidgets import setTheme, Theme
    setTheme(Theme.DARK if THEME == "dark" else Theme.LIGHT)

    from gui.interface.main_window import MainWindow
    from gui.component.widget.flyout import FavoriteFlyoutWidget

    win = MainWindow()

    def settle(n=40, delay=0.0):
        for _ in range(n):
            app.processEvents()
            if delay:
                time.sleep(delay)

    settle(60)
    win.show()
    settle(60)

    fly = FavoriteFlyoutWidget(parent=win)
    # 原版按主窗口尺寸决定浮层大小：宽>=1250 -> 1130（三列），否则 830（两列）；高>=700 -> 655
    for size in [(1424, 900), (1100, 700)]:
        fly.adjust_list_widget_width(QSize(size[0], size[1]))
        fly.show()
        settle(40)
        fly.grab()
        settle(20)
        p = out_dir / f"FavoriteFlyout-{size[0]}x{size[1]}.png"
        fly.grab().save(str(p))
        print(f"[浮层] 空态 {fly.width()}x{fly.height()} -> {p.name} ({p.stat().st_size} B)")

    # 真拉一次数据（需要真实配置里保存的登录态；没有登录就是错误态，外框仍可作基准）
    print("[浮层] 开始拉取真实数据（收藏夹 / 订阅合集 / 追番）…")
    try:
        fly.init_flyout()
    except Exception as e:
        print(f"[浮层] init_flyout 失败：{type(e).__name__}: {e}")
    for i in range(60):
        app.processEvents()
        time.sleep(0.25)
    settle(60)

    fly.adjust_list_widget_width(QSize(1424, 900))
    fly.show()
    settle(40)
    fly.grab()
    settle(20)
    p = out_dir / "FavoriteFlyout-data.png"
    fly.grab().save(str(p))
    print(f"[浮层] 有数据 -> {p.name} ({p.stat().st_size} B)")

    # 切到「订阅合集」和「追番追剧」各抓一张
    for route, name in [("subscription", "FavoriteFlyout-subscription.png"), ("follow", "FavoriteFlyout-follow.png")]:
        try:
            fly.category_widget.setCurrentItem(route)
            fly.stack_widget.setCurrentIndex({"favorite": 0, "subscription": 1, "follow": 2}[route])
            fly.init_flyout()
            for _ in range(50):
                app.processEvents()
                time.sleep(0.25)
            settle(40)
            fly.grab()
            p = out_dir / name
            fly.grab().save(str(p))
            print(f"[浮层] {route} -> {name} ({p.stat().st_size} B)")
        except Exception as e:
            print(f"[浮层] {route} 失败：{type(e).__name__}: {e}")

    print("[完成]")
except Exception:
    traceback.print_exc()
    sys.exit(1)
