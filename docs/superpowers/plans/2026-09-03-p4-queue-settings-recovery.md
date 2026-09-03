# Bili23-Downloader → TS Web：P4 队列/设置全量/限速恢复 + i18n/主题 + NAS 部署收尾 实施计划

> 承接 P3（已 commit `c2640d1`）。P4 范围 = spec §9 P4 里程碑 + goal 出口：
> 队列 UI/SSE 打磨、设置页全量、限速/恢复稳定、i18n/主题；项目可 Docker 部署到 NAS（ghcr+watchtower+`./data` 链路就绪）。

**Goal（spec §9 P4）:** 长时间批量下载稳定：队列按配置并行、限速可即时调整；服务重启后任务可恢复（未完成续传或标为中断可手动继续）；下载/设置/历史在 Web 可完整管理；明暗主题与简中/繁中/英文可用；Docker 镜像可部署到 NAS。
**验收口径（P4 出口）:**
1. 一次批量加入 10 集：并行任务数=2 时同时进行中的任务不超过 2，其余排队；全部完成后重复加入提示“已下载”。
2. 下载中把全局限速从“不限”改为 500KB/s 即时生效（不再超速）；改并行数/线程数后新任务按新值排队/分片。
3. 批量进行中重启服务：内存任务从 `download_task` 表恢复为“已中断”并保留 .part；点击“继续”可续传完成且不重复下已完成分片（断点续传）；完成后进入历史。
4. 下载页分组（全部/进行中/已完成/失败/历史）、单任务显示速度与剩余时间、支持 暂停/继续/取消/删除/重试/查看产物与任务日志；产物文件可在网页下载。
5. 设置页全量分组（界面/下载/附加内容/文件命名/高级）可保存并重启保留；改命名/默认附加只对新建任务生效（R-208 不回归）。
6. 切换深色主题与英文（或繁中）后导航与核心页面布局、文案正确。
7. `pnpm check` 全绿；`docker build -f apps/web/Dockerfile .` 成功；compose 模板含 `/data` bind、健康检查、watchtower label；README/deploy 文档给出 NAS 部署步骤。
8. 每个大版本一次 commit + push（本次 `feat: P4 queue & settings & recovery & i18n & docker`）。

## 现状盘点（2026-09-03 交接后确认）
- 引擎已具备：分块并发下载（concurrency/chunkSize/rateLimitBps/断点 state/resume/AbortSignal/自动重试）、SQLite TaskStore（download_task 进行中 + completed_task 历史）、HistoryService 去重。**缺**：可跨文件/任务共享、可即时调整的全局限速门（downloadFile 每次自建 TokenBucket）。
- Web 已具备：ConfigStore（仅 additional + fileNaming 两组）、per-task SSE、cancel、`#run`（fetchPlayMediaInfo→resolveStreams→runDownloadPlan→merge→命名落盘→附加文件）、任务快照写 download_task、完成移入 completed_task。
- **缺**：队列调度（createTasks 直接 `void this.#run()`，无并行上限/排队）；pause/resume/retry/delete；重启 rehydrate（启动不读 download_task 遗留任务）；历史查询 API/UI；下载页速度/ETA/分组；文件下载端点；设置页只有附加+命名两组；i18n/主题；Docker compose 未设 `BILI23_DATA_DIR=/data`（数据会落容器层）、无健康检查、deploy 文档缺失。

## API 契约（先定死，服务端与前端各自遵守）
新增/变更 REST：
- `GET /api/tasks`：内存任务（queued/parsing/downloading/merging/paused/interrupted/completed/failed/cancelled，含历史本会话已完成项），摘要新增字段 `speedBps`、`etaSec`、`startedAt`。
- `GET /api/history`：`{ history: HistoryEntryDTO[] }`，来自 completed_task（含重启前完成项），字段 `{taskId,title,completedAt,outputPath,size?,error?}`。
- `POST /api/tasks/:id/pause`、`POST /api/tasks/:id/resume`（paused/interrupted/failed 可继续）、`POST /api/tasks/:id/retry`（failed/cancelled 重建任务重下；覆盖重复检测）、`POST /api/tasks/:id/delete`（含历史记录从内存与表删除、清理 .tmp）。
- `DELETE /api/history/:taskId`：仅删历史记录（不动产物文件）。
- `GET /api/tasks/:id/log`：`{ lines: string[] }` 任务生命周期日志（内存环形，每任务≤200 行）。
- `GET /api/files/raw?path=<相对下载根路径>`：下载产物文件；防目录穿越（规范化后必须位于下载根内）。
- `GET/PUT /api/config` 结构扩展为 `{ additional, fileNaming, download, behavior, advanced }`（字段见 Task 4.2；向后兼容：旧 config.json 深合并默认值）。
- `GET /api/health`（已有，Docker 健康检查用）。

## 已锁定决策
1. 状态集扩展：`queued|parsing|downloading|merging|paused|interrupted|completed|failed|cancelled`；`interrupted`=重启后从 download_task 恢复的遗留任务（保留 .part 与断点快照，可手动继续）。
2. 并行调度：进程内 FIFO + 并发上限（配置 `download.parallel`，默认 2）；单任务分片并发 = 配置 `download.threads`（默认 4）。并发上限只在“新任务创建”时读取配置并实时更新调度器上限（同值语义对齐桌面）。
3. 全局限速：引擎新增共享 `SpeedGate`（跨所有任务/分片的总吞吐门）；Manager 持有单例 gate，配置变更即时 `gate.setBps()`；任务内不再各自建桶（downloadFile 增加可选 `gate` 参数，兼容旧调用）。threads/rate 修改即时对“新建分片请求”生效（gate 为共享；threads 取任务创建时快照）。
4. 暂停/继续：pause=中止当前下载但保留 download_task 行与 .tmp/.part 与 files 断点快照，状态 paused；resume/retry/重启后 continue=以快照 files 为 resumeMap 重进 `#run`，已完成分片跳过（downloadFile state 语义）。任务目录命名已按 task.id，稳定可复用。
5. 重启恢复：`DownloadManager.init()`（index listen 前 await）：读 listActive → 用 snapshot.item 重建 #items/#tasks，状态=interrupted、error=“服务重启，任务中断，可点击继续”；不自动下载（避免重启风暴）。compose restart=unless-stopped 配合 watchtower。
6. 产物文件下载：只读下载根内文件；`path` 用相对正斜杠，服务端 `resolve` 后 `startsWith(rootDir + sep)` 校验；拒绝目录与不存在。
7. i18n/主题：轻量 `I18nContext`（zh-CN/zh-TW/en，字典缺键回退 zh-CN；默认跟随浏览器）+ `ThemeContext`（light/dark/follow-system；CSS 变量驱动，不使用第三方库）。界面/语言主题偏好持久化到 `config.behavior`（单用户全局）。
8. 高级组：本期落库并接线“默认画质/音质/编码优先级”（下载选项未显式指定且为 auto 时用于兜底）+ 重名策略 + 重复策略；CDN 列表/代理/ffmpeg 路径本期仅高级组展示并持久化（引擎/容器语义：ffmpeg 用系统 PATH、代理与 CDN 由环境/网关负责），在设置页标注“当前由环境配置”。不伪装 1:1。
9. Docker：Dockerfile runtime 加 `ENV BILI23_DATA_DIR=/data`；compose 模板移到 `deploy/`（含 `./data:/data`、健康检查、watchtower label、TZ）；保留 apps/web 下模板同步一份或 README 指向 deploy/（避免两处漂移：以 deploy/ 为准，删 apps/web 模板）。
10. 历史/删除语义：删任务=同时删 download_task/completed_task 行与内存；产物文件不自动删（网页另提供产物区手动下载/保留）。

## 行为基准提醒
- 桌面并发默认 download_parallel=2、download_thread=4（config.py 默认）；P4 默认同此。
- 限速单位 KB/s（桌面设置显示）；1 KB/s=1024 B/s。

## Tasks
### Task 4.1：engine 共享限速门（SpeedGate）+ downloader 接线
**Files:** Create `packages/engine/src/download/rate.ts`；Modify `download/downloader.ts`（DownloadFileOptions 增 `gate?`，downloadFile 用共享 gate 替代自建桶）、`download/task.ts`（透传）、`index.ts`（导出 SpeedGate）
**验收:** 单测：两路并发下载经同一 gate 总速率 ≤ 设定；gate.setBps 调低后新请求受新速率约束；gate bps=0 不限速；旧调用（无 gate）行为不变（回归 downloader.test.ts）。
### Task 4.2：server AppConfig 扩展（download/behavior/advanced）+ 校验/默认
**Files:** Modify `apps/web/src/server/config.ts`（AppConfig 增组与默认、读旧 JSON 兼容、validate 扩展）、`client/types.ts`（DTO 同步）
**字段:** `download: { dir?: string; parallel: number; threads: number; speedLimitKbps: number; renamePolicy: "auto"|"overwrite"; duplicatePolicy: "prompt"|"skip"|"force"; defaultContainer: "mp4"|"mkv" }`；`behavior: { language: "zh-CN"|"zh-TW"|"en"|"system"; theme: "light"|"dark"|"system" }`；`advanced: { defaultVideoQualityId?: number; defaultAudioQualityId?: number; defaultCodecId?: number; cdnHosts: string[]; ffmpegPath?: string; proxy?: string }`
**验收:** 旧 config.json（只有 additional/fileNaming）读取后补默认不报错；PUT 校验非法值 400；值类型与范围校验单测。
### Task 4.3：DownloadManager 队列/限速/暂停恢复/重启 rehydrate/历史
**Files:** Modify `apps/web/src/server/download-manager.ts`（状态集、调度器、gate、pause/resume/retry/delete、`init()`、summary 增 speedBps/etaSec、task log ring、`listHistory/deleteHistory`）、`config.ts`（gate setBps 联动）
**验收:** 单测（mock 网络/短文件）：并行上限=2 时第 3 个任务 queued；pause 保留快照；resume 复用断点（可 mock onFileSnapshot 验证未重下）；重启 init 后遗留任务=interrupted；failed 重试。
### Task 4.4：routes API 扩充
**Files:** Modify `apps/web/src/server/routes.ts`、`index.ts`（manager.init() await、raw 文件下载、health 不变）
**验收:** 单测（web tests/api）：pause/resume/retry/delete/history/log/raw 各返回码与防穿越；S01 文件下载路径穿越被 400。
### Task 4.5：下载页 UI 打磨（分组/速度/ETA/操作/历史/产物下载/任务日志）
**Files:** Modify `apps/web/src/client/DownloadView.tsx`、`types.ts`
**验收:** 手工冒烟：10 项批量→分组计数正确；下载行显示速度与剩余；暂停→继续；失败→重试；历史区展示重启前完成项；产物链接可下载；任务日志可展开。
### Task 4.6：设置页全量 + 接线
**Files:** Modify `apps/web/src/client/SettingsView.tsx`（分组：界面/下载/附加内容/文件命名/高级）、`App.tsx`（主题 i18n Provider）
**验收:** 下载组保存并行=2/限速=500KB/s 重启保留并生效（配合 4.3 冒烟）；附加/命名组 P3 功能不回归。
### Task 4.7：i18n + 主题
**Files:** Create `apps/web/src/client/i18n.tsx`（I18nContext + dict zh-CN/zh-TW/en）、`theme.tsx`（ThemeContext + CSS 变量）；Modify `App.tsx`、`ParseView.tsx`、`DownloadView.tsx`、`SettingsView.tsx`、`main.tsx`
**验收:** 英文/深色切换后导航+核心页文案正确、布局可用；偏好保存刷新保留。
### Task 4.8：Docker / NAS 部署链路收尾
**Files:** Create `deploy/docker-compose.nas.yml`、`deploy/.env.example`、`deploy/README.md`；Modify `apps/web/Dockerfile`（ENV BILI23_DATA_DIR=/data）；删除 `apps/web/docker-compose.nas.yml`（以免漂移）或保留并注明以 deploy/ 为准（二选一，倾向删除）
**验收:** 本地 `docker build -f apps/web/Dockerfile -t bili23-web:test .` 成功；镜像内默认 data=/data；compose 语法 `docker compose -f deploy/docker-compose.nas.yml config` 通过（无 docker 环境则文档说明 + workflow 已在 P0 推送 ghcr）。
### Task 4.9：P4 出口回归与提交
- [x] Task 4.9 已完成：全仓 `pnpm check` 绿灯（engine 31 文件/251 用例 + web 4 文件/31 用例 + typecheck + engine/web build）。
- [x] P4 真网冒烟 PASS（端口 8795，数据目录 `.e2e-data-p4/run1`，番剧 ss33323 雾山五行）：
  1) 批量 10 分集 + 并行=2：队列同时进行中 ≤2、其余 queued（R1 观察到 completed=2 active=2 queued=6）；
  2) 杀服务重启：遗留任务从 download_task 恢复为 interrupted（6 条），resume 后日志出现「继续下载（断点续传）」并完成；交互式 pause（downloading 中 200→paused）→ resume → completed（「音乐响起 游戏结束」81s 分集）；
  3) 限速即时生效：改 speedLimitKbps=256 后观察 speedBps≈21KB/s（≤256KB/s×1.8），TaskSummary 输出 speedBps/etaSec；threads/parallel 生效；
  4) 2 条预告/PV 分集因接口无可用直链（内容侧）failed，错误清晰且不阻塞队列其余任务（错误恢复稳定）；retry 端点 200、delete 端点 200；
  5) 历史：GET /api/history 返回已完成项（最终 9 条 completed，含重启前完成项）；对已完成内容再创建任务返回 409 DUPLICATE；
  6) 产物：GET /api/files/raw 下载 mp4 200（7.5MB）、GET /api/tasks/:id/log 返回 7 行带时间戳日志、ffprobe 校验产物可播（62.9s）。
- [x] UI 冒烟（端口 8796，Chrome headless + DOM）：PUT behavior{language:en,theme:dark} 后 html data-theme="dark"、导航文案 Parse/Downloads/Settings、颜色全部走 CSS 变量（--surface/--text/--accent），无渲染崩溃。
- [x] Docker：`deploy/docker-compose.nas.yml`（BILI23_DATA_DIR=/data、healthcheck、watchtower label、./data:/data、8788→8787）经 `docker-compose config` 校验通过；Dockerfile runtime 加 `ENV BILI23_DATA_DIR=/data`；本机 Docker daemon 未运行，镜像实际构建留待 CI（workflow 已就绪，push 触发）。
- 整版 commit + push：`feat: P4 queue & settings & recovery & i18n & docker`。

## 自检记录
- P4 不回归 P1-P3：全量测试 + 冒烟。
- 真网冒烟沿用 412 重试经验。
- 明确 Web 差异/裁剪：重启不自动续传（用户手动继续，避免启动风暴）；CDN/代理/ffmpeg 路径本期持久化展示、运行语义归环境；i18n 缺键回退 zh-CN。