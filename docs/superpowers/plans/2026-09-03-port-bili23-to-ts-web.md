# Bili23-Downloader → TS Web 1:1 移植实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务执行。任务用 `- [ ]` 跟踪。

**Goal:** 新仓库把桌面版 Bili23-Downloader v2.15.0 1:1 重做成 TS Web 服务并部署 NAS。

**Architecture:** 两层 monorepo —— `packages/engine`（纯 Node 下载引擎，参考 Python util/ 语义翻译，不复用旧 SDK）+ `apps/web`（Hono REST/SSE + React/Vite 薄封装）。运行镜像内置 ffmpeg；数据 bind mount。

**Tech Stack:** TypeScript(strict) / Node ≥20 / pnpm / vitest / Hono / React / Vite / SQLite(或 JSON) / Docker(ghcr+watchtower)

**参考源（行为基准，不复制代码）：** `C:\LocalSpace\Projects\Github-Proj\Bili23-Downloader`

## Global Constraints

- Node >= 20；pnpm workspace；TS strict + `exactOptionalPropertyTypes` + `noUncheckedIndexedAccess`。
- engine 不得依赖任何 GUI/Web 框架；仅标准库 + 业务依赖（http 用 Node 内置/undici）。
- 提交信息 conventional（`feat:`/`fix:`/`chore:`），英文；仓库身份 `SakuraChiyo0v0 / 3296299414@qq.com`。
- 未经用户说"提交/推送"，不得 commit/push（本仓库例外：P0 完成时用户已要求"开仓库并部署链路"，首推视为授权，之后每次推送前先汇报）。
- 所有可测逻辑走 TDD：先写失败测试 → 确认失败原因 → 最小实现 → 通过 → 提交。
- 行为对齐 Python 版；对"桌面专用行为"（托盘/剪贴板/模态）不做。

---

## 任务总览

- P0：仓库 + workspace + engine/web 骨架 + 部署文件（本计划细化）
- P1：投稿视频最小可用闭环 parse→media→stream→download→merge→history（本计划细化）
- P2：类型铺开（番剧/课程/音乐/空间/收藏夹/每周必看/稍后再看/历史/互动）——单独计划
- P3：附加内容（弹幕/字幕/封面/章节/NFO）+ 命名目录规则 + 批量/筛选 —— 单独计划
- P4：队列 UI/SSE 打磨、设置页全量、限速/错误恢复 —— 单独计划

---

# P0 骨架

### Task 0.1：仓库根 + workspace

**Files:**
- Create: `package.json`、`pnpm-workspace.yaml`、`tsconfig.base.json`、`.gitignore`、`README.md`、`docs/design.md`（已就位）
- Test: 无（脚本型）

**Interfaces:**
- Produces: 根 `pnpm check`（= `pnpm -r typecheck && pnpm -r test && pnpm -r build`）

- [x] Step 1: 校验根文件存在
- [x] Step 2: `pnpm install` 成功
- [x] Step 3: 已提交（并入首笔 feat commit）

### Task 0.2：engine 包骨架 + 基础常量/URL 识别（首个真代码）

**Files:**
- Create: `packages/engine/package.json`、`tsconfig.json`、`vitest.config.ts`
- Create: `packages/engine/src/index.ts`、`src/errors.ts`、`src/constants/quality.ts`、`src/url.ts`
- Test: `packages/engine/tests/url.test.ts`、`tests/quality.test.ts`

**Interfaces:**
- Produces:
  - `type ContentType = "video" | "bangumi" | "cheese" | "lesson" | "list" | "favlist" | "space" | "popular" | "watch_later" | "history" | "festival" | "audio" | "b23" | "unknown"`
  - `classifyUrl(raw: string): { type: ContentType; id: string }`（顺序与 Python `url_patterns` 一致：先域名精确后兜底）
  - `resolveB23(raw: string): Promise<string>`（b23.tv 短链 → 长链，P1 起实现）
  - `VIDEO_QUALITY: Record<string, number>`、`AUDIO_QUALITY`、`VIDEO_CODEC`、`AudioCodec` 等常量（值对齐 Python `data` map）
  - `BiliError extends Error { code: BiliErrorCode }`；`BiliErrorCode = "NETWORK"|"API_ERROR"|"INVALID_URL"|"LOGIN_REQUIRED"|"UNSUPPORTED_TYPE"|"DOWNLOAD_FAILED"|"MERGE_FAILED"|"UNKNOWN"`
- Consumes: Python `src/util/common/data/url_pattern.py`、`enum.py`、data map 文件

- [x] Step 1: 抄录完成（constants/quality.ts、url.ts）
- [x] Step 2: 测试已写（video/bangumi/cheese/audio/space/favlist/list/popular/b23/BV 裸串 等输入）
- [x] Step 3: 首跑 3 失败 → 修正 token 取法后全过
- [x] Step 4: 实现完成
- [x] Step 5: 13/13 通过；typecheck 通过
- [x] Step 6: 已提交

### Task 0.3：web 空壳（Hono health + React 首页 + dev proxy）

**Files:**
- Create: `apps/web/package.json`、`tsconfig.json`、`tsconfig.client.json`、`vite.config.ts`、`index.html`
- Create: `apps/web/src/server/index.ts`（Hono `GET /api/health` → `{ok:true}`；静态托管 dist/client）
- Create: `apps/web/src/client/main.tsx`、`App.tsx`（占位页显示 health）
- Test: `apps/web/tests/health.test.ts`（app.request 返回 200 ok）

**Interfaces:**
- Produces: `GET /api/health`；`pnpm --filter @bili23-web/web dev`（5173 → proxy /api → 8787）

- [x] Step 1: 测试已写
- [x] Step 2: 实现完成
- [x] Step 3: 通过；冒烟 /api/health 200 + SPA 200
- [x] Step 4: 已提交

### Task 0.4：部署文件 + CI

**Files:**
- Create: `apps/web/Dockerfile`（多阶段：node:22-alpine + ffmpeg，复用 root workspace）、`apps/web/docker-compose.nas.yml`、`.env.example`、`deploy/README.md`
- Create: `.github/workflows/docker-image.yml`（push 到 main 且命中 `apps/web/**`、`packages/engine/**` 时构建 `ghcr.io/sakurachiyo0v0/bili23-web:{latest,<ver>,<sha7>}`）

- [x] Step 1: CI 构建验证（本地无 docker daemon）45s 成功
- [x] Step 2: 已推送 main
- [ ] Step 3: 验证 ghcr 包可匿名拉取（`docker pull ghcr.io/sakurachiyo0v0/bili23-web:latest`）
- [ ] Step 4: NAS 侧部署待 P1 后再做

---

# P1 投稿视频最小闭环

### Task 1.1：HTTP 请求层 + WBI 签名

**Files:**
- Create: `packages/engine/src/api/http.ts`、`src/api/wbi.ts`、`src/api/cookies.ts`
- Test: `packages/engine/tests/wbi.test.ts`、`tests/http.test.ts`（本地 http server fixture）

**Interfaces:**
- Produces: `createHttpClient({ cookie?, ua?, proxy? })`：`getJSON<T>(url, params?)`、`getBuffer(url, headers?)`（支持 Range 透传、重试、超时）；`wbiSign(params)`；`CookieJar`（set/get/parse/持久化）
- Consumes: 桌面 `network/request.py` 语义、bilibili-API-collect wbi 算法

- [x] wbi 签名测试 + 实现通过（tests/wbi.test.ts 6 例）
- [x] http fixture：重试/4xx/网络错误/Cookie/Set-Cookie 测试通过（tests/http.test.ts 9 例）
- [x] 待提交（feat(engine): http layer & wbi sign）

### Task 1.2：投稿视频 Parser + 条目模型

**Files:**
- Create: `packages/engine/src/types.ts`、`src/parser/types.ts`、`src/parser/video.ts`、`src/parser/index.ts`
- Test: `packages/engine/tests/parser-video.test.ts`（录制的接口 fixture）

**Interfaces:**
- Produces: `interface MediaItem { bvid; aid; cid; title; page; duration; ... }`；`parseVideo(url): Promise<MediaItem[]>`（多 P → 多条）
- 数据源：`/x/web-interface/view`（含 pages）；登录态高画质相关参数

- [x] Task 1.2 已完成：VideoParser + parseUrl 分发（types.ts/parser/*），10 个单测 + 真实接口冒烟（BV1GJ411x7h7）通过

### Task 1.3：媒体详情/预览（可选画质列表）

**Files:**
- Create: `packages/engine/src/media/video-info.ts`
- Test: `packages/engine/tests/media-video.test.ts`

**Interfaces:**
- Produces: `getVideoInfo(item): { qualities: {id,label}[], audioQualities: [...], codecs: [...], title, cover, duration, owner, ... }`
- 数据源：`/x/player/wbi/playurl`（fnval 支持 DASH/杜比/8K 参数对齐桌面）

### Task 1.4：取流解析（DASH + 候选 CDN）

**Files:**
- Create: `packages/engine/src/stream/resolver.ts`
- Test: `packages/engine/tests/stream.test.ts`

**Interfaces:**
- Produces: `resolveStream(item, { quality, audioQuality, codec }): { video: StreamRef[]; audio: StreamRef[]; container }`；`StreamRef = { url; backupUrls?; bandwidth; codecs }`（桌面从 playurl 与 playurl_durl 两条路径对齐）

### Task 1.5：下载器（分块并发/断点/重试/限速/进度）

**Files:**
- Create: `packages/engine/src/download/downloader.ts`、`src/download/task.ts`
- Test: `packages/engine/tests/downloader.test.ts`（本地静态文件服务器）

**Interfaces:**
- Produces: `downloadRange(url, { start, end, headers, dest, onProgress })`；`DownloadTask`（id/状态/进度/速度/暂停/取消）；并发 N 分块、写临时文件、合并、`.part` 续传
- 语义对齐桌面 downloader：异常自动重试、速度统计

### Task 1.6：ffmpeg 合并与容器

**Files:**
- Create: `packages/engine/src/ffmpeg/runner.ts`、`src/ffmpeg/merge.ts`
- Test: `packages/engine/tests/ffmpeg.test.ts`（无 ffmpeg 环境 skip；CI 镜像含 ffmpeg 则跑）

**Interfaces:**
- Produces: `mergeAudioVideo(videoFile, audioFile, out, { container: "mp4"|"mkv" })`；`probe(file)`；错误映射 `MERGE_FAILED`

### Task 1.7：任务存储与历史/去重

**Files:**
- Create: `packages/engine/src/store/task-store.ts`、`src/store/history.ts`
- Test: `packages/engine/tests/store.test.ts`

**Interfaces:**
- Produces: `TaskStore`（CRUD、持久化 JSON/SQLite）、`isDuplicate(identity)`、记录已完成文件
- 身份哈希规则对齐桌面 `download/task/hash_id.py`（读其实现后翻译）

### Task 1.8：Web 路由 + 前端最小 UI

**Files:**
- Create: `apps/web/src/server/routes/parse.ts`、`download.ts`、`tasks.ts`；`src/server/download-manager.ts`（全局队列）
- Create: `apps/web/src/client/ParseView.tsx`、`DownloadView.tsx`
- Test: `apps/web/tests/api.test.ts`

**Interfaces:**
- Produces: `POST /api/parse {urls} → MediaItem[]`；`GET /api/media/:id`；`POST /api/download {itemId, options}`；`GET /api/tasks`、`GET /api/tasks/:id/events`(SSE 进度)；`GET /api/files`(产物目录浏览)
- UI：粘贴链接→解析列表→选画质/编码→下载→进度→完成可见文件

### Task 1.9：端到端冒烟

- [ ] `docker build` 后容器内下载一部短投稿视频（可用测试号/小视频），校验产物 mp4 可播放（ffprobe）
- [ ] Commit + 汇报，P1 验收由用户确认

---

## 自检记录
- P0 产出可独立验证（`pnpm check`、health、镜像可拉）。
- P1 验收标准唯一且可观察：网页完成一部投稿视频下载并校验可播。
- 后续 P2–P4 分别生成独立计划（沿用本模板）。
