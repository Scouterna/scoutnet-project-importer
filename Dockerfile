# Build stage: install all dependencies and build the frontend into dist/web.
FROM node:26-slim AS build
WORKDIR /app
RUN npm i -g pnpm@12.3.4
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build:web

# Runtime stage: production dependencies, server source and the built frontend.
FROM node:26-slim AS runtime
WORKDIR /app
RUN npm i -g pnpm@12.3.4
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --prod
COPY server/ ./server/
COPY shared/ ./shared/
COPY --from=build /app/dist/web ./dist/web
ENV NODE_ENV=production PORT=3000
EXPOSE 3000
USER node
CMD ["node", "server/index.ts"]
