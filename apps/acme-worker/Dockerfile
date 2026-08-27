FROM node:22-alpine AS builder
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9.15.4 --activate
COPY package.json pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/ packages/
COPY apps/acme-worker/ apps/acme-worker/
RUN pnpm install --frozen-lockfile
RUN pnpm --filter "@runbook/acme-worker" run build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/package.json ./
COPY --from=builder /app/apps/acme-worker/package.json ./apps/acme-worker/
COPY --from=builder /app/apps/acme-worker/dist/ ./apps/acme-worker/dist/
COPY --from=builder /app/packages/types/ ./packages/types/
COPY --from=builder /app/node_modules/ ./node_modules/

EXPOSE 8080
CMD ["node", "apps/acme-worker/dist/index.js"]
