# bili23-web（Web 端）

Hono 后端 + React 前端；引擎在 `packages/engine`（workspace 依赖）。

## 本地开发

```bash
pnpm install
pnpm dev            # server:8787 + client:5173（/api 代理）
```

## 生产构建与冒烟

```bash
pnpm --filter @bili23-web/web build
NODE_ENV=production PORT=8787 node dist/server/index.js
curl http://localhost:8787/api/health   # {"ok":true}
```

## NAS 自动部署（push → ghcr → watchtower）

改代码后 `git push` 到 main（命中 `apps/web/**` 或 `packages/engine/**`）→
`.github/workflows/docker-image.yml` 构建并推送
`ghcr.io/sakurachiyo0v0/bili23-web:{latest, <version>, <sha>}` →
NAS watchtower 检测到 latest digest 变化后自动重建。

### NAS 侧一次性部署（目录约定 /volume1/docker/bili23-web/）

```bash
sudo mkdir -p /volume1/docker/bili23-web/data
# docker-compose.yaml = docker-compose.nas.yml；.env 见 .env.example（chmod 600）
sudo chown -R root:root /volume1/docker/bili23-web
sudo chmod 700 /volume1/docker/bili23-web
sudo docker compose --project-directory /volume1/docker/bili23-web \
  -f /volume1/docker/bili23-web/docker-compose.yaml up -d
```

访问：http://<NAS_IP>:8788 （端口与 account-panel 的 8787 错开；只走内网/门户后，勿直接暴露公网）
