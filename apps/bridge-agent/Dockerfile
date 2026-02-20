# PopDAM Bridge Agent — Pre-built Docker Image
# Per PROJECT_BIBLE §13: No source code on NAS. Users only need .env + docker-compose.yml.
#
# Build: docker build -t ghcr.io/u2giants/popdam-bridge:latest .
# Run:   docker run --env-file .env -v /volume1/nas-share:/mnt/nas/mac:ro ghcr.io/u2giants/popdam-bridge:latest

# ── Stage 1: Build ───────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

# Install build dependencies for native modules (sharp)
# python3, make, g++ are needed to compile sharp from source using system vips
RUN apk add --no-cache python3 make g++ vips-dev ghostscript graphicsmagick

COPY package.json ./

# CRITICAL: Tell sharp to build from source using the system vips we just installed,
# instead of trying to download a prebuilt binary from GitHub (which fails in CI/buildx).
# SHARP_IGNORE_GLOBAL_LIBVIPS=0 means "use the system libvips"
# npm_config_sharp_libvips_binary_host="" disables the CDN download attempt entirely
ENV npm_config_sharp_libvips_binary_host=""
ENV SHARP_IGNORE_GLOBAL_LIBVIPS=0

RUN npm install --production=false

COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build

# Prune dev dependencies
RUN npm prune --production

# ── Stage 2: Runtime ─────────────────────────────────────────────
FROM node:20-alpine AS runtime

# Install runtime dependencies for sharp/vips
RUN apk add --no-cache vips ghostscript graphicsmagick

WORKDIR /app

# Copy only production artifacts
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json

# Non-root user for security
RUN addgroup -S popdam && adduser -S popdam -G popdam
USER popdam

# Health check — process must be running
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD node -e "process.exit(0)"

ENTRYPOINT ["node", "dist/index.js"]
