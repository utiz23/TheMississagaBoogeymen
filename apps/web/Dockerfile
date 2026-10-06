FROM node:22-alpine

# Use the exact pnpm version declared in package.json#packageManager.
RUN corepack enable

WORKDIR /app

# ── Install layer (cached until lock file or any package.json changes) ────────
# All workspace package.json files must be present so pnpm can resolve the
# full workspace graph and honour --frozen-lockfile.
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/web/package.json apps/web/
COPY apps/worker/package.json apps/worker/
COPY packages/db/package.json packages/db/
COPY packages/ea-client/package.json packages/ea-client/

RUN pnpm install --frozen-lockfile

# ── Build layer ───────────────────────────────────────────────────────────────
COPY tsconfig.base.json ./
COPY packages/ packages/
COPY apps/web/ apps/web/

# @eanhl/db and @eanhl/ea-client are listed as serverExternalPackages in
# next.config.ts, so Next.js does not bundle them. They must be compiled
# before next build attempts to load them during pre-rendering.
RUN pnpm --filter @eanhl/db build && \
    pnpm --filter @eanhl/ea-client build

# DATABASE_URL is not available at image build time — there is no live DB
# during docker build. A placeholder URL allows the DB client module to
# initialise (postgres.js connects lazily, not at pool creation time).
# Pages that run queries against the placeholder receive connection errors,
# which they handle with try/catch and render as honest empty states.
# The real DATABASE_URL is injected at runtime by Docker Compose.
ARG DATABASE_URL=postgresql://placeholder:5432/placeholder
# The runtime user must own .next: pages with `revalidate` are regenerated into
# it, and the image-optimizer cache lives in .next/cache. The chown shares the
# build's layer — in its own RUN it would copy all of .next into a second layer.
RUN DATABASE_URL="${DATABASE_URL}" pnpm --filter @eanhl/web build && \
    chown -R node:node apps/web/.next

# ── Runtime ───────────────────────────────────────────────────────────────────
EXPOSE 3000
ENV NODE_ENV=production
WORKDIR /app/apps/web
# The base image's unprivileged `node` user (uid 1000), not root. Everything
# outside .next stays root-owned and read-only to the server.
USER node
CMD ["node_modules/.bin/next", "start"]
