# bili23-web

把桌面版 [Bili23-Downloader](https://github.com/ScottSloan/Bili23-Downloader)（Python + PySide6，v2.15.0）
**1:1 重做成 TypeScript Web 服务**，部署在 NAS 上，通过网页完成解析、下载、附加内容与命名整理。

> 独立新仓库，不复用旧 TS SDK。功能基准 = 桌面版 Python 源码
> `C:\LocalSpace\Projects\Github-Proj\Bili23-Downloader`（行为参照，不复制代码）。
> 当前为**前后端一体的 Web 服务**：Hono REST/SSE 后端 + React/Vite 前端（Vite 构建后由同一服务静态托管 SPA）。

## 仓库结构

```
packages/engine/   全新 TS 下载引擎（解析/取流/下载/合并/附加内容/命名规则/存储）
apps/web/          Web 端：Hono 后端（REST + SSE）+ React 前端（src/client，构建到 dist/client 静态托管）
deploy/            NAS compose（docker-compose.nas.yml / .env.example / README）
.github/workflows/ push → ghcr 自动构建
docs/              设计文档与实施计划
```

## 本地开发

```bash
pnpm install
pnpm check                                  # typecheck + test + build 全量校验
pnpm --filter @bili23-web/web dev:server    # http://localhost:8787（后端）
pnpm --filter @bili23-web/web dev:client    # http://localhost:5173（前端开发服务器，/api 代理到后端）
```

数据目录 `BILI23_DATA_DIR`（默认 `./data`），下载目录 `DOWNLOAD_DIR`（默认 `<data>/downloads`）。

## NAS 部署

见 `deploy/README.md` 与 `docs/design.md`（遵循 NAS-PROJECTS 模板：ghcr + watchtower + `./data` bind mount）。

## 后端接口

### 解析

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/api/parse` | 解析链接。body：`{urls}` 直接给链接，或 `{type, query, keyword?, pn?, pages?}` 类型入口 |
| GET  | `/api/media/:itemId` | 某条目的可选画质/编码/音质 |

`type` 支持：`video / bangumi / cheese / lesson / audio / space / favlist / history / watch_later / popular / list / festival`。
`space / favlist / history / watch_later / list` 支持 `pn`（起始页）+ `pages`（翻页数）批量分页。

### 下载任务

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/api/download` | 创建任务。body：`{itemIds, options?, force?}` |
| GET  | `/api/tasks` | 任务列表 |
| GET  | `/api/tasks/:id` | 单任务状态 |
| GET  | `/api/tasks/:id/events` | SSE 进度推送 |
| GET  | `/api/tasks/:id/log` | 任务生命周期日志 |
| POST | `/api/tasks/:id/cancel` | 取消 |
| POST | `/api/tasks/:id/pause` | 暂停（保留断点） |
| POST | `/api/tasks/:id/resume` | 继续（断点续传） |
| POST | `/api/tasks/:id/retry` | 重试（清空断点） |
| POST | `/api/tasks/:id/delete` | 删除任务（含历史与临时文件） |

### 历史 / 文件

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET  | `/api/history` | 已完成下载历史 |
| DELETE | `/api/history/:taskId` | 删除单条下载历史 |
| GET  | `/api/parse-history` | 已解析过的链接列表 |
| DELETE | `/api/parse-history/:id` | 删除单条解析历史 |
| GET  | `/api/files` | 产物目录 |
| GET  | `/api/files/raw?path=...` | 产物文件下载（防目录穿越） |
| GET  | `/api/dirs?path=...` | 目录选择器：列出给定绝对目录的子目录（下载目录浏览；路径不存在/越界返回空） |

### 配置 / 登录态

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET  | `/api/config` | 读取全局设置 |
| PUT  | `/api/config` | 更新全局设置（含 advanced：代理 / CDN / ffmpeg 路径） |
| GET  | `/api/auth/status` | 登录态（SESSDATA cookie） |
| POST | `/api/auth` | 设置 SESSDATA |
| DELETE | `/api/auth` | 退出并清除登录态 |

> 登录支持 SESSDATA cookie 与扫码两种方式（用于稍后再看/历史/高画质/收藏夹）。
