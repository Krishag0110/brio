FROM mcr.microsoft.com/playwright:v1.63.0-noble
COPY --from=oven/bun:1.4.2 /usr/local/bin/bun /usr/local/bin/bun
WORKDIR /runtime
COPY workers/engineering/runtime/package.json workers/engineering/runtime/bun.lock ./
RUN bun install --frozen-lockfile --ignore-scripts && ln -s /runtime/node_modules /node_modules
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
USER 1001:1001
WORKDIR /candidate
