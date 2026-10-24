# Сайт «Карты пространства»: сборка Vite, раздаёт Caddy и проксирует API.
# Собирается из корня space-map: docker compose build web
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/map-core/package.json packages/map-core/
COPY services/api/package.json services/api/
COPY apps/web/package.json apps/web/
RUN npm ci -w apps/web -w packages/map-core --no-audit --no-fund
COPY tsconfig.base.json ./
COPY packages/map-core packages/map-core
COPY apps/web apps/web
RUN npx -w apps/web vite build

FROM caddy:2-alpine
COPY infra/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /app/apps/web/dist /srv
EXPOSE 80
