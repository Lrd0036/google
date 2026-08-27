FROM node:22-alpine AS builder
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9.15.4 --activate
COPY package.json pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/ packages/
COPY apps/broker/ apps/broker/
RUN pnpm install --frozen-lockfile
RUN pnpm --filter "@runbook/broker" run build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/package.json ./
COPY --from=builder /app/apps/broker/package.json ./apps/broker/
COPY --from=builder /app/apps/broker/dist/ ./apps/broker/dist/
COPY --from=builder /app/packages/types/ ./packages/types/
COPY --from=builder /app/node_modules/ ./node_modules/

EXPOSE 8080
CMD ["node", "apps/broker/dist/index.js"]
