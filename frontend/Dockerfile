# Build stage
FROM node:20-alpine AS builder

WORKDIR /app

# Copy the shared TypeScript source so the Vite alias resolves:
#   vite.config.ts: '@mgspe/shared-types' → path.resolve(__dirname, '../shared/src/index.ts')
# With frontend files at /app/frontend/, __dirname=/app/frontend and ../shared = /app/shared
COPY shared/src ./shared/src/

# Copy frontend package files and install dependencies
COPY frontend/package.json frontend/package-lock.json* ./frontend/
WORKDIR /app/frontend
RUN npm install

# Copy frontend source and config
COPY frontend/tsconfig.json frontend/tsconfig.node.json frontend/vite.config.ts frontend/index.html ./
# Always create public directory (even if empty) to avoid COPY errors
RUN mkdir -p public
COPY frontend/src ./src/
COPY frontend/public ./public/

# Build args for environment variables baked into the frontend
ARG VITE_API_URL=/api
ARG VITE_ENTRA_CLIENT_ID
ARG VITE_ENTRA_TENANT_ID
ARG VITE_ENTRA_FINANCE_DIRECTOR_GROUP_ID
ARG VITE_ENTRA_DIRECTOR_OF_SCHOOLS_GROUP_ID
ARG VITE_ENTRA_FOOD_SERVICES_PO_ENTRY_GROUP_ID
ARG VITE_ENTRA_PRINCIPALS_GROUP_ID
ARG VITE_ENTRA_VICE_PRINCIPALS_GROUP_ID

# Build the application with increased memory limit for large builds
RUN NODE_OPTIONS="--max-old-space-size=3072" npm run build

# Production stage - serve with Nginx
FROM nginx:alpine AS production

# Copy custom Nginx config (path relative to monorepo-root build context)
COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf

# Copy built files from builder (now at /app/frontend/dist)
COPY --from=builder /app/frontend/dist /usr/share/nginx/html

# Run as non-root
RUN chown -R nginx:nginx /usr/share/nginx/html && \
    chown -R nginx:nginx /var/cache/nginx && \
    chown -R nginx:nginx /var/log/nginx && \
    touch /var/run/nginx.pid && \
    chown -R nginx:nginx /var/run/nginx.pid

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:80/nginx-health || exit 1

CMD ["nginx", "-g", "daemon off;"]
