# -*- coding: utf-8 -*-
"""把原版的 Qt 翻译源文件（.ts，纯文本 XML）整理成**按界面文件分组**的对照表。

为什么用它而不是源码：源码里 `self.tr(...)` 写的是**英文**，
用户实际看到的中文在 `bili23.zh_CN.ts` 里（904 条，每条都带 `filename` + `line`，
能反查回源码 —— 正好能用来核对"展示方式一致"）。

.ts 结构：
    <context><name>ParseInterface</name>
      <message>
        <location filename="../../gui/interface/parse.py" line="357"/>
        <source>Link / av / BV / ep / ss / md / Favorites / Profile</source>
        <translation>链接 / av / BV / ep / ss / md / 收藏夹 / 个人空间</translation>
      </message>

⚠️ 关键：`<translation type="vanished">` 表示**这条文案已从代码里移除**（Qt 的 .ts 会保留历史条目）。
   不标出来的话，会让人以为某个功能还在、照着去实现它。
   实测 2.15.0 里就有这种条目（例如 MCP 卡片那两条"允许下载操作"，代码里并没有这个开关）。

用法：<原版 venv 的 python> _ts_dump.py <.ts 路径> <输出 md 路径>
"""
import sys
import pathlib
from collections import OrderedDict
import xml.etree.ElementTree as ET


def main():
    ts_path = pathlib.Path(sys.argv[1])
    out_path = pathlib.Path(sys.argv[2])

    tree = ET.parse(ts_path)
    root = tree.getroot()

    by_file = OrderedDict()   # 源文件 → [(line, context, source, translation, status)]
    by_ctx = OrderedDict()
    total = 0
    untranslated = 0
    vanished = 0

    for ctx in root.findall("context"):
        ctx_name = (ctx.findtext("name") or "").strip()
        for msg in ctx.findall("message"):
            src = (msg.findtext("source") or "").strip()
            tr_el = msg.find("translation")
            tr = (tr_el.text or "").strip() if tr_el is not None else ""
            ttype = (tr_el.get("type") or "") if tr_el is not None else ""
            if ttype == "vanished":
                # 已从代码中移除 —— 不是现役功能，必须显式标出来
                status = "**已废弃**（源码中已移除）"
                vanished += 1
            elif ttype == "unfinished":
                status = "未完成翻译"
                untranslated += 1
            else:
                status = ""
            loc = msg.find("location")
            fname = line = ""
            if loc is not None:
                # ../../gui/interface/parse.py → gui/interface/parse.py
                fname = (loc.get("filename") or "").replace("../../", "").replace("\\", "/")
                line = loc.get("line") or ""
            by_file.setdefault(fname or "(无文件)", []).append((line, ctx_name, src, tr, status))
            by_ctx.setdefault(ctx_name or "(无上下文)", []).append((fname, line, src, tr, status))
            total += 1

    def esc(s):
        return s.replace("|", "\\|").replace("\n", "\\n")

    lines = [
        "# 原版界面文案对照表（按界面文件分组）",
        "",
        f"> 由 `_ts_dump.py` 解析 `src/res/i18n/bili23.zh_CN.ts` 得到，共 **{total}** 条。",
        ">",
        "> **为什么需要它**：原版源码里 `self.tr(...)` 写的是**英文**，",
        "> 用户实际看到的中文在这一列。做网页版时，界面文案以「中文译文」为准。",
        ">",
        "> `行号` 指向原版源码，可反查上下文。",
        ">",
        f"> ⚠️ **状态列标「已废弃」的共 {vanished} 条 —— 它们已从代码中移除，不要照着实现。**",
        "> （Qt 的 .ts 会保留历史条目，只看文案不查状态会以为功能还在。）",
        "",
        f"共 {len(by_file)} 个界面文件、{len(by_ctx)} 个上下文（类）、"
        f"其中已废弃 {vanished} 条 / 未完成翻译 {untranslated} 条。",
        "",
    ]

    for fname in sorted(by_file):
        rows = by_file[fname]
        lines.append(f"## {fname}")
        lines.append("")
        lines.append(f"共 {len(rows)} 条")
        lines.append("")
        lines.append("| 行 | 上下文 | 英文原文 | 中文译文 | 状态 |")
        lines.append("|-|-|-|-|-|")
        for line, ctx_name, src, tr, status in sorted(rows, key=lambda r: int(r[0] or 0)):
            lines.append(f"| {line} | {esc(ctx_name)} | {esc(src)} | {esc(tr)} | {status} |")
        lines.append("")

    out_path.write_text("\n".join(lines), encoding="utf-8")
    print(f"共 {total} 条，其中 已废弃(vanished) {vanished} 条 / 未完成翻译 {untranslated} 条")
    print(f"{len(by_file)} 个文件，已写入 {out_path}")


if __name__ == "__main__":
    main()
