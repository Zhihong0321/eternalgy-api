FROM node:22-alpine AS builder

WORKDIR /app

RUN corepack enable && corepack prepare pnpm@latest --activate

COPY package.json pnpm-lock.yaml tsconfig.json pnpm-workspace.yaml* .npmrc* ./

RUN pnpm config set strict-dep-builds false && pnpm install --frozen-lockfile

COPY src ./src

RUN pnpm run build

FROM node:22-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production

RUN corepack enable && corepack prepare pnpm@latest --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml* .npmrc* ./

RUN pnpm config set strict-dep-builds false && pnpm install --prod --frozen-lockfile

COPY --from=builder /app/dist ./dist
COPY public ./public

EXPOSE 3000

CMD ["node", "dist/index.js"]
