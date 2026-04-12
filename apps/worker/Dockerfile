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
COPY apps/worker/ apps/worker/

# Build the dependency chain for the worker explicitly.
# turbo's ^build handles ordering when running pnpm build at the root, but
# we run filters here to avoid building the web app in the worker image.
RUN pnpm --filter @eanhl/db build && \
    pnpm --filter @eanhl/ea-client build && \
    pnpm --filter @eanhl/worker build

# ── Runtime ───────────────────────────────────────────────────────────────────
EXPOSE 3001
ENV NODE_ENV=production
WORKDIR /app/apps/worker
CMD ["node", "dist/index.js"]
