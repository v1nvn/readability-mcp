# syntax=docker/dockerfile:1

# Build stage installs the full (dev+prod) tree to run `vite build`. Uses
# `npm install`, not `npm ci`: package-lock.json is generated on darwin and
# omits linux-only optional build deps (@rolldown/binding-linux-* + @emnapi/*
# via Vite 8/rolldown), so `npm ci`'s strict completeness check fails on linux.
# `npm install` resolves the platform-correct bindings without that check.
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm install
COPY . .
RUN npm run build

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm install --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
ENV NODE_ENV=production
USER node
CMD ["node", "dist/index.js"]
