# -*- coding: utf-8 -*-
"""离屏跑原版程序，**遍历控件树**把界面文案全捞出来。

为什么要这么做：原版源码里 `self.tr(...)` 写的是**英文**，用户实际看到的中文
在编译好的 `bili23.zh_CN.qm` 里，而 PySide6 只带 lrelease/lupdate、**不带 lconvert**
（.qm→.ts 的工具），QTranslator 也不能枚举条目。

于是换个思路：**直接问正在运行的程序它显示什么** —— 把 QApplication 里所有控件的
文案类属性（标题、按钮、标签、占位符、下拉项、菜单项、表头、tooltip）全读出来。
这比解二进制格式可靠，拿到的就是用户真正看到的东西。

用法：<原版 venv 的 python> _dumpstrings.py <输出目录>
"""
import os
import sys
import shutil
import pathlib
import tempfile
import traceback
from collections import OrderedDict

def _ref_dir() -> pathlib.Path:
    """原版仓库根目录：第二个参数 > 环境变量 BILI23_REF_DIR > 仓库同级的 Bili23-Downloader。

    刻意**不写死本机绝对路径** —— 这些脚本会跨机用（本机用户名与目录布局和别的机器不一样）。
    """
    if len(sys.argv) > 2:
        return pathlib.Path(sys.argv[2]).resolve()
    env = os.environ.get("BILI23_REF_DIR")
    if env:
        return pathlib.Path(env).resolve()
    # __file__ = <repo>/docs/parity/_dumpstrings.py → parents[3] 是仓库根
    return (pathlib.Path(__file__).resolve().parents[3] / "Bili23-Downloader").resolve()

APP_SRC = _ref_dir() / "src"
if not APP_SRC.is_dir():
    sys.exit(f"找不到原版仓库：{APP_SRC}\n"
             f"请用第二个参数或环境变量 BILI23_REF_DIR 指定 Bili23-Downloader 的根目录")

REAL_APPDATA = os.environ.get("APPDATA", "")
DEFAULT_URL = "https://www.bilibili.com/video/BV1Z34y1r7ZV"

out_dir = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else ".").resolve()
out_dir.mkdir(parents=True, exist_ok=True)

# 沙箱化 APPDATA（与 _grab.py 同样的安全措施：复制真实配置过去，不写真实数据）
sandbox = pathlib.Path(tempfile.gettempdir()) / "bili23-shot" / "appdata"
dest = sandbox / "Bili23 Downloader"
if not dest.exists():
    src = pathlib.Path(REAL_APPDATA) / "Bili23 Downloader"
    if src.exists():
        shutil.copytree(src, dest,
                        ignore=shutil.ignore_patterns("locks", "*.db-wal", "*.db-shm", "logs"))
os.environ["APPDATA"] = str(sandbox)
os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")
os.environ["QT_ENABLE_HIGHDPI_SCALING"] = "0"
sys.path.insert(0, APP_SRC)
os.chdir(APP_SRC)

FONTS = [str(pathlib.Path(os.environ.get("WINDIR", r"C:\Windows")) / "Fonts" / "msyh.ttc"),
         str(pathlib.Path(os.environ.get("WINDIR", r"C:\Windows")) / "Fonts" / "segoeui.ttf")]


def top_level_name(w):
    """往上找顶层窗口，用来给文案分组。"""
    p = w
    while p is not None:
        if p.parent() is None:
            try:
                t = p.windowTitle()
            except Exception:
                t = ""
            return t or type(p).__name__
        p = p.parent()
    return "?"


def collect(app):
    from PySide6.QtWidgets import (QWidget, QLabel, QAbstractButton, QLineEdit,
                                   QComboBox, QGroupBox, QTabWidget, QTableView)
    from PySide6.QtGui import QAction

    groups = OrderedDict()

    def add(group, kind, text):
        text = (text or "").strip()
        if not text:
            return
        groups.setdefault(group, OrderedDict()).setdefault(kind, [])
        if text not in groups[group][kind]:
            groups[group][kind].append(text)

    # 顶层窗口标题
    for w in app.topLevelWidgets():
        try:
            add(type(w).__name__, "窗口标题", w.windowTitle())
        except Exception:
            pass

    for w in app.allWidgets():
        g = type(w).__name__
        try:
            if w.windowTitle():
                add(g, "窗口标题", w.windowTitle())
        except Exception:
            pass
        try:
            if isinstance(w, QLabel):
                add(g, "标签", w.text())
            elif isinstance(w, QGroupBox):
                add(g, "分组标题", w.title())
            elif isinstance(w, QAbstractButton):
                add(g, "按钮", w.text())
            elif isinstance(w, QLineEdit):
                add(g, "输入框占位符", w.placeholderText())
                add(g, "输入框内容", w.text())
            elif isinstance(w, QComboBox):
                for i in range(w.count()):
                    add(g, "下拉项", w.itemText(i))
            elif isinstance(w, QTabWidget):
                for i in range(w.count()):
                    add(g, "页签", w.tabText(i))
            elif isinstance(w, QTableView):
                m = w.model()
                if m is not None:
                    for c in range(m.columnCount()):
                        add(g, "表头", str(m.headerData(c, 1, 0) or ""))
        except Exception:
            pass
        try:
            if w.toolTip():
                add(g, "tooltip", w.toolTip())
        except Exception:
            pass

    # 菜单/工具栏动作
    for w in app.allWidgets():
        try:
            for a in w.findChildren(QAction):
                add(type(w).__name__ + " 的动作", "菜单项", a.text())
        except Exception:
            pass
    return groups


def main():
    try:
        from PySide6.QtWidgets import QApplication
        from PySide6.QtGui import QFontDatabase
        import main as M

        app = M.Application([sys.argv[0]])
        for f in FONTS:
            if os.path.exists(f):
                QFontDatabase.addApplicationFont(f)
        app.setup_app()

        from gui.interface.main_window import MainWindow
        win = MainWindow()
        for _ in range(60):
            app.processEvents()
        win.show()
        for _ in range(60):
            app.processEvents()

        # 切三个页面各跑一遍，让懒加载的控件都建出来
        for route in ("ParseInterface", "DownloadInterface", "SettingInterface"):
            try:
                win.navigationInterface.items[route].click()
            except Exception:
                pass
            for _ in range(60):
                app.processEvents()

        # 解析一次，让树/工具条上的文案出现
        try:
            pi = win.parse_interface
            pi.url_box.setText(DEFAULT_URL)
            pi.on_parse()
            import time
            for _ in range(80):
                app.processEvents()
                time.sleep(0.2)
        except Exception:
            pass
        for _ in range(40):
            app.processEvents()

        groups = collect(app)

        lines = ["# 原版界面文案（从运行中的程序里直接读出）", "",
                 "> 由 `_dumpstrings.py` 离屏运行原版程序后遍历控件树得到。",
                 "> 源码里是英文，这里读到的**就是用户实际看到的中文**。",
                 "> 每组按控件类型归类。", ""]
        total = 0
        for g, kinds in groups.items():
            lines.append(f"## {g}")
            lines.append("")
            for kind, items in kinds.items():
                lines.append(f"**{kind}**（{len(items)}）")
                lines.append("")
                for it in items:
                    total += 1
                    lines.append(f"- {it}")
                lines.append("")
        out = out_dir / "原版界面文案-运行时读出.md"
        out.write_text("\n".join(lines), encoding="utf-8")
        print(f"[完成] 共 {total} 条文案，{len(groups)} 个控件类 → {out}")
    except Exception:
        traceback.print_exc()
        sys.exit(1)


if __name__ == "__main__":
    main()
