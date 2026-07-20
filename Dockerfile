# syntax=docker/dockerfile:1

FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json yarn.lock .yarnrc.yml ./
RUN corepack enable && yarn install --immutable
COPY . .
RUN yarn build

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
COPY package.json yarn.lock .yarnrc.yml ./
RUN corepack enable && yarn workspaces focus --all --production && yarn cache clean
COPY --from=build /app/dist ./dist
ENV NODE_ENV=production
USER node
CMD ["node", "dist/index.js"]
