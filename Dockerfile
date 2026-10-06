# syntax=docker/dockerfile:1

FROM node:26-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
# onnxruntime-web is the browser backend, we only need onnxruntime-node
RUN npm ci && rm -rf node_modules/onnxruntime-web

FROM node:26-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build && npm run build:cli
RUN npm prune --omit=dev
EXPOSE 3000
CMD ["npm", "run", "start"]
