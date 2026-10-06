FROM node:22-slim AS base

RUN apt-get update -y \
    && apt-get install -y openssl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

FROM base AS deps

COPY package.json package-lock.json* ./

RUN npm ci

FROM base AS build

COPY --from=deps /app/node_modules ./node_modules
COPY . .

RUN npm run build

FROM base AS run

ENV NODE_ENV=production

COPY --from=build /app ./

EXPOSE 3000

CMD ["sh", "scripts/start.sh"]