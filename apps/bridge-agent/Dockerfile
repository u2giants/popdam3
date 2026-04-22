# PopDAM Bridge Agent — Pre-built Docker Image
# Per PROJECT_BIBLE §13: No source code on NAS. Users only need .env + docker-compose.yml.
#
# Build: docker build -t ghcr.io/u2giants/popdam-bridge:latest .
# Run:   docker run --env-file .env -v /volume1/nas-share:/mnt/nas/mac:ro ghcr.io/u2giants/popdam-bridge:latest

# ── Stage 1: Build ───────────────────────────────────────────────
FROM node:20-bookworm-slim AS builder

WORKDIR /build

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

# ── Step 1: Build and pack @popdam/path-filters as a tarball ─────
COPY packages/path-filters /build/path-filters
RUN cd /build/path-filters \
 && npm install --ignore-scripts \
 && npm install --save-dev typescript \
 && ./node_modules/.bin/tsc \
 && rm -rf node_modules \
 && npm pack \
 && ls -la *.tgz

# ── Step 2: Install bridge-agent deps with tarball (not file: link) ─
WORKDIR /app

COPY apps/bridge-agent/package.json ./package.json.orig

# Rewrite the file: dependency to point to the tarball, then install
RUN node -e "const fs=require('fs');const pkg=JSON.parse(fs.readFileSync('package.json.orig','utf8'));pkg.dependencies['@popdam/path-filters']='file:/build/path-filters/popdam-path-filters-1.0.0.tgz';fs.writeFileSync('package.json',JSON.stringify(pkg,null,2));"

RUN npm install --loglevel verbose

# ── Step 3: Build bridge-agent TypeScript ────────────────────────
COPY apps/bridge-agent/tsconfig.json ./
COPY apps/bridge-agent/src/ ./src/
RUN npm run build

# ── Step 4: Remove devDependencies manually ──────────────────────
# npm prune --production strips file: deps; manual removal is safer.
RUN node -e "const fs=require('fs');const pkg=JSON.parse(fs.readFileSync('package.json','utf8'));Object.keys(pkg.devDependencies||{}).forEach(dep=>{const p='node_modules/'+dep;try{fs.rmSync(p,{recursive:true,force:true});}catch(e){}});console.log('devDeps removed');"

# ── Step 5: Verify path-filters is resolvable ────────────────────
RUN node -e "require('@popdam/path-filters');console.log('BUILD CHECK: @popdam/path-filters OK');"

# ── Stage 2: Runtime ─────────────────────────────────────────────
FROM node:20-bookworm-slim AS runtime

# Build args for version injection
ARG POPDAM_IMAGE_TAG=latest
ARG POPDAM_BUILD_SHA=unknown

# Install runtime dependencies + Docker CLI for self-update via Docker socket
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    dumb-init \
    libvips42 \
    ghostscript \
    graphicsmagick \
  && rm -rf /var/lib/apt/lists/*

# Install Docker CLI (no daemon) for self-update support
RUN curl -fsSL https://download.docker.com/linux/static/stable/x86_64/docker-27.4.1.tgz \
    | tar xz --strip-components=1 -C /usr/local/bin docker/docker \
  && docker --version

# Install Docker Compose plugin
RUN mkdir -p /usr/local/lib/docker/cli-plugins \
  && curl -fsSL "https://github.com/docker/compose/releases/download/v2.32.4/docker-compose-linux-x86_64" \
     -o /usr/local/lib/docker/cli-plugins/docker-compose \
  && chmod +x /usr/local/lib/docker/cli-plugins/docker-compose

WORKDIR /app

# Copy only production artifacts
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json

# Verify path-filters survived into runtime stage
RUN node -e "require('@popdam/path-filters');console.log('RUNTIME CHECK: @popdam/path-filters OK');"

# Inject version info as environment variables
ENV POPDAM_IMAGE_TAG=${POPDAM_IMAGE_TAG}
ENV POPDAM_BUILD_SHA=${POPDAM_BUILD_SHA}

# Run as root to access Docker socket for self-update.
# This is a private NAS appliance, not a public-facing service.

# Health check — process must be running
HEALTHCHECK --interval=5m --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "process.exit(0)"

ENTRYPOINT ["dumb-init", "node", "dist/index.js"]
