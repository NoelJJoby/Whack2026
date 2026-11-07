FROM node:22-alpine
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --prod=false
COPY . .
RUN pnpm build
ENV NODE_ENV=production PORT=3010 SIM_STORE_DIR=/data/runs
EXPOSE 3010
VOLUME ["/data"]
CMD ["pnpm", "start"]
