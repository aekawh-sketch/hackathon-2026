# API «Карты пространства»: Fastify + ядро карты, TypeScript запускается через tsx.
# Собирается из корня space-map: docker compose build api
FROM node:22-bookworm-slim AS deps
WORKDIR /app
# Сначала только манифесты: зависимости пересобираются, лишь когда меняются они.
COPY package.json package-lock.json ./
COPY packages/map-core/package.json packages/map-core/
COPY services/api/package.json services/api/
COPY apps/web/package.json apps/web/
RUN npm ci -w services/api -w packages/map-core --omit=dev --no-audit --no-fund

FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY packages/map-core packages/map-core
COPY services/api services/api
WORKDIR /app/services/api
EXPOSE 8080
# Миграции — при старте сервера. Задан DEMO_PASSWORD — сначала демо-организатор и опубликованная площадка demo
# (повторный запуск ничего не удаляет).
CMD ["sh", "-c", "if [ -n \"$DEMO_PASSWORD\" ]; then /app/node_modules/.bin/tsx src/seed.ts; fi; exec /app/node_modules/.bin/tsx src/server.ts"]
