# ─── Stage 1: base ───────────────────────────────────────────────────────────
# Install node_modules once; reused by every subsequent stage.
FROM node:20-alpine AS base

# Build-time proxy support — pass via --build-arg or compose build.args.
# Only active during RUN steps (npm ci); not baked into image.
ARG HTTP_PROXY
ARG HTTPS_PROXY
ARG NO_PROXY

WORKDIR /app

# Install deps before copying source so this layer is cached until
# package.json / package-lock.json change.
COPY package.json package-lock.json ./
RUN npm ci --silent


# ─── Stage 2: dev ────────────────────────────────────────────────────────────
# Vite development server with HMR.
# Source code is bind-mounted at runtime (not copied), so changes on the host
# are immediately visible in the container.
#
# Usage (via docker-compose.dev.yml):
#   docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build
#
# The Vite proxy target is set via API_PROXY_TARGET so it resolves to the
# 'api' Docker service instead of localhost.
FROM base AS dev

# Expose Vite's default HMR port as well as the dev server port.
EXPOSE 5173
EXPOSE 24678

# 'vite' reads API_PROXY_TARGET at server-start time (not build time).
# Pass it via the 'environment:' block in docker-compose.dev.yml.
CMD ["npm", "run", "dev"]


# ─── Stage 3: build ──────────────────────────────────────────────────────────
# Compile TypeScript and bundle assets into /app/dist.
# VITE_API_URL is left empty so the browser calls /api/* (same-origin),
# which nginx will proxy to the FastAPI container.
FROM base AS build

COPY . .
RUN npm run build


# ─── Stage 4: production ─────────────────────────────────────────────────────
# Minimal nginx image — only the compiled static assets + nginx config.
FROM nginx:1.27-alpine AS production

# Remove the default nginx config
RUN rm /etc/nginx/conf.d/default.conf

# Copy the custom config (handles SPA routing and /api proxy)
COPY nginx.conf /etc/nginx/conf.d/templarc.conf

# Copy the Vite build output
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
