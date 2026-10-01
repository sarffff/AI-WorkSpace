#!/bin/sh
# 容器入口：先应用迁移再启动。
# migrate deploy 只前滚 migrations/ 里已提交的 SQL（幂等），不做 dev 式的隐式建迁移；
# schema 与迁移不一致时直接失败，避免容器带着漂移的结构跑起来。
set -e

echo "[entrypoint] applying prisma migrations..."
npx prisma migrate deploy

echo "[entrypoint] starting server..."
exec node dist/src/main.js
