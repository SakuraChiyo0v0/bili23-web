# bili23-web 设计文档（1:1 TS Web 重做 Bili23-Downloader）

日期：2026-09-03 · 状态：已确认方向，P0 实施中

## 一、目标与非目标

### 目标
把桌面版 Bili23-Downloader v2.15.0 的功能 1:1 迁移到一个全新 TypeScript Web 服务（独立仓库，不复用旧 SDK），并部署到绿联 NAS，用户通过外部网页完成全部下载相关操作。

### 非目标（Web/NAS 形态下无意义或明确砍掉）
- 剪贴板监控、系统托盘、窗口位置记忆、Win7 兼容等纯桌面 GUI 特性。
- 短信登录暂不做（风控与短信通道成本高；扫码 + Cookie 已覆盖日常）。若后续需要可作为单独需求。
- 在线播放器做成"下载前预览"程度（与桌面一致）；完整点播体验放二期，不在 1:1 范围内。
- 不做与 B 站写操作强相关的刷量接口（点赞/三连/动态点赞），桌面版本就不面向这些。

## 二、架构

两层 monorepo：

```
packages/engine  平台无关的下载引擎（纯 Node，可单测，可被任意 UI/CLI 复用）
apps/web         Hono REST + SSE 后端；engine 的薄封装
```

后端不依赖浏览器；ffmpeg 由运行时镜像提供（`apk add ffmpeg`）。

### Engine 模块（对应桌面版 util/ 的语义映射）

| TS 模块 | 对应 Python 参考 | 职责 |
| --- | --- | --- |
| `src/url.ts` | `common/data/url_pattern.py` | 链接识别 → (type, id) |
| `src/constants/quality.ts` | `common/data` 各 map + `enum.py` | 画质/音质/编码/容器常量与映射 |
| `src/config.ts` | `common/config.py` | 设置 schema（无 Qt：JSON 持久化） |
| `src/api/http.ts` | `network/request.py` | 请求层：cookie/UA/代理/wbi/重试 |
| `src/api/wbi.ts` | 内置 wbi 逻辑 | WBI 签名 |
| `src/parser/*` | `parse/parser/*` + `parse/episode/*` | 每类内容 → MediaItem 树 |
| `src/media/*` | `parse/preview/*` + `download/parse/*` | 媒体详情/可选集 |
| `src/stream/*` | `network/download_url.py` + `download/parse/*` | 画质/音质/编码选择 → DASH/MP4 流 |
| `src/download/*` | `download/downloader/*` | 分块并发下载、断点、重试、限速、队列 |
| `src/ffmpeg/*` | `ffmpeg/*` | 合并/转封装(mp4/mkv)/MP3 转换 |
| `src/extras/*` | `parse/additional/*` | 弹幕(xml/ass/json)、字幕(srt/lrc/txt/ass/json)、封面、章节、NFO |
| `src/naming/*` | `common/data/naming_convention.py` + 规则 | 命名模板 + 多级目录分类 |
| `src/auth/*` | `auth/*` | 扫码/cookie 登录、refresh 续期、登录态存储 |
| `src/store/*` | `common/database.py` + `download/task/db.py` | 配置、任务、下载历史/去重 |

### 后端 API 能力（供后续前端对接）

解析（多链接/搜索/筛选）→ 媒体选项（画质/音质/编码）→ 下载任务（容器/附加内容/命名/目录）→ 任务队列（进度/暂停/恢复/重试/取消）→ 历史/重复检测；配置 API 对应桌面全部设置项。

## 三、里程碑与验收（每期独立可上线）

| 期 | 内容 | 验收 |
| --- | --- | --- |
| P0 骨架 | 仓库/workspace/engine 空壳/Web 空壳/部署文件/CI | `pnpm check` 过；健康检查 200；push→ghcr 镜像可拉 |
| P1 核心闭环 | 投稿视频 解析→媒体→取流→下载→ffmpeg 合并→落盘→历史 | Web 上完成一部投稿视频下载并校验文件可播 |
| P2 类型铺开 | 番剧/课程/音乐/空间/收藏夹/每周必看/稍后再看/历史/互动 | 各类型解析+下载冒烟 |
| P3 附加与规则 | 弹幕/字幕/封面/章节/NFO；命名目录规则；批量/筛选 | 产物含所选附加内容，命名符合规则 |
| P4 打磨 | 队列 UI/SSE、设置页全量、错误恢复、限速 | 长时间批量任务稳定 |

## 四、关键技术决策

1. **不复用 `@sakurachiyo0v0/bilibili`**（用户指定）。代码全新书写，仅以桌面版 Python 行为为基准。
2. **存储**：运行数据 bind mount 到 `/volume1/docker/bili23-web/data`。任务/历史用 SQLite（Node `better-sqlite3`，需编译；备选纯 JSON）。首版用 JSON 落盘降低复杂度，任务量大再迁移 SQLite。
3. **登录态**：cookie + refresh_token 持久化，扫码登录入口在 Web 提供二维码；不引入 PG（区别于 account-panel），SQLite/JSON 即可。
4. **Web 无登录页**（同 account-panel 约定）：只走内网/门户后，代理出口不直接暴露公网。
5. **并发下载**：Node 流式分块下载（Range 并发）+ 重试/断点续传，语义对齐桌面 downloader。

## 五、风险与取舍

- B 站接口与风控变动：桌面版 API 实现是 2026 年内维护中的参照，接口失效时按桌面版修复节奏同步。
- ffmpeg 命令细节（杜比视界元数据、ass 嵌入 mkv 等）需在合并/附加模块逐项对照桌面实现。
- 完整 1:1 工作量很大：按里程碑推进，每个里程碑结束都可由用户验证。

## 六、已排除/待定
- 待定：是否开放"历史记录/稍后再看/收藏夹"等需要登录态的聚合页（P2 再定，依赖登录态完成度）。
