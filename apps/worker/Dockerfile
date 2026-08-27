# PopDAM Cloud Worker
# Build: docker build -t popdam-worker .

# ── Stage 1: Build ────────────────────────────────────────────────────────────
FROM node:20-bookworm-slim AS builder

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json* ./
RUN npm ci

COPY tsconfig.json ./
COPY src/ ./src/
# Railway builds with apps/worker as the Docker context. Mirror the canonical
# shared tag contract at its monorepo-relative path so TypeScript and runtime
# imports resolve inside the isolated image build.
COPY vendor/tag-asset-contract.js /supabase/functions/_shared/tag-asset-contract.js
COPY vendor/tag-asset-contract.d.ts /supabase/functions/_shared/tag-asset-contract.d.ts
COPY vendor/tagging-metadata-policy.js /supabase/functions/_shared/tagging-metadata-policy.js
COPY vendor/tagging-metadata-policy.d.ts /supabase/functions/_shared/tagging-metadata-policy.d.ts
COPY vendor/tag-style-group-contract.js /supabase/functions/_shared/tag-style-group-contract.js
COPY vendor/tag-style-group-contract.d.ts /supabase/functions/_shared/tag-style-group-contract.d.ts
RUN npm run build

# Remove devDependencies
RUN npm prune --omit=dev

# ── Stage 2: Runtime ──────────────────────────────────────────────────────────
FROM node:20-bookworm-slim AS runtime

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    dumb-init \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /supabase /supabase

# Non-root user for security
RUN groupadd --system popdam && useradd --system --gid popdam popdam
USER popdam

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD node -e "process.exit(0)"

ENTRYPOINT ["dumb-init", "node", "dist/index.js"]
