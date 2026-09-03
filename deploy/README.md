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

## 五、自动更新（watchtower）

容器已带 `com.centurylinklabs.watchtower.enable=true` 标签：

- 如果 NAS 已运行 watchtower，它会周期检查 `ghcr.io/sakurachiyo0v0/bili23-web:latest`，
  发现新镜像后自动重建容器；
- 数据因为挂载在宿主 `./data`，重建不会丢失；
- 如果没跑 watchtower，手动更新镜像：

```bash
cd /volume1/docker/bili23-web
sudo docker compose --project-directory /volume1/docker/bili23-web \
  -f deploy/docker-compose.nas.yml pull
sudo docker compose --project-directory /volume1/docker/bili23-web \
  -f deploy/docker-compose.nas.yml up -d
```

## 六、数据与备份

容器内数据根目录是 `/data`，挂载到宿主 `./data`（即 `/volume1/docker/bili23-web/data`）：

| 路径 | 内容 |
| --- | --- |
| `./data/config.json` | 设置（下载 / 界面等） |
| `./data/task.db` | SQLite 任务库（进行中任务 + 历史） |
| `./data/downloads/` | 下载产物 |

升级、迁移或备份只需保留这个 `data/` 目录；删除容器不影响数据。

## 安全建议

- 仅走内网 / 门户访问，不要把 8788 直接暴露到公网。