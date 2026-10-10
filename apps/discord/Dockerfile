# Debian, not alpine: Playwright's Chromium needs glibc.
FROM node:22-bookworm-slim

RUN corepack enable

WORKDIR /app

# ── Install layer ─────────────────────────────────────────────────────────────
# Every workspace package.json must be present for --frozen-lockfile.
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/web/package.json apps/web/
COPY apps/worker/package.json apps/worker/
COPY apps/discord/package.json apps/discord/
COPY packages/db/package.json packages/db/
COPY packages/ea-client/package.json packages/ea-client/

RUN pnpm install --frozen-lockfile --filter "@eanhl/discord..."

# Headless Chromium only (--only-shell: launch() is headless; the full
# browser would add ~400 MB) + its OS libraries (root, so before USER node).
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
RUN cd apps/discord && pnpm exec playwright install --with-deps --only-shell chromium && \
    chmod -R a+rX /ms-playwright

# ── Build layer ───────────────────────────────────────────────────────────────
COPY tsconfig.base.json ./
COPY packages/ packages/
COPY apps/discord/ apps/discord/

RUN pnpm --filter @eanhl/db build && pnpm --filter @eanhl/discord build

# ── Runtime ───────────────────────────────────────────────────────────────────
ENV NODE_ENV=production
WORKDIR /app/apps/discord
USER node
CMD ["node", "dist/index.js"]
