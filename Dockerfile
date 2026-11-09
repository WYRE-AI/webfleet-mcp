# node:22-alpine, pinned by manifest-list digest. Bump deliberately.
FROM node:22-alpine@sha256:0e1754758c2df4cfa3e68d59e2e1b7374bb7fd9ea6328eaaacf15cc934af8202 AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci --ignore-scripts

COPY tsconfig.json tsup.config.ts ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

FROM node:22-alpine@sha256:0e1754758c2df4cfa3e68d59e2e1b7374bb7fd9ea6328eaaacf15cc934af8202 AS production

RUN apk -U upgrade --no-cache \
  && addgroup -g 1001 -S webfleet \
  && adduser -S webfleet -u 1001 -G webfleet

WORKDIR /app

COPY --from=builder --chown=webfleet:webfleet /app/package.json ./
COPY --from=builder --chown=webfleet:webfleet /app/dist ./dist
COPY --from=builder --chown=webfleet:webfleet /app/node_modules ./node_modules

# npm/npx are not needed at runtime and carry their own CVE surface.
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx

USER webfleet

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://127.0.0.1:8080/health || exit 1

# 0.0.0.0 is safe only because startup refuses to listen without a real
# CONDUIT_S2S_SECRET, which is supplied at runtime by the platform and never
# baked into the image. AUTH_MODE=gateway never falls back to env credentials;
# the connection arrives per request on the X-Webfleet-Account, -Username,
# -Password, and -Api-Key headers. Every tool is read tier.
ENV NODE_ENV=production \
    LOG_LEVEL=info \
    MCP_TRANSPORT=http \
    MCP_HTTP_PORT=8080 \
    MCP_HTTP_HOST=0.0.0.0 \
    AUTH_MODE=gateway \
    WEBFLEET_TOOL_TIERS=read

CMD ["node", "dist/http.js"]

ARG VERSION="unknown"
ARG COMMIT_SHA="unknown"
ARG BUILD_DATE="unknown"

LABEL io.modelcontextprotocol.server.name="io.github.WYRE-AI/webfleet-mcp"
LABEL maintainer="engineering@wyre.ai"
LABEL version="${VERSION}"
LABEL description="Webfleet MCP Server - read-only Model Context Protocol server for Bridgestone Webfleet WEBFLEET.connect"
LABEL org.opencontainers.image.title="webfleet-mcp"
LABEL org.opencontainers.image.description="Read-only Model Context Protocol server for Bridgestone Webfleet WEBFLEET.connect"
LABEL org.opencontainers.image.version="${VERSION}"
LABEL org.opencontainers.image.created="${BUILD_DATE}"
LABEL org.opencontainers.image.revision="${COMMIT_SHA}"
LABEL org.opencontainers.image.source="https://github.com/WYRE-AI/webfleet-mcp"
LABEL org.opencontainers.image.documentation="https://github.com/WYRE-AI/webfleet-mcp/blob/main/README.md"
LABEL org.opencontainers.image.url="https://github.com/WYRE-AI/webfleet-mcp/pkgs/container/webfleet-mcp"
LABEL org.opencontainers.image.vendor="Wyre Technology"
LABEL org.opencontainers.image.licenses="MIT"
