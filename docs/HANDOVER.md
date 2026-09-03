# bili23-web 项目交接文档

> 本文档面向**接手继续开发的下一位开发者**。目标：你拿到仓库后，能快速理解它是什么、做到哪一步、
> 为什么这样设计、怎么跑、怎么部署、有哪些坑，以及接下来该做什么。请先通读一遍再动手。
> 最近更新：2026-09-04（前端整体移除到 backup 分支，main 为纯 REST/SSE 后端）。

---

## 1. 项目是什么

把桌面版 [Bili23-Downloader](https://github.com/ScottSloan/Bili23-Downloader)（Python + PySide6，v2.15.0）
**1:1 重做成 TypeScript Web 服务**，跑在 NAS 上，供浏览器/后续前端调用。

- **不是**在旧 TS SDK 上改，而是**独立新仓库**。
- **功能基准** = 桌面版 Python 源码（行为参照、不复制代码）。
- **当前阶段**：`main` 是**纯后端服务**（Hono REST/SSE + 下载引擎），不含任何前端。
  此前一版 React/Vite 前端（含扫码登录 UI 等）整体备份在 `backup/frontend-20260904`，未删除，可随时参考。

---

## 2. 仓库与远程

| 项 | 值 |
| --- | --- |
| 本地仓库 | `C:\LocalSpace\Projects\My-Proj\NAS-PROJECTS\bili23-web` |
| 远程 | `https://github.com/SakuraChiyo0v0/bili23-web.git` |
| 默认分支 | `main`（纯后端） |
| 备份分支 | `backup/frontend-20260904`（旧前端快照，已推送） |
| Git 身份 | `SakuraChiyo0v0` / `3296299414@qq.com` |

**推送前务必**用无代理直接 push（公司代理会影响 GitHub）：

```bash
git -c http.proxy= -c https.proxy= push origin main
```

**提交约定**：每个「整个大版本」打一个提交并 push；提交信息用 `feat(web): ...` / `feat(engine): ...` / `docs: ...`。

---

## 3. 技术栈

- **语言**：TypeScript（Node ≥ 22.5，引擎用 `node:sqlite`，需 Node 22+）
- **包管理**：pnpm（workspace 单仓）
- **后端框架**：Hono（REST + SSE），运行在 `@hono/node-server`
- **引擎**：自研 `@bili23-web/engine`（解析 / 取流 / 下载 / 合并 / 附加内容 / 命名 / 存储）
- **下载**：原生分块并发（Range 分片 + 断点续传 + 令牌桶限速）
- **合并**：原生 `ffmpeg` / `ffprobe`（子进程）
- **存储**：SQLite（`node:sqlite`，WAL）+ JSON 配置
- **代理**：`undici` ProxyAgent
- **HTTP**：全局 `fetch`（undici），自封装带 cookie/UA/Referer/重试
- **反爬**：WBI 签名（`api/wbi.ts`）

> 注：前端依赖（React/Vite/@vitejs/plugin-react/qrcode）已从 `main` 移除，只存在于备份分支与历史提交。

---

## 4. 仓库结构

```
packages/engine/   下载引擎（纯库，无 HTTP 服务）
  src/api/         HTTP 客户端、Cookie、WBI、匿名会话、扫码/cookie 登录原语
  src/parser/      各内容类型解析器（video/bangumi/cheese/lesson/audio/space/favlist/
                   history/watch_later/popular/list/festival + expand/interactive/guard）
  src/media/       取流（video-info/flavor）、WBI keys
  src/stream/      画质/编码/音质解析（resolveStreams）
  src/download/    分片下载器、限速门、任务编排
  src/ffmpeg/      runner（子进程）/ command（参数构造）/ merge（合并/转封装/探测）
  src/extras/      弹幕/字幕/封面/章节/元数据
  src/naming/      命名规则 + 变量 + 编号
  src/store/       SQLite 任务库（download_task/completed_task/parse_history）、hash
  src/async/       并发工具
  src/constants/   画质/编码枚举
  src/index.ts     引擎统一导出
  tests/           引擎单元测试（vitest）
apps/web/          Web 后端（Hono，纯 API 服务，无前端产物）
  src/server/      index.ts（启动）/ routes.ts（接口）/ download-manager.ts（任务调度）/
                   config.ts（全局设置）
  tests/           web 测试（vitest）
  Dockerfile       NAS 镜像（内置 ffmpeg）
deploy/            NAS compose / .env.example / 部署说明
.github/workflows/ push main → 自动构建镜像推 ghcr
docs/              设计与实施文档
```

> `main` 上已无 `apps/web/src/client`、`index.html`、`vite.config.ts`、`tsconfig.client.json`、前端测试及前端相关依赖；
> 服务启动后 `/` 与静态资源不再托管，只提供 `/api/*`。旧前端见备份分支（第 2 节）。

---

## 5. 已实现功能（对照原版）

### 内容类型（全部实现）

| 类型 | 解析器 | 说明 |
| --- | --- | --- |
| video（投稿视频） | `video.ts` | view 接口分P 展开；互动视频 BFS 分支 |
| bangumi（番剧） | `bangumi.ts` | PGC 整季/单集 |
| cheese（课程） | `cheese.ts` | PGC 课程 |
| lesson（商城课） | `lesson.ts` | 会员购商城课（无 cid） |
| audio（音频） | `audio.ts` | 音乐/音频直链 |
| space（个人空间） | `space.ts` | UP 投稿列表，支持 keyword 搜索 |
| favlist（收藏夹） | `favlist.ts` | 含 `list/ml{id}`；ogv 行跳过 |
| history（历史） | `history.ts` | 需登录（SESSDATA） |
| watch_later（稍后再看） | `watch-later.ts` | 需登录 |
| popular（每周必看） | `popular.ts` | WBI 签名 |
| list（合集/系列） | `list.ts` | season/series/sid，非 WBI |
| festival（活动页） | `festival.ts` | 抓 `__INITIAL_STATE__` 还原 bvid |
| interactive（互动视频） | `interactive.ts` | `is_stein_gate=1` 时 BFS 全分支 |

### 下载流程

- 解析 → 创建任务 → `fetchPlayMediaInfo` 取流 → `resolveStreams` 选画质/编码/音质 → 分片并发下载
  → `ffmpeg` 合并/转封装 → 命名整理落盘 → 写入完成历史。
- 支持：暂停/恢复（断点续传）、取消、重试、并发任务上限、单任务分片并发、全局限速、
  重名自动改名、重复下载判定（进行中+历史）。
- 单文件直链（audio=m4a / lesson=mp4）下载即成品，不走 ffmpeg。
- 下载选项快照：媒体流（视频/音频/视频+音频）、合并开关、保留原文件、优先级等在任务创建时固化，
  后续改设置不影响已建任务（见 §7「任务快照与续传」）。

### 附加内容（extras）

弹幕（ASS/XML/JSON）、字幕（SRT/LRC/TXT/ASS/JSON + 多语言）、封面（下载/附加/嵌入后删除）、
章节（ffmetadata）、元数据（NFO/JSON）。弹幕/字幕样式（ASS 样式）与嵌入后删除源文件均可配置。

### 命名规则

结构对齐桌面 `ConventionType`（NORMAL/PART/COLLECTION/INTERACTIVE_VIDEO/BANGUMI/CHEESE/LESSON/
FAVORITE/SPACE/HISTORY/WATCH_LATER/WEEKLY/AUDIO），`{var}` 模板、`{var:%Y...}` 时间格式化、`{var:0Nd}`
编号，支持 `/{folder}/{stem}` 多级目录。

### 全局设置（config.json）

- `additional`：附加内容默认值
- `fileNaming`：命名规则 + 编号模式
- `download`：目录 / 并行 / 线程 / 限速 / 重名与重复策略 / 默认容器
- `behavior`：语言 / 主题
- `advanced`：默认画质音质编码 / **CDN / ffmpeg 路径 / 代理**（这三者在下载时真正生效）

---

## 6. 后端接口清单

基址 `http://<host>:8787`。完整路由见 `apps/web/src/server/routes.ts` 顶部注释。

### 解析

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/api/parse` | body `{urls}` 或 `{type, query?, keyword?, pn?, pages?}` |
| GET  | `/api/media/:itemId` | 某条目可选画质/编码/音质 |

`type` 支持：`video/bangumi/cheese/lesson/audio/space/favlist/history/watch_later/popular/list/festival`。
`space/favlist/history/watch_later/list` 支持 `pn`（起始页）+ `pages`（翻页数）。

### 下载任务

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/api/download` | 创建任务。body：`{itemIds, options?, force?}`（选项：媒体流/合并/保留原文件/优先级/命名/附加内容等） |
| GET  | `/api/tasks` | 任务列表 |
| GET  | `/api/tasks/:id` | 单任务 |
| GET  | `/api/tasks/:id/events` | SSE 进度 |
| GET  | `/api/tasks/:id/log` | 生命周期日志 |
| POST | `/api/tasks/:id/cancel` | 取消 |
| POST | `/api/tasks/:id/pause` | 暂停（保留断点） |
| POST | `/api/tasks/:id/resume` | 继续（断点续传） |
| POST | `/api/tasks/:id/retry` | 重试（清空断点） |
| POST | `/api/tasks/:id/delete` | 删除任务（含历史与临时文件） |

### 历史 / 文件

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET  | `/api/history` | 已完成下载历史 |
| DELETE | `/api/history/:taskId` | 删除单条 |
| GET  | `/api/parse-history` | 已解析链接列表 |
| DELETE | `/api/parse-history/:id` | 删除单条 |
| GET  | `/api/files` | 产物目录 |
| GET  | `/api/files/raw?path=...` | 产物下载（防目录穿越） |

### 配置 / 登录态

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET  | `/api/config` | 读取全局设置 |
| PUT  | `/api/config` | 更新全局设置（含 advanced.proxy/cdnHosts/ffmpegPath） |
| GET  | `/api/auth/status` | 登录态（SESSDATA） |
| POST | `/api/auth` | 设置 SESSDATA（Cookie 登录） |
| DELETE | `/api/auth` | 退出并清除登录态 |
| POST | `/api/auth/qr` | 生成扫码登录二维码 |
| POST | `/api/auth/qr/poll` | 轮询扫码结果（成功即写入 SESSDATA） |

> 登录支持 **Cookie（SESSDATA）** 与 **扫码**（`/api/auth/qr*`）；登录态用于「稍后再看/历史/高画质」等接口。
> 短信登录未实现。

---

## 7. 关键实现与设计决策

### 平铺叶子模型（Web 与桌面的核心差异）
桌面版是「树」：合集/空间/收藏夹的每行可再二次解析。Web 采用**扁平模型**：容器型解析器
（space/favlist/history/watch_later/list）在解析时就并发调 view，把每个视频的**全部分P**平铺成
可下载叶子（`expand.ts` `expandVideoRows`）。命名分类通过 `item.containerType` + `collectionTitle`
等元数据还原。

### 跳转跟随
`parseUrl` 会跟随解析器返回的 `redirectUrl`（最多 3 跳）：
- 活动页 → 视频（festival）
- 视频跳番剧（view 返回 `redirect_url`）
b23 短链在识别阶段就解跳转。

### 合集/系列（list.ts）
- `type=season`：`/x/polymer/web-space/seasons_archives_list`，参数 `mid/season_id/page_size=30/page_num`
- `type=series` 或 `sid=`：`/x/series/archives`（`ps=30`）+ `/x/series/series` 取 `meta.title/name`
- 每行 `archives[]` URL 为 `/video/{bvid}`，按 bvid 二次展开分P。

### 互动视频（interactive.ts）
- 判定 `view.data.rights.is_stein_gate === 1`。
- 取图版本：`/x/player/wbi/v2`（WBI 签名），读 `data.interaction.graph_version`。
- BFS：从 `(cid, edge_id=0)` 出发，`/x/stein/edgeinfo_v2`，节点标题取 `data.title ?? story_list[0].title`，
  选项 `edges.questions[].choices[]`（`id` 为 edge_id，`cid` 为目标节点）。
- visited 按 `(cid, edge_id)` 去重；每个节点 → 一个叶子 `video:{bvid}:iv:{cid}`（interactive=true）。

### 代理 / CDN / ffmpeg
- **代理**：`HttpClient.setProxy()`，用 undici `ProxyAgent` 包装 fetch，解析与取流共用。
- **CDN**：`advanced.cdnHosts`（主机名数组）重写流 URL host 加入候选，优先探测。
- **ffmpeg**：`advanced.ffmpegPath` 注入合并/转封装命令的 `argv[0]`。

### 任务快照与续传
任务创建即把「全局默认配置 + 本次覆盖」固化进 `DownloadOptions` 快照（R-208），
后续改设置不影响已建任务。断点用 `ChunkState`（每分片已确认字节），存 SQLite，重启后 `interrupted` 可继续。

---

## 8. 数据与存储

数据根目录 `BILI23_DATA_DIR`（默认 `<cwd>/data`；容器内 `/data`）：

| 路径 | 内容 |
| --- | --- |
| `config.json` | 设置（JSON） |
| `task.db` | SQLite：`download_task`（进行中）、`completed_task`（已完成）、`parse_history`（解析历史） |
| `auth.json` | SESSDATA（未登录则无） |
| `downloads/` | 下载产物（含 `.tmp` 临时目录） |

---

## 9. 开发 / 构建 / 测试

```bash
pnpm install

# 全量校验（typecheck + test + build）——每次改动后跑，必须全绿
pnpm check

# 只跑引擎
pnpm --filter @bili23-web/engine typecheck
pnpm --filter @bili23-web/engine test
pnpm --filter @bili23-web/engine build

# 只跑 web
pnpm --filter @bili23-web/web typecheck
pnpm --filter @bili23-web/web test
pnpm --filter @bili23-web/web build

# 启动后端（开发）
pnpm --filter @bili23-web/web dev:server   # http://localhost:8787（仅 API）
# 或用 tsc 产物跑
node apps/web/dist/server/index.js
```

环境变量：`PORT`（默认 8787）、`BILI23_DATA_DIR`（默认 `./data`）、`DOWNLOAD_DIR`（默认 `<data>/downloads`）。

> 注意：`pnpm --filter @bili23-web/web typecheck` 依赖 `packages/engine/dist` 的最新类型。
> 改动 engine 源码后，**先 `pnpm --filter @bili23-web/engine build`** 再检查 web，否则 web 用旧类型。

---

## 10. NAS 部署（Docker）

- 镜像由 `.github/workflows/docker-image.yml` 在 push main 时自动构建并推 `ghcr.io/sakurachiyo0v0/bili23-web:latest`。
- 部署入口：`deploy/README.md`（唯一入口，旧 `apps/web/docker-compose.nas.yml` 已删）。
- 端口：宿主 `8788` → 容器 `8787`。数据挂载宿主 `./data` → 容器 `/data`。
- 容器内嵌 `ffmpeg`（alpine）。健康检查 `/api/health`。
- 自动更新：watchtower 标签 `com.centurylinklabs.watchtower.enable=true`。

```bash
# 在 NAS（Linux）上
sudo mkdir -p /volume1/docker/bili23-web/deploy /volume1/docker/bili23-web/data
# 上传 deploy/{docker-compose.nas.yml,.env.example,README.md}
sudo docker compose --project-directory /volume1/docker/bili23-web \
  -f deploy/docker-compose.nas.yml up -d
```

> 镜像变化影响：push main 会自动重建镜像并触发 watchtower。当前镜像**不含任何前端**，
> 重建后浏览器访问 `:8788` 将只有 API（`/` 404）。若 NAS 上的旧容器仍在服务旧 UI，重建前请先确认。

---

## 11. 已知问题与坑

1. **412 反爬**：`space/favlist/popular` 等 WBI 接口偶尔返回 `HTTP 412 Precondition Failed`，属 B 站反爬/风控，
   非代码 bug（原版同样会遇到）。重试或稍后再试。非 WBI 接口（video/history/list/festival）基本稳定。
2. **当前 `/` 返回 404**：`main` 为纯 API 后端，不再托管前端页面。前端需重建（见 §12）。
3. **文件行尾是 CRLF**：编辑 `apps/web/src/server/*.ts`、`packages/engine/src/*.ts` 等文件时注意行尾
   （git 暂存会提示 CRLF→LF）。多行字符串替换务必用 `\r?\n`。
4. **`engine` 与 `web` 的构建顺序**：改 engine 后需先 build engine，web 才能拿到新类型。
5. **未跟踪备份/草稿不要提交**：`docs/upstream-sync-design.md`、`packages/engine/src/types.ts.bak`、
   `packages/engine/tests/_scratch.ts.txt` 等（如仍在工作区）是临时文件，不要纳入提交。
6. **node:sqlite 要求 Node 22+**（引擎 `package.json` engines 写了 ≥22.5）。Docker 用 node:22-alpine。

---

## 12. 待办 / 建议（接手后）

### 必须
- [ ] **重建前端**（响应式、移动端可用）。当前 `main` 不含前端，服务只提供 `/api/*`。
      建议做成 B 站官网风格、动效丰富、响应式；通过 `/api/*` 对接后端。
      可直接参考 `backup/frontend-20260904` 里旧版 React/Vite 前端（布局、交互、登录扫码 UI、样式编辑器等）。

### 建议
- [ ] 把 `/api/parse` 的 `pn/pages` 透传到前端「批量翻页」交互。
- [ ] 为 `list/festival/interactive/parse-history` 补 E2E 或 web 侧测试（引擎单测已有）。
- [ ] 考虑 `advanced.proxy` 在容器环境下的实际用法（如需外网代理下载）。
- [ ] 上线前注意：不要把 8788 直接暴露公网；建议内网/门户访问。

---

## 13. 测试策略

- **引擎单测**（`packages/engine/tests/*.test.ts`）：用 `fetchImpl` mock 注入，覆盖各解析器、
  WBI、取流、命名、extras、store、下载器、限速、ffmpeg 合并。
- **web 测试**（`apps/web/tests/*.test.ts`）：`api.test.ts`（REST 直接调）、`download-manager.test.ts`、
  `config.test.ts`、`health.test.ts`。
- 改代码后跑 `pnpm check`；涉及真实 ffmpeg 的测试会真实调 ffmpeg（测试环境需安装）。

---

## 14. 工程约定（重要）

- **不要制造装饰性假功能**：用户明确要求「原程序能做的都要做成」，宁可少做也不要假的。
- **只做用户明确要求的范围**，不顺手扩大。改用户可观察行为前先确认。
- **提交/推送前确认平台与身份**（本仓库 GitHub，身份见第 2 节）。
- **每次大版本一个提交并 push**，提交信息用描述性前缀。
- 代码内注释对标桌面版源码逻辑（`语义对齐桌面 parser/...`），保留便于追踪。
- 前端整体存档于备份分支后从 main 移除；若再次大改前端，可沿用同一「备份分支 + 重建」节奏。
