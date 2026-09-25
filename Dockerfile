# Two images from one build:
#   runner - the Next.js standalone server that cms-web runs.
#   tools  - full node_modules plus scripts/, for db:migrate, db:seed and db:import-qubx. Those run
#            through tsx, which the standalone output does not carry.
#
# Build one with --target; the last stage (runner) is the default.

FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

FROM deps AS build
ENV NEXT_TELEMETRY_DISABLED=1
COPY . .
RUN npm run build

FROM deps AS tools
COPY . .
USER node

FROM node:24-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=3000 \
    UPLOAD_DIR=/data/uploads
# A new named volume copies the owner of the directory it is mounted over, so the node user can
# write uploads only if the directory already belongs to it here.
RUN mkdir -p /data/uploads && chown node:node /data/uploads
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
COPY --from=build --chown=node:node /app/public ./public
USER node
EXPOSE 3000
CMD ["node", "server.js"]
