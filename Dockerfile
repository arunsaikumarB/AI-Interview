# Logisoft HireOS — Next.js (standalone)
FROM node:20-bookworm-slim AS deps
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci

FROM deps AS builder
WORKDIR /app
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npx prisma generate
RUN npm run setup:mediapipe
RUN npm run build
# Bundle pilot scripts for the slim runner (no tsx / @esbuild platform binary).
RUN mkdir -p dist/docker \
  && npx esbuild prisma/seed.ts \
    --bundle --platform=node --format=cjs \
    --external:@prisma/client \
    --outfile=dist/docker/seed.cjs \
  && npx esbuild scripts/backfill-embeddings.ts \
    --bundle --platform=node --format=cjs \
    --alias:@=./src \
    --external:@prisma/client \
    --outfile=dist/docker/backfill-embeddings.cjs

FROM node:20-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
ENV STORAGE_ROOT=/storage

RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/* \
  && groupadd --system --gid 1001 nodejs \
  && useradd --system --uid 1001 --gid nodejs nextjs \
  && mkdir -p /storage && chown -R nextjs:nodejs /storage

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/node_modules/prisma ./node_modules/prisma
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/dist/docker ./dist/docker
COPY --from=builder /app/node_modules/bcryptjs ./node_modules/bcryptjs
# Resume PDF parsing (pdf-parse → pdfjs-dist). Standalone trace omits worker files.
COPY --from=builder /app/node_modules/pdf-parse ./node_modules/pdf-parse
COPY --from=builder /app/node_modules/pdfjs-dist ./node_modules/pdfjs-dist
COPY --from=builder /app/node_modules/mammoth ./node_modules/mammoth
COPY docker/app/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh && chown -R nextjs:nodejs /app

USER nextjs
EXPOSE 3000
VOLUME ["/storage"]
ENTRYPOINT ["/entrypoint.sh"]
