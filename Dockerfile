# The built frontend as umiji-frontend.zip. CI replaces this stage with
# --build-context frontend-zip=<folder holding the zip>; otherwise it's downloaded from FRONTEND_URL.
FROM alpine:3.19 AS frontend-zip
ARG FRONTEND_URL=https://github.com/therewasluna/umiji-frontend/releases/latest/download/umiji-frontend.zip
RUN apk add --no-cache curl ca-certificates && curl -fL ${FRONTEND_URL} -o /umiji-frontend.zip

FROM alpine:3.19 AS frontend
WORKDIR /opt/frontend

ARG BRANCH=main
ARG SINGBOX_SCHEMA_URL=https://github.com/BlackDuty/sing-box-schema/releases/download/v1.13.13/schema.json
ARG MIHOMO_SCHEMA_URL=https://github.com/dongchengjie/meta-json-schema/releases/download/v1.19.29/meta-json-schema.json
# Xray config validator (WASM build of Xray-core) and its JSON schemas
ARG UMIJI_ASSETS_URL=https://github.com/therewasluna/umiji/releases/download/assets-1

COPY --from=frontend-zip /umiji-frontend.zip frontend.zip
RUN apk add --no-cache curl unzip ca-certificates \
    && unzip frontend.zip -d frontend_temp \
    && curl -fL ${UMIJI_ASSETS_URL}/wasm_exec.js -o frontend_temp/dist/assets/wasm_exec.js \
    && curl -fL ${UMIJI_ASSETS_URL}/xray.schema.json -o frontend_temp/dist/assets/xray.schema.json \
    && curl -fL ${UMIJI_ASSETS_URL}/xray.schema.cn.json -o frontend_temp/dist/assets/xray.schema.cn.json \
    && curl -L ${SINGBOX_SCHEMA_URL} -o frontend_temp/dist/assets/singbox.schema.json \
    && curl -L ${MIHOMO_SCHEMA_URL} -o frontend_temp/dist/assets/mihomo.schema.json \
    && curl -fL ${UMIJI_ASSETS_URL}/main.wasm -o frontend_temp/dist/assets/main.wasm

FROM node:24.22-trixie-slim AS backend-build
WORKDIR /opt/app

COPY package*.json ./
COPY vendor ./vendor
COPY patches ./patches
COPY prisma ./prisma
COPY rspack.config.mjs ./
COPY prisma.config.ts ./prisma.config.ts
COPY @types ./@types

RUN npm ci --prefer-offline --no-audit --no-fund

COPY tsconfig*.json ./
COPY src ./src
COPY libs ./libs

RUN npm run migrate:generate \
    && npm run generate:openapi \
    && test -s openapi.json \
    && npm run build \
    && npm prune --omit=dev \
    && npm cache clean --force

RUN cd node_modules/@prisma/client/runtime && \
    find . -maxdepth 1 -type f ! -name 'library.js' ! -name 'package.json' -delete && \
    cd /opt/app/node_modules/.prisma/client && \
    find . -maxdepth 1 -type f \
      \( -name 'edge.*' -o -name 'index-browser.js' -o -name 'wasm.*' \
         -o -name 'query_engine_bg.*' -o -name '*-loader.mjs' \) -delete && \
    cd /opt/app && \
    rm -rf node_modules/typescript \
           node_modules/effect/dist/esm \
           node_modules/effect/dist/dts \
           node_modules/effect/src && \
    find node_modules \( -name '*.js.map' -o -name '*.mjs.map' \) -delete && \
    find node_modules \( -name '*.d.ts' -o -name '*.d.cts' -o -name '*.d.mts' \) -delete

FROM node:24.22-trixie-slim

LABEL org.opencontainers.image.title="Umiji"
LABEL org.opencontainers.image.description="Powerful proxy management tool"
LABEL org.opencontainers.image.url="https://github.com/therewasluna/umiji-backend"
LABEL org.opencontainers.image.source="https://github.com/therewasluna/umiji-backend"
LABEL org.opencontainers.image.vendor="Umiji"
LABEL org.opencontainers.image.licenses="AGPL-3.0"
LABEL org.opencontainers.image.documentation="https://github.com/therewasluna/umiji"

WORKDIR /opt/app

ARG BRANCH=main
ARG __UMIJI_METADATA_VERSION=1.1.1
ARG __UMIJI_METADATA_GIT_BACKEND_COMMIT=0f344f388807f5323b49024a563b3f8146d66857
ARG __UMIJI_METADATA_GIT_FRONTEND_COMMIT=0f344f388807f5323b49024a563b3f8146d66857
ARG __UMIJI_METADATA_GIT_BRANCH=dev
ARG __UMIJI_METADATA_BUILD_TIME=2011-11-11T11:11:11Z
ARG __UMIJI_METADATA_BUILD_NUMBER=0

RUN apt-get update && apt-get install -y --no-install-recommends curl && rm -rf /var/lib/apt/lists/*

ENV UMIJI_BRANCH=${BRANCH}
ENV PRISMA_HIDE_UPDATE_MESSAGE=true
ENV PRISMA_ENGINES_CHECKSUM_IGNORE_MISSING=1
ENV PM2_DISABLE_VERSION_CHECK=true
ENV NODE_OPTIONS="--max-old-space-size=16384"
ENV __UMIJI_METADATA_VERSION=${__UMIJI_METADATA_VERSION}
ENV __UMIJI_METADATA_GIT_BACKEND_COMMIT=${__UMIJI_METADATA_GIT_BACKEND_COMMIT}
ENV __UMIJI_METADATA_GIT_FRONTEND_COMMIT=${__UMIJI_METADATA_GIT_FRONTEND_COMMIT}
ENV __UMIJI_METADATA_GIT_BRANCH=${__UMIJI_METADATA_GIT_BRANCH}
ENV __UMIJI_METADATA_BUILD_TIME=${__UMIJI_METADATA_BUILD_TIME}
ENV __UMIJI_METADATA_BUILD_NUMBER=${__UMIJI_METADATA_BUILD_NUMBER}

COPY --from=backend-build /opt/app/dist ./dist
COPY --from=backend-build /opt/app/openapi.json ./openapi.json
COPY --from=frontend /opt/frontend/frontend_temp/dist ./frontend
COPY --from=backend-build /opt/app/prisma/generated ./prisma/generated
COPY --from=backend-build /opt/app/prisma/migrations ./prisma/migrations
COPY --from=backend-build /opt/app/prisma/schema.prisma ./prisma/schema.prisma
COPY --from=backend-build /opt/app/node_modules ./node_modules

COPY configs /var/lib/umiji/configs
COPY package*.json ./
COPY prisma.config.ts ./prisma.config.ts
COPY ecosystem.config.js ./
COPY docker-entrypoint.sh docker-secrets.sh ./

RUN npm install -g pm2 \
    && rm -rf /usr/local/lib/node_modules/npm \
        /usr/local/lib/node_modules/corepack \
        /usr/local/bin/npm \
        /usr/local/bin/npx \
        /usr/local/bin/corepack \
        /usr/local/include/node

ENTRYPOINT [ "/bin/sh", "docker-entrypoint.sh" ]
CMD [ "pm2-runtime", "start", "ecosystem.config.js", "--env", "production" ]