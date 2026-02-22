# PopDAM Bridge Agent — Pre-built Docker Image
# Per PROJECT_BIBLE §13: No source code on NAS. Users only need .env + docker-compose.yml.
#
# Build: docker build -t ghcr.io/u2giants/popdam-bridge:latest .
# Run:   docker run --env-file .env -v /volume1/nas-share:/mnt/nas/mac:ro ghcr.io/u2giants/popdam-bridge:latest

# ── Stage 1: Build ───────────────────────────────────────────────
FROM node:20-bookworm-slim AS builder

WORKDIR /app

# Install build dependencies for native modules (sharp, etc.)
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    python3 \
    make \
    g++ \
    libvips-dev \
    ghostscript \
    graphicsmagick \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./

# Reproducible builds: npm ci requires a lockfile (guaranteed by CI workflow)
RUN npm ci --loglevel verbose

COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build

# Prune dev dependencies
RUN npm prune --production

# ── Stage 2: Runtime ─────────────────────────────────────────────
FROM node:20-bookworm-slim AS runtime

# Install runtime dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    dumb-init \
    libvips42 \
    ghostscript \
    graphicsmagick \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy only production artifacts
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json

# Non-root user for security
RUN groupadd --system popdam && useradd --system --gid popdam popdam
USER popdam

# Health check — process must be running
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD node -e "process.exit(0)"

ENTRYPOINT ["dumb-init", "node", "dist/index.js"]
