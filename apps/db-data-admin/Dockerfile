FROM node:24-alpine AS build
WORKDIR /app
ARG VITE_BUILD_SHA=unknown
ARG VITE_BUILD_DATE=unknown
ENV VITE_BUILD_SHA=$VITE_BUILD_SHA
ENV VITE_BUILD_DATE=$VITE_BUILD_DATE
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM nginx:1.29-alpine
ENV NGINX_ENVSUBST_FILTER=^DB_DATA_ADMIN_
# nginx's envsubst helper only replaces variables that exist in the container
# environment. Production deliberately omits this development-only switch, so
# define the safe disabled value or nginx treats the leftover placeholder as an
# unknown nginx variable and refuses to start.
ENV DB_DATA_ADMIN_ALLOW_PASSWORD_LOGIN=""
COPY nginx.conf /etc/nginx/templates/default.conf.template
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1/health || exit 1
