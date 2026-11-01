FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
COPY apps ./apps
COPY packages ./packages
COPY tsconfig.json ./
COPY tests ./tests
COPY playwright.config.ts ./
RUN npm ci
RUN npm run build
FROM node:24-bookworm-slim
WORKDIR /app
COPY --from=build --chown=node:node /app /app
COPY --chown=node:node docs ./docs
RUN mkdir -p /app/var/media && chown -R node:node /app/var
USER node
ENV HOST=0.0.0.0 PORT=4100 SERVE_WEB=true
EXPOSE 4100
CMD ["npm","start"]
