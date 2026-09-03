# bili23-web

把桌面版 [Bili23-Downloader](https://github.com/ScottSloan/Bili23-Downloader)（Python + PySide6，v2.15.0）
**1:1 重做成 TypeScript Web 服务**，部署在绿联 NAS（DXP4800GT）上，通过网页完成解析、下载、附加内容与命名整理。

> 独立新仓库，不复用旧 TS SDK。功能基准 = 桌面版 Python 源码
> `C:\LocalSpace\Projects\Github-Proj\Bili23-Downloader`（行为参照，不复制代码）。

## 仓库结构

```
packages/engine/   全新 TS 下载引擎（解析/取流/下载/合并/附加内容/命名规则/登录态/存储）
apps/web/          Web 端：Hono 后端(REST+SSE) + React 前端
deploy/            Dockerfile / docker-compose.nas.yml / .env.example
.github/workflows/ push → ghcr 自动构建
docs/              设计文档与实施计划
```

## 本地开发

```bash
pnpm install
pnpm --filter @bili23-web/engine typecheck && pnpm --filter @bili23-web/engine test
pnpm --filter @bili23-web/web dev     # http://localhost:5173（Vite 代理 /api 到 8787）
```

## NAS 部署

见 `deploy/README.md` 与 `docs/design.md`（遵循 NAS-PROJECTS 模板：ghcr + watchtower + `./data` bind mount）。
