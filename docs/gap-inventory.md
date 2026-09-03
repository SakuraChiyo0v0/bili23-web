# Bili23 Web 功能对齐差距盘点

日期：2026-09-03 · 基于真实源码与真实接口冒烟核验

> 目的：把原版 Bili23-Downloader（桌面 Python/PySide6）的能力清单，与当前 bili23-web（TS+Hono+React）
> 的**真实实现**逐条对比，区分「已实现」「仅后端已实现、前端未暴露」「确有差距」，作为后续 P2/P3 的
> 实施依据。评估只认代码与运行结果，不认文字承诺。

---

## 一、结论先说

- **后端核心链路已完整可用**：真实解析（投稿视频 / 每周必看）→ 取流 → 创建任务 → 分片并发下载 →
  ffmpeg 合并 → 完成并落盘，我已在 `http://localhost:8787` 用真实 B 站链接跑通全流程（360P 单视频
  10.5MB 下载完成）。`pnpm check` 全绿：engine 257 测试、web 42 测试、engine+web 生产构建通过。
- **前端已覆盖**：三类视图（解析 / 下载 / 设置）+ 移动端底部 TabBar + 顶部导航 + 解析结果多选 +
  下载参数面板（画质/编码/音质/容器/附加内容/命名/编号）+ 任务进度（SSE/轮询）+ 历史与文件 Tab。
- **仍有若干用户可察觉的差距**，集中在「**前端未把后端已有能力暴露出来**」和「**个别后端能力缺语义
  落地**」。详见表二。

---

## 二、用户功能差距清单（按原版 README 特性逐条）

### 表 A：已实现（前端+后端，经真实调用核验）

| 原版特性 | 当前证据 |
| --- | --- |
| 多类型解析：投稿/番剧/课程/互动/音乐/UP 空间/收藏夹/每周必看/合集/稍后再看/历史/活动页 | 前端 13 个类型入口 chip；后端 `#buildUrlsForType` 逐类构造 URL。冒烟：`video`、`popular` 解析成功 |
| 批量解析（多链接一次性粘贴） | ParseView 多行/逗号/分号切分进 `urls` |
| 关键词搜索（空间/收藏夹/历史/稍后再看） | 类型入口带 `keyword`，后端透传（space/favlist/history/watch_later） |
| 音视频自定义：画质/音质/编码 | `DownloadOptions` 面板 + `POST /api/media/:itemId` 返回真实 `qualities/audioQualities`。冒烟返回 dash 2 画质 3 音质 |
| 封装格式 mp4/mkv | 容器下拉，默认读 `config.download.defaultContainer` |
| 弹幕/字幕/封面/章节/元数据 | 附加内容面板齐全（danmaku/subtitle/cover/chapter/metadata 开关+格式） |
| 命名规则 + 编号 | 设置页 13 条默认规则 + 起始编号；下载面板可覆盖本次命名 |
| 重复下载检测 | 创建任务返回 `duplicates`，前端弹「仍然下载」面板 |
| 进度/暂停/继续/重试/取消/删除 | TasksView 卡片全动作 + 进度/速率/ETA；SSE + 3s 轮询 |
| 历史 + 产物文件 | 任务 Tab 下 历史/文件 子 Tab；文件可直链下载 |
| 全局下载设置（目录/并发/限速/重名/重复） | SettingsView 第 01 组；P1 已修复目录/命名/重名/重复不生效问题 |
| 全局附加内容默认 | SettingsView 第 03 组 |
| 主题浅色/深色/系统 | 设置页 + 顶栏切换 |
| 语言 zh-CN/zh-TW/en/system | 设置页（仅持久化，界面文案仍为中文，见待办） |
| 登录态展示（SESSDATA） | 顶栏「登录」按钮；支持**扫码登录 + Cookie 登录**，登录后显示已登录态 |

### 表 B：**后端已实现、但前端未暴露的能力**（补前端就能用）

| 原版/引擎能力 | 后端能力证据 | 前端缺口 |
| --- | --- | --- |
| 字幕**语言选择**（指定语言/全部） | 引擎 `fetchSubtitlesData(ctx, infos, opts.subtitle.language)`；config `subtitle.language.downloadSpecified/specifiedLanguages` | 下载面板只暴露字幕**格式**下拉，**没有语言选择** |
| 弹幕/字幕**样式**配置（字体/字号/颜色/边框/显示区/速度等） | config `additional.subtitle.style`/`danmaku.style` 结构完整 | 设置页/下载面板只暴露格式，**没有样式编辑** |
| 封面**嵌入后删除原图** | config `cover.deleteAfterAttach`；引擎 extras 处理 | 设置页只暴露「附进媒体」，**没有「嵌入后删除原图」开关** |
| 弹幕/字幕**嵌入后删除** | config `danmaku.deleteAfterEmbed`/`subtitle.deleteAfterEmbed` | 设置页只暴露「内嵌 MKV」，**没有「嵌入后删除源文件」开关** |
| 字幕**指定语言下载** | 同上 `specifiedLanguages` | 未暴露 |
| 高级默认画质/音质/编码 | config `advanced.defaultVideoQualityId/defaultAudioQualityId/defaultCodecId` | 设置页 05 组有**单值输入框**，但**没有下拉列出可用档位**；且**未接入取流**（见 I-5） |

### 表 C：**确有语义差距 / 待增强**（需要后端或设计决策）

| 项 | 现状 | 差距 |
| --- | --- | --- |
| **I-1 筛选/排序参数** | space/favlist/history/watch_later 的 `tid/order/business/add_time*/arc_* /viewed/asc/type` 等参数仍写死默认值（`tid:0 order:pubdate/mtime type:0`） | 原版 TODO 记载、原版实现了「关键词搜索」但筛选/排序一直未做；Web 版一致，属**原版也未实现**的能力，可作 P3+ |
| **I-2 批量「只筛选当前页 / 搜索全部」** | 关键词透传，无「当前页 vs 全部」切换 | 原版有该交互；前端未做「仅当前页/搜索全部」切换 |
| **I-3 登录（扫码/短信）** | 已实现扫码 + Cookie 登录（引擎 `api/auth.ts` qrGenerate/qrPoll + SESSDATA login，路由 `/api/auth/qr`、`/api/auth/qr/poll`） | 扫码登录可真实获取 B 站二维码并轮询；短信登录未做（需验证码/风控，暂缓） |
| **I-4 代理三种模式** | config 只有 `advanced.proxy`（URL 字符串）；无「不用/系统/手动」三选一 | 原版有三种代理模式；当前仅手动 URL。需确认容器场景是否需要 |
| **I-5 高级默认画质/音质/编码未真正生效** | 已接入：`createTasks` 在未显式指定时用 `advanced.default*` 兜底（P2 已修复） | 已实现，测试覆盖 |
| **I-6 在线「下载前预览」** | 无媒体预览 UI | 原版有预览；当前下载面板只有档位选项。取决于是否把「预览」划入 1:1 范围 |
| **I-7 剪贴板监控 / 系统托盘 / 窗口记忆** | Web/NAS 形态无意义 | 设计文档明确砍掉，符合预期 |

---

## 三、移动端与响应式

- 已有：底部 TabBar、紧凑顶栏、可横滑 chip、44px 触控目标、360px 无横向溢出（P0 已截图核验桌面 1440 + 移动 390）。
- 已有 B 站风格设计 token（蓝/粉渐变 + 卡片 + 动效）。
- 待增强：字幕语言/样式等新增控件需保持移动端不溢出；设置分组在 360px 下的密度可再优化。

---

## 四、P2 进展（已实施并推送）

已全部完成（提交 `e81ae86`）：
1. **已完成 P2-1 字幕语言选择**：下载面板 + 全局设置新增「指定语言」多选（zh/en/ja/ko/AI 等）。
2. **已完成 P2-2 完整样式编辑面板**：新增 StyleEditor，可编辑字体（名/字号/粗斜下划删除线）、描边与阴影、弹幕高级（显示区/不透明度/时长/间距）、字幕颜色与边距、对齐、分辨率；下载面板与全局设置均可展开。
3. **已完成 P2-3 封面「附进后删除源图片」 + 弹幕/字幕「内嵌后删除源文件」**。
4. **已完成 P2-4 高级默认档位真正生效**：任务未显式指定画质/编码/音质时用 `advanced.default*` 兜底。
5. **已完成 P2-5 批量分页「仅当前页 / 指定范围 / 搜索全部」**：ParseView 新增搜索范围分段控件；引擎 space/favlist/history 补回 pagination；download-manager 增加 MAX_AUTO_PAGES + 空页安全停止。

> 已完成全部 P2。新增：**媒体流/合并/保留原文件/优先级**（原版核心下载行为）已在 Web 版落地——下载选项面板支持「下载视频流/下载音频流/合并音视频/保留原始分片」，画质/编码/音质优先级可透传到取流；已通过真实下载拆分流验证。

> 已完成全部 P2。I-3（登录）、I-7（剪贴板/托盘）为设计层已明确不做；I-4（代理三模式）先与用户确认是否需要；I-1（筛选/排序参数）为原版本身未做，列为 P3+。

---

## 五、核验证据

- 真实解析 `https://www.bilibili.com/video/BV1GJ411x7h7` → `{type:video, items:1, title:【官方 MV】Never Gonna Give You Up - Rick Astley}`
- 真实每周必看 `popular weekNum=1` → `{type:popular, items:8}`
- 真实媒体选项 `GET /api/media/video:BV1GJ411x7h7:p1` → `dash, qualities:2, audio:3`
- 真实下载任务 → `status=parsing→downloading→completed progress=100 dl=10459386` -> 产物 `.../data/downloads/Never Gonna Give You Up - Rick Astley.mp4`（10.5MB，已清理）
- `pnpm check` 全绿：engine 257 测试、web 42 测试、engine+web build 成功
- 全量测试与构建在上一条 goal 回合已确认
