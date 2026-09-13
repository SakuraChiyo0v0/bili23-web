# bili23-web Docker / NAS 部署

> 本目录是 NAS 部署的唯一入口（模板以 `deploy/` 为准，旧的
> `apps/web/docker-compose.nas.yml` 已删除，避免两处漂移）。
> 镜像 `ghcr.io/sakurachiyo0v0/bili23-web:latest` 由仓库 `.github/workflows/docker-image.yml`
> 在 push main 时自动构建并推送（构建使用 `apps/web/Dockerfile`，镜像内默认
> `BILI23_DATA_DIR=/data`，即数据落在容器 `/data`）。

## 文件说明

| 文件 | 作用 |
| --- | --- |
| `docker-compose.nas.yml` | 编排：端口 / 环境变量 / 数据挂载 / 健康检查 / watchtower 标签 |
| `.env.example` | 可覆盖项模板（`PORT` / `TZ` / `DOWNLOAD_DIR` / `BILI23_DATA_DIR`） |
| `README.md` | 本说明 |

## 一、目录准备（绿联 / 群晖等 Linux NAS）

SSH 登录 NAS，创建部署目录（`deploy/` 放编排文件，`data/` 放数据）：

```bash
ssh <用户名>@<NAS_IP>
sudo mkdir -p /volume1/docker/bili23-web/deploy /volume1/docker/bili23-web/data
```

把本仓库 `deploy/` 下的 `docker-compose.nas.yml`、`.env.example`、`README.md`
上传到 `/volume1/docker/bili23-web/deploy/`（SCP / SMB / File Station 均可）。

## 二、配置 .env（可选，默认值可直接跑）

需要覆盖默认配置时：

```bash
cd /volume1/docker/bili23-web
cp deploy/.env.example .env
# 编辑 .env，例如：TZ=Asia/Shanghai
chmod 600 .env   # 可选：收紧权限
```

可覆盖项（详见 `.env.example`）：

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `TZ` | `Asia/Hong_Kong` | 容器时区 |
| `PORT` | `8787` | 容器内监听端口（宿主访问端口固定 8788，通常不要改） |
| `DOWNLOAD_DIR` | `/data/downloads` | 下载产物目录（容器内，随 `./data` 落盘） |
| `BILI23_DATA_DIR` | `/data` | 数据根目录（容器内），须与 volumes 的 `/data` 对应，通常不要改 |

## 三、启动（首次会从 ghcr.io 拉取镜像）

```bash
cd /volume1/docker/bili23-web
sudo docker compose --project-directory /volume1/docker/bili23-web \
  -f deploy/docker-compose.nas.yml up -d
```

查看状态与日志：

```bash
sudo docker compose --project-directory /volume1/docker/bili23-web \
  -f deploy/docker-compose.nas.yml ps
sudo docker logs -f bili23-web
```

> 提示：如果不想用 `--project-directory` / `-f`，也可以把 `docker-compose.nas.yml`、
> `.env` 和 `data/` 放在同一个目录，然后在该目录直接执行
> `sudo docker compose up -d`（此时 `.env` 与 `./data` 都相对该目录解析）。

## 四、访问

浏览器打开 `http://<NAS_IP>:8788`（宿主端口 8788 → 容器 8787）。
如 8788 被占用，只改 compose 中 `ports` 左侧的宿主端口即可，`PORT` 保持 8787。

## 五、自动更新（watchtower）—— **实测已生效，push 即自动部署**

本项目的部署链路（2026-09-13 在 UGREEN DXP4800GT 上实测确认）：

```
push 到 main（改动落在 apps/web/** 或 packages/engine/** 或 lockfile 或本工作流）
   ↓  GitHub Actions「Build bili23-web image」构建并推送 ghcr.io/…:latest（约 1 分钟）
   ↓  NAS 上的 watchtower 每 5 分钟轮询一次
   ↓  发现新镜像 → SIGTERM 旧容器 → 用同一份 compose 配置重建容器
   ↓  数据在宿主 ./data（容器外），重建不丢
最坏情况 5 分钟内自动上线，不需要任何手动操作。
```

NAS 上 watchtower 的实际运行参数（2026-09-13 实测）：

| 环境变量 | 值 | 含义 |
| --- | --- | --- |
| `WATCHTOWER_POLL_INTERVAL` | `300` | 每 5 分钟轮询一次 |
| `WATCHTOWER_LABEL_ENABLE` | `true` | **只更新带 `com.centurylinklabs.watchtower.enable=true` 的容器**（本服务有这个标签）——同机其它服务（Authelia/Postgres 等）不受影响 |
| `WATCHTOWER_CLEANUP` | `true` | 更新后清理旧镜像 |

从 watchtower 日志能直接确认它干了活：

```bash
sudo docker logs watchtower --tail 200 | grep bili23
# 例：Found new ghcr.io/sakurachiyo0v0/bili23-web:latest image (…) → Stopping → Creating
```

### 怎么确认"新版本真的上线了"

不要只看容器状态（容器可能因为别的原因刚重启过，看起来像更新了）。按这个顺序验：

```bash
# 1) 前端构建 hash 变了没（和本地 dist/client/index.html 引用的 /assets/index-*.js 对比）
curl -s http://<NAS_IP>:8788/ | grep -o '/assets/index-[A-Za-z0-9_-]*\.js'
# 2) 新加的接口在不在、删掉的接口是否 404（例：/api/system/info 200、/api/fs/roots 404）
# 3) 容器创建时间
sudo docker inspect bili23-web --format '{{.Created}}'
```

### 手动更新 / 回滚（需要时）

```bash
# 手动更新（一般用不到）
cd /volume1/docker/bili23-web
sudo docker compose --project-directory /volume1/docker/bili23-web \
  -f deploy/docker-compose.nas.yml pull
sudo docker compose --project-directory /volume1/docker/bili23-web \
  -f deploy/docker-compose.nas.yml up -d

# 回滚：更新前把当前镜像另打一个 tag，出问题直接用它重建
sudo docker tag $(sudo docker inspect bili23-web --format '{{.Image}}') bili23-web:rollback
sudo docker tag bili23-web:rollback ghcr.io/sakurachiyo0v0/bili23-web:latest
sudo docker compose -f deploy/docker-compose.nas.yml up -d
```

> 注意：`bili23-web:rollback` 这个标签**只有手动脚本会刷新**；watchtower 自动更新时不会。
> 所以它一般指向"上一次手动更新前"的版本，别当成"上一个版本"用。

### 想让"push 完立刻部署"（不等那 5 分钟）

给 watchtower 开 HTTP API，CI 构建完直接触发一次：

```yaml
# docker-compose（watchtower）里加
environment:
  - WATCHTOWER_HTTP_API_UPDATE=true
  - WATCHTOWER_HTTP_API_TOKEN=<自定义 token>
ports:
  - "8080:8080"        # 仅内网
```
```yaml
# .github/workflows/docker-image.yml 末尾加一步
- name: Trigger watchtower
  run: curl -fsS -H "Authorization: Bearer ${{ secrets.WATCHTOWER_TOKEN }}" http://<NAS_IP>:8080/v1/update
```

**目前没配**（当前 5 分钟轮询已经够用，也少一个需要保管的 token）。

### 如果你在 NAS 上 pull 很慢（网络受限）

`ghcr.io`（GitHub 容器源）从部分 NAS 网络直拉**308MB 镜像**可能极慢甚至卡住。
南大镜像站 `ghcr.nju.edu.cn` 已同步本镜像（含 `latest` 与各 commit 的 tag，如 `78305cf...`）。

手动更新时若对 `ghcr.io` 拉不动，改用南大源拉取并重打标签给 compose 用：

```bash
cd /volume1/docker/bili23-web
# 1) 从南大源拉最新镜像（更快）
sudo docker pull ghcr.nju.edu.cn/sakurachiyo0v0/bili23-web:latest
# 2) 重打标签为 ghcr.io（compose 的 image 名），复用本地镜像，不再触发对 ghcr.io 的拉取
sudo docker tag ghcr.nju.edu.cn/sakurachiyo0v0/bili23-web:latest \
  ghcr.io/sakurachiyo0v0/bili23-web:latest
# 3) 重建容器（数据在宿主 ./data，不受影响）
sudo docker rm -f bili23-web
sudo docker compose --project-directory /volume1/docker/bili23-web \
  -f deploy/docker-compose.nas.yml up -d
```

> 注意：`ghcr.io` 与 `ghcr.nju.edu.cn` 是同一份镜像的不同域名，tag/ID 一致；
> 这只在 NAS 本地网络慢时用，不影响 CI（CI 始终推 `ghcr.io`）。

## 六、数据与备份

> ⚠️ 路径以**实测**为准（2026-09-13 在 UGREEN DXP4800GT 上 `docker inspect` 得到）：
> compose 用 `--project-directory /volume1/docker/bili23-web -f deploy/docker-compose.nas.yml` 启动时，
> `./data` 解析成 **`/volume1/docker/bili23-web/deploy/data`**（注意在 `deploy/` 下面）；
> 下载目录在该部署里是**另一个独立共享** `/volume1/bili23-downloads`（挂到容器的 `/data/bili23-downloads`）。
> 换机器/换目录前先 `sudo docker inspect bili23-web --format '{{range .Mounts}}{{.Source}} -> {{.Destination}}{{"\n"}}{{end}}'` 看清真实挂载。

| 路径（容器内） | 宿主（本部署实测） | 内容 |
| --- | --- | --- |
| `/data/config.json` | `/volume1/docker/bili23-web/deploy/data/config.json` | 设置（下载 / 界面等） |
| `/data/task.db` | `/volume1/docker/bili23-web/deploy/data/task.db` | SQLite 任务库（进行中任务 + 历史） |
| `/data/auth.json` | `/volume1/docker/bili23-web/deploy/data/auth.json` | B 站登录凭据（SESSDATA 等） |
| `/data/bili23-downloads/` | `/volume1/bili23-downloads/` | 下载产物（本部署的 `DOWNLOAD_DIR`） |

升级、迁移或备份只需保留这个 `data/` 目录；删除容器不影响数据。

## 安全建议

- 仅走内网 / 门户访问，不要把 8788 直接暴露到公网。