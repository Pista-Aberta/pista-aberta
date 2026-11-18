FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY packages/shared/package.json packages/shared/
RUN npm install --workspace=@pista-aberta/api --workspace=@pista-aberta/shared --include-workspace-root \
  && (test ! -d apps/api/node_modules || cp -a apps/api/node_modules/. node_modules/) \
  && (test ! -d packages/shared/node_modules || cp -a packages/shared/node_modules/. node_modules/) \
  && test -d node_modules/drizzle-orm \
  && test -d node_modules/hono

FROM node:22-alpine AS runner
RUN apk add --no-cache tzdata openssl postgresql16-client
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/package.json ./package.json
COPY packages/shared ./packages/shared
COPY apps/api ./apps/api
# REVISION-36 H2 — censo OSM / listas INE (~500 KB) para setup e alta.
COPY data ./data
WORKDIR /app/apps/api
ENV FORCE_POSTGRES=1
ENV NODE_PATH=/app/node_modules
ENV TZ=Europe/Madrid
EXPOSE 3001
CMD ["sh", "-c", "npx tsx src/db/run-migrate.ts && npx tsx src/index.ts"]
