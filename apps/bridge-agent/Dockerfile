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
# Shared agent source; the prebuild script (../../packages/agent-common/sync.mjs,
# i.e. /packages from /app) copies it into src/common so tsc bundles it into dist.
COPY packages/agent-common /packages/agent-common
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

# Indra OCR (scanned-PDF text step; see src/common/indra-ocr.ts). Own venv, models
# baked into the image so the NAS never downloads at run time. Model license
# OpenRAIL-M (free under $20M revenue); code Apache-2.0.
RUN apt-get update && apt-get install -y --no-install-recommends python3 python3-venv \
  && rm -rf /var/lib/apt/lists/* \
  && python3 -m venv /opt/indra \
  && /opt/indra/bin/pip install --no-cache-dir indra-ocr==1.1.1 \
  && /opt/indra/bin/python -c "from huggingface_hub import snapshot_download; snapshot_download('datalab-to/indra-ocr', revision='v1.1.0', allow_patterns=['*.onnx','meta.json','lm.npz','lm_*.npz'], ignore_patterns=['math*.onnx','math_meta.json','model.safetensors'], local_dir='/opt/indra/models')" \
  && /opt/indra/bin/python -c "from indra_ocr import OrtOCR; OrtOCR('/opt/indra/models'); print('RUNTIME CHECK: indra-ocr OK')"
ENV INDRA_OCR_PYTHON=/opt/indra/bin/python
ENV INDRA_OCR_MODEL_DIR=/opt/indra/models

WORKDIR /app

# Copy only production artifacts
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/src/sg-eligibility-contract.json ./dist/sg-eligibility-contract.json
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json

# Verify path-filters survived into runtime stage
RUN node -e "require('@popdam/path-filters');console.log('RUNTIME CHECK: @popdam/path-filters OK');"
RUN node -e "import('./dist/sg-ingest-filter.js').then(()=>console.log('RUNTIME CHECK: eligibility contract OK'))"

# Bake build identity into an IMMUTABLE file (authoritative source at runtime).
# The self-updater's recreateViaDockerRun clones the previous container's env as `-e`
# overrides, which would freeze POPDAM_BUILD_SHA at the first image's value. A file in
# the image layer cannot be overridden by env-cloning, so the agent always reports the
# sha of the image it is actually running (see docs/KNOWN_QUIRKS.md #26 and index.ts
# readBuildInfo()). The ENV vars below are retained only as a legacy/dev fallback.
RUN printf '{"build_sha":"%s","image_tag":"%s"}\n' "${POPDAM_BUILD_SHA}" "${POPDAM_IMAGE_TAG}" > /app/build-info.json

# Inject version info as environment variables (fallback only — see build-info.json)
ENV POPDAM_IMAGE_TAG=${POPDAM_IMAGE_TAG}
ENV POPDAM_BUILD_SHA=${POPDAM_BUILD_SHA}

# Run as root to access Docker socket for self-update.
# This is a private NAS appliance, not a public-facing service.

HEALTHCHECK NONE

ENTRYPOINT ["dumb-init", "node", "dist/index.js"]
