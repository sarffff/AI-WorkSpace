# syntax=docker/dockerfile:1

# ===== build：装依赖 → prisma generate → nest build =====
# 构建上下文必须是仓库根（pnpm-lock 与全部 workspace manifest 在根上）：
#   docker build -f apps/server/Dockerfile -t servicedesk-server .
# 或用 apps/server/docker-compose.yml 一键起（含 MySQL）。
FROM node:20-alpine AS build
RUN corepack enable
WORKDIR /repo

# 先只拷 manifest 与锁文件：源码变更不击穿依赖层缓存
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/server/package.json apps/server/
COPY apps/desktop/package.json apps/desktop/
COPY packages/config/package.json packages/config/
COPY packages/sdk/package.json packages/sdk/
COPY packages/shared/package.json packages/shared/
COPY packages/types/package.json packages/types/
COPY packages/ui/package.json packages/ui/

# 仅装 server 子图（frozen-lockfile：依赖必须与锁文件完全一致）
RUN pnpm install --filter @servicedesk/server --frozen-lockfile

COPY apps/server apps/server
RUN pnpm --filter @servicedesk/server exec prisma generate \
  && pnpm --filter @servicedesk/server build

# ===== runner =====
# 不做 node_modules 跨层精简：pnpm 的符号链接结构（node_modules → .pnpm store）
# 拆层拷贝即断链。整目录继承 build 层保证自洽；镜像瘦身留待 builder-runtime 改造。
# 镜像内含 prisma CLI（devDep），entrypoint 用它跑 migrate deploy，离线可用。
FROM node:20-alpine AS runner
ENV NODE_ENV=production
WORKDIR /repo
COPY --from=build /repo ./
COPY apps/server/docker-entrypoint.sh ./apps/server/docker-entrypoint.sh
RUN chmod +x /repo/apps/server/docker-entrypoint.sh

EXPOSE 4000
WORKDIR /repo/apps/server
ENTRYPOINT ["/repo/apps/server/docker-entrypoint.sh"]
