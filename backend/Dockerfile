# Build stage
FROM node:20-alpine AS builder

# Use /workspace as root so that 'file:../shared' in backend/package.json
# resolves to /workspace/shared from /workspace/backend.
WORKDIR /workspace

# ── Shared package ──────────────────────────────────────────────────────────
# Build shared first so @mgspe/shared-types is available when the backend
# TypeScript compiler runs and when production deps are installed.
COPY shared/package.json shared/package-lock.json* ./shared/
WORKDIR /workspace/shared
RUN npm install
COPY shared/src ./src/
COPY shared/tsconfig.json ./
RUN npm run build

# ── Backend ─────────────────────────────────────────────────────────────────
WORKDIR /workspace/backend

# Copy package files
COPY backend/package.json backend/package-lock.json* ./
COPY backend/prisma ./prisma/

# Install all dependencies (including dev for build)
RUN npm install

# Copy Prisma config after install to preserve layer cache
COPY backend/prisma.config.ts ./

# Generate Prisma client
RUN npx prisma generate

# Copy source
COPY backend/tsconfig.json ./
COPY backend/src ./src/

# Build TypeScript
RUN npm run build

# Production stage
FROM node:20-alpine AS production

WORKDIR /workspace

# ── Shared dist (needed at runtime — backend imports Zod schemas from it) ───
COPY --from=builder /workspace/shared/package.json ./shared/
COPY --from=builder /workspace/shared/dist ./shared/dist/
WORKDIR /workspace/shared
RUN npm install --omit=dev

# ── Backend production deps ─────────────────────────────────────────────────
WORKDIR /workspace/backend

# Copy package files and install production deps only
COPY backend/package.json backend/package-lock.json* ./
COPY backend/prisma ./prisma/
COPY backend/prisma.config.ts ./
RUN npm install --omit=dev

# Generate Prisma client in production image
RUN npx prisma generate

# Copy built output from builder
COPY --from=builder /workspace/backend/dist ./dist/

# Create logs directory
RUN mkdir -p logs

# Run as non-root
RUN addgroup -g 1001 -S appgroup && \
    adduser -S appuser -u 1001 -G appgroup && \
    chown -R appuser:appgroup /workspace
USER appuser

EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/health || exit 1

CMD ["node", "dist/server.js"]
