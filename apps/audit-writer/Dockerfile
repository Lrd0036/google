FROM node:22-alpine@sha256:c610fcdfb1d5b4740dd70c284ed3cb16bb857e0f7166196e36a5501df7a3aa32 AS builder
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9.15.4 --activate
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json ./
COPY apps/audit-writer/ apps/audit-writer/
RUN pnpm install --frozen-lockfile
RUN pnpm --filter "@runbook/audit-writer" run build
RUN pnpm --filter "@runbook/audit-writer" deploy --prod /prod
FROM node:22-alpine@sha256:c610fcdfb1d5b4740dd70c284ed3cb16bb857e0f7166196e36a5501df7a3aa32
WORKDIR /app
ENV NODE_ENV=production
COPY --chown=node:node --from=builder /prod/ ./
USER node
EXPOSE 8080
CMD ["node", "dist/index.js"]
