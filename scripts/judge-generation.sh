#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

# Tier 2 eval: generation quality via LLM judge. Run locally on demand;
# results land in data/eval/generation.json (from judge-generation).

if [ ! -f .env ]; then
  echo "error: .env missing (needs MISTRAL_API_KEY)"; exit 1
fi
if [ -n "${MISTRAL_API_KEY:-}" ]; then
  sed -i "s|^MISTRAL_API_KEY=.*|MISTRAL_API_KEY=${MISTRAL_API_KEY}|" .env
fi

echo "==> building app image"
docker compose build app

echo "==> starting db"
docker compose up -d db
for _ in $(seq 1 30); do
  if docker compose exec -T db pg_isready -U ragnarok -d ragnarok >/dev/null 2>&1; then
    break
  fi
  sleep 2
done

echo "==> starting app (runs migrations on startup)"
docker compose up -d app
for _ in $(seq 1 30); do
  if docker compose logs app 2>&1 | grep -q "migrations applied"; then
    break
  fi
  sleep 2
done

echo "==> running ingest"
docker compose run --rm app npm run cli -- ingest
# The Danish dummy document only exists for the deletion-propagation test;
# judge metrics should measure the real corpus.
docker compose run --rm app npm run cli -- delete "DS-GVO (dansk udgave, uddrag)" || true

echo "==> running generation eval (tier 2)"
# Bind mount: the run container is ephemeral, results land directly in the repo.
for strategy in fts vector hybrid rerank; do
  docker compose run --rm -v "$(pwd)/data/eval:/app/data/eval" app npm run cli -- judge-generation "$strategy" | tee "/tmp/eval-output-$strategy.log"
done
# refresh the README table + graph from results.json (retrieval metrics merge
# in when evaluate-retrieval runs)
docker compose run --rm -v "$(pwd)/data/eval:/app/data/eval" app npm run cli -- eval-report

echo "==> generation eval done"
# Judge metrics are noisy; a LOW result annotates but never fails.
if grep -q "LOW" /tmp/eval-output-*.log; then
  echo "::warning::generation eval metrics below threshold"
fi
exit 0