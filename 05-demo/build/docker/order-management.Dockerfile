# syntax=docker/dockerfile:1

ARG NODE_IMAGE=node:24.15.0-alpine3.23

FROM ${NODE_IMAGE} AS pnpm-base

WORKDIR /app/services/order-management
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH

RUN corepack enable && corepack prepare pnpm@10.30.0 --activate

FROM pnpm-base AS deps

COPY services/order-management/package.json services/order-management/pnpm-lock.yaml ./
RUN --mount=type=cache,id=pnpm-order-management,target=/pnpm/store \
  pnpm install --frozen-lockfile

FROM pnpm-base AS prod-deps

COPY services/order-management/package.json services/order-management/pnpm-lock.yaml ./
RUN --mount=type=cache,id=pnpm-order-management,target=/pnpm/store \
  pnpm install --prod --frozen-lockfile

FROM deps AS build

COPY services/order-management ./
RUN pnpm build

FROM ${NODE_IMAGE} AS runtime

WORKDIR /app/services/order-management
ENV NODE_ENV=production
ENV PORT=3000

RUN rm -rf \
  /opt/yarn* \
  /usr/local/bin/corepack \
  /usr/local/bin/npm \
  /usr/local/bin/npx \
  /usr/local/lib/node_modules/corepack \
  /usr/local/lib/node_modules/npm

COPY --from=prod-deps --chown=node:node /app/services/order-management/node_modules ./node_modules
COPY --from=build --chown=node:node /app/services/order-management/dist ./dist
COPY --from=build --chown=node:node /app/services/order-management/package.json ./package.json

USER node
EXPOSE 3000

CMD ["node", "dist/main.js"]
