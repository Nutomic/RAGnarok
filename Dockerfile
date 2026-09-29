# syntax=docker/dockerfile:1

FROM node:22-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci && rm -rf node_modules/onnxruntime-web
# onnxruntime-web is the browser/WebGPU backend; Node uses onnxruntime-node.
# Dropping it saves ~140MB.

FROM node:22-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build && npm run build:ingest
RUN npm prune --omit=dev
EXPOSE 3000
CMD ["npm", "run", "start"]
