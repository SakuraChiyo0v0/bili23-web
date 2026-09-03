# 多阶段构建：monorepo 内构建 web，产出运行镜像（内置 ffmpeg）。
# 构建上下文必须是仓库根。用法：
#   docker build -f apps/web/Dockerfile -t bili23-web .

ARG NODE_BASE=node:22-alpine

FROM ${NODE_BASE} AS base
RUN corepack enable && apk add --no-cache python3 make g++
WORKDIR /repo
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml tsconfig.base.json ./
COPY packages ./packages
COPY apps/web ./apps/web

FROM base AS build
# 全量安装（含各包 devDeps），随后依次构建 engine 与 web
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @bili23-web/engine build
RUN pnpm --filter @bili23-web/web build

FROM base AS prod
# 只装生产依赖，保持 pnpm 布局；workspace 链接指向 /repo/packages
RUN pnpm install --filter @bili23-web/web... --prod --ignore-scripts --frozen-lockfile
COPY --from=build /repo/packages /repo/packages
COPY --from=build /repo/apps/web/dist /repo/apps/web/dist
RUN rm -rf /repo/packages/*/src /repo/packages/*/tests /repo/apps/web/src /repo/apps/web/tests

FROM ${NODE_BASE} AS runtime
WORKDIR /repo
ENV NODE_ENV=production
# 数据根目录固定到 /data（config.json / task.db / downloads），由 compose 挂载宿主 ./data 落盘
ENV BILI23_DATA_DIR=/data
RUN apk add --no-cache ffmpeg ca-certificates
COPY --from=prod /repo /repo
WORKDIR /repo/apps/web
EXPOSE 8787
CMD ["node", "dist/server/index.js"]