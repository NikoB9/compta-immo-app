FROM node:24-bookworm-slim AS dependencies
WORKDIR /app/web
COPY web/package.json web/package-lock.json ./
RUN npm ci

FROM node:24-bookworm-slim AS builder
WORKDIR /app
COPY --from=dependencies /app/web/node_modules ./web/node_modules
COPY . .
WORKDIR /app/web
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM node:24-bookworm-slim AS runner
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=3000 \
    PRIVATE_DOCUMENTS_DIR=/var/lib/compta-immo/documents
WORKDIR /app
RUN groupadd --system --gid 1001 nodejs \
    && useradd --system --uid 1001 --gid nodejs --home-dir /app --shell /usr/sbin/nologin nextjs \
    && mkdir -p /var/lib/compta-immo/documents \
    && chown -R nextjs:nodejs /var/lib/compta-immo
COPY --from=builder --chown=nextjs:nodejs /app/web/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/web/.next/static ./web/.next/static
COPY --from=builder --chown=nextjs:nodejs /app/web/public ./web/public
USER nextjs
EXPOSE 3000
CMD ["node", "web/server.js"]
