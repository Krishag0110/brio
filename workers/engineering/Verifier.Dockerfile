FROM mcr.microsoft.com/playwright:v1.63.0-noble
COPY --from=oven/bun:1.4.2 /usr/local/bin/bun /usr/local/bin/bun
WORKDIR /app
COPY workers/social/package.json workers/social/bun.lock ./
RUN bun install --frozen-lockfile --production --ignore-scripts
COPY workers/shared ./workers/shared
COPY workers/engineering ./workers/engineering
USER pwuser
ENV NODE_ENV=production
EXPOSE 8081
CMD ["node", "--import", "tsx", "workers/engineering/weather-main.ts"]
