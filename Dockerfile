# PopDAM Frontend — static SPA served by nginx
# Build: docker build -t popdam-frontend .

# ── Stage 1: Build ────────────────────────────────────────────────────────────
FROM node:20-bookworm-slim AS builder

WORKDIR /app

# Build-time metadata (passed via --build-arg from CI; falls back to "unknown")
ARG APP_COMMIT=unknown
ARG APP_DATE=unknown
ENV APP_COMMIT=${APP_COMMIT}
ENV APP_DATE=${APP_DATE}

COPY package.json package-lock.json* bun.lockb* ./
RUN npm ci

COPY . .
RUN npm run build

# ── Stage 2: Runtime ──────────────────────────────────────────────────────────
FROM nginx:1.27-alpine AS runtime

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/dist /usr/share/nginx/html

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD wget -q --spider http://localhost/ || exit 1

CMD ["nginx", "-g", "daemon off;"]