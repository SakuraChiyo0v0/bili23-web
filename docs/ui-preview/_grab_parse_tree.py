# -*- coding: utf-8 -*-
"""抓原版**解析页**在解析"容器型链接"（合集/空间/收藏夹）后的树结构与渲染。

为什么需要：`06-第1批` 的第 2 条是「多级树 + 二次解析」，而原版是**树**、我们是**平铺**。
要照原版做，就得先知道它真实的层级、哪些行可下载、勾选怎么联动 —— 靠读源码猜容易漏。

沿用 _grab.py / _grab_flyout.py 的安全措施：offscreen、APPDATA 沙箱（复制真实配置再跑）、只读。

用法：<原版 venv 的 python> _grab_parse_tree.py <输出目录> [链接]
输出：<输出目录>/parse-tree-*.png + <输出目录>/parse-tree.json（结构 dump，ASCII 走 stdout）
"""
import os
import sys
import json
import time
import shutil
import pathlib
import tempfile
import traceback

APP_SRC = r"C:\LocalSpace\Projects\Github-Proj\Bili23-Downloader\src"
REAL_APPDATA = os.environ.get("APPDATA", "")
# 公开合集：小约翰可汗「世纪风暴」16 个视频，行是"需二次解析"的视频行
DEFAULT_URL = "https://space.bilibili.com/23947287/lists/7022339?type=season"

out_dir = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else ".").resolve()
test_url = sys.argv[2] if len(sys.argv) > 2 else DEFAULT_URL
out_dir.mkdir(parents=True, exist_ok=True)

sandbox = pathlib.Path(tempfile.gettempdir()) / "bili23-shot-tree" / "appdata"
dest = sandbox / "Bili23 Downloader"
if not dest.exists():
    src = pathlib.Path(REAL_APPDATA) / "Bili23 Downloader"
    if src.exists():
        shutil.copytree(src, dest, ignore=shutil.ignore_patterns("locks", "*.db-wal", "*.db-shm", "logs"))
        print("[sandbox] copied real config")
    else:
        print("[sandbox] no real config, using fresh")
os.environ["APPDATA"] = str(sandbox)
os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")
os.environ["QT_ENABLE_HIGHDPI_SCALING"] = "0"

sys.path.insert(0, APP_SRC)
os.chdir(APP_SRC)

FONTS = [
    r"C:\Windows\Fonts\msyh.ttc", r"C:\Windows\Fonts\msyhbd.ttc",
    r"C:\Windows\Fonts\msyhl.ttc", r"C:\Windows\Fonts\segoeui.ttf",
]

# 属性位名字（照 tree.py 的 Attribute）
BITS = [
    (1 << 0, "VIDEO"), (1 << 1, "BANGUMI"), (1 << 2, "CHEESE"), (1 << 3, "WEEKLY"),
    (1 << 4, "COLLECTION_LIST"), (1 << 5, "SPACE"), (1 << 6, "FAVLIST"),
    (1 << 7, "NEED_PARSE"), (1 << 8, "NORMAL"), (1 << 9, "PART"), (1 << 10, "COLLECTION"),
    (1 << 11, "INTERACTIVE"), (1 << 12, "DOWNLOAD_AS_SINGLE"), (1 << 13, "WATCH_LATER"),
    (1 << 14, "HISTORY"), (1 << 15, "TREE_NODE"), (1 << 16, "AUDIO"),
    (1 << 17, "FAV_WITH_MULTI_PART"), (1 << 18, "LESSON"),
]

def bits_of(attr):
    return [name for bit, name in BITS if attr & bit]

try:
    from PySide6.QtWidgets import QApplication
    from PySide6.QtGui import QFontDatabase
    import main as M

    app = M.Application([sys.argv[0]])
    for f in FONTS:
        if os.path.exists(f):
            QFontDatabase.addApplicationFont(f)
    app.setup_app()

    from qfluentwidgets import setTheme, Theme
    setTheme(Theme.LIGHT)

    from gui.interface.main_window import MainWindow

    win = MainWindow()

    def settle(n=40, delay=0.0):
        for _ in range(n):
            app.processEvents()
            if delay:
                time.sleep(delay)

    settle(60)
    win.show()
    settle(60)

    win.navigationInterface.items["ParseInterface"].click()
    settle(40)

    pi = win.parse_interface
    pi.url_box.setText(test_url)
    print(f"[parse] start: {test_url}")
    pi.on_parse()
    for i in range(120):
        app.processEvents()
        time.sleep(0.25)
    settle(60)

    root = pi.parse_list._model.root_node

    def walk(node, depth=0):
        return {
            "depth": depth,
            "number": getattr(node, "number", ""),
            "title": getattr(node, "title", ""),
            "attribute": getattr(node, "attribute", 0),
            "bits": bits_of(getattr(node, "attribute", 0)),
            "checked": int(getattr(node.checked, "value", 0)),
            "children": [walk(c, depth + 1) for c in node.children],
        }

    tree = walk(root)
    dump = {"url": test_url, "tree": tree, "total_downloadable": pi.parse_list.get_total_items_count()}
    (out_dir / "parse-tree.json").write_text(json.dumps(dump, ensure_ascii=False, indent=2), encoding="utf-8")

    # 控制台只打 ASCII 概要，避免 GBK 乱码（详情看 json）
    def summarize(node, depth=0):
        attr = node["attribute"]
        flag = "LEAF" if not node["children"] else "node"
        print("  " * depth + f"- {flag} attr={attr} bits={','.join(node['bits']) or '-'} kids={len(node['children'])}")
        for c in node["children"][:6]:
            summarize(c, depth + 1)

    print("[tree] depth-first (see parse-tree.json for titles):")
    summarize(tree["tree"] if "tree" in tree else tree)
    print(f"[tree] downloadable total = {dump['total_downloadable']}")

    for size in [(950, 600), (1424, 900)]:
        win.resize(size[0], size[1])
        settle(30)
        p = out_dir / f"parse-tree-{size[0]}x{size[1]}.png"
        win.grab().save(str(p))
        print(f"[shot] {p.name} ({p.stat().st_size} B)")

    print("[done]")
except Exception:
    traceback.print_exc()
    sys.exit(1)
