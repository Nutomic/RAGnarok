#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

# Generate .env from the example if missing (CI has none).
if [ ! -f .env ]; then
  cp .env.example .env
  sed -i "s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=$(openssl rand -base64 24 | tr -d '/+=' | head -c 24)|" .env
  sed -i "s|^LANGFUSE_NEXTAUTH_SECRET=.*|LANGFUSE_NEXTAUTH_SECRET=$(openssl rand -base64 32)|" .env
  sed -i "s|^LANGFUSE_SALT=.*|LANGFUSE_SALT=$(openssl rand -base64 32)|" .env
  sed -i "s|^LANGFUSE_ENCRYPTION_KEY=.*|LANGFUSE_ENCRYPTION_KEY=$(openssl rand -hex 32)|" .env
  pk="pk-lf-$(cat /proc/sys/kernel/random/uuid)"
  sk="sk-lf-$(cat /proc/sys/kernel/random/uuid)"
  sed -i "s|^LANGFUSE_PUBLIC_KEY=.*|LANGFUSE_PUBLIC_KEY=$pk|" .env
  sed -i "s|^LANGFUSE_SECRET_KEY=.*|LANGFUSE_SECRET_KEY=$sk|" .env
fi

# CI provides the generation key via env var
if [ -n "${MISTRAL_API_KEY:-}" ]; then
  sed -i "s|^MISTRAL_API_KEY=.*|MISTRAL_API_KEY=${MISTRAL_API_KEY}|" .env
fi

echo "==> building app image"
docker compose build app

echo "==> starting full stack"
docker compose up -d

echo "==> waiting for app (runs migrations and langfuse bootstrap on startup)"
for _ in $(seq 1 60); do
  if [ "$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3000/api/stats)" = "200" ]; then
    break
  fi
  sleep 2
done

echo "==> running ingest"
docker compose run --rm app npm run cli -- ingest

echo "==> running retrieval check"
docker compose run --rm app npm run cli -- check-retrieval

echo "==> running retrieval eval (tier 1 gate)"
docker compose run --rm app npm run cli -- evaluate-retrieval

echo "==> verifying db content"
docs=$(docker compose exec -T db psql -U ragnarok -d ragnarok -tAc "SELECT count(*) FROM documents")
chunks=$(docker compose exec -T db psql -U ragnarok -d ragnarok -tAc "SELECT count(*) FROM chunks")
echo "documents=$docs chunks=$chunks"
[ "$docs" = "2" ] || { echo "expected 2 documents, got $docs"; exit 1; }
[ "$chunks" = "827" ] || { echo "expected 827 chunks, got $chunks"; exit 1; }

echo "==> checking chat api"
chat=$(curl -sS -N -X POST http://127.0.0.1:3000/api/chat \
  -H 'content-type: application/json' \
  -d '{"messages":[{"id":"q1","role":"user","parts":[{"type":"text","text":"Wie lange darf ein Unternehmen personenbezogene Daten speichern?"}]}],"profileId":"00000000-0000-0000-0000-000000000002"}')
echo "$chat" | grep -q '"type":"data-sources"' || { echo "chat api: no data-sources part"; exit 1; }
echo "$chat" | grep -q '#art_5' || { echo "chat api: no EUR-Lex anchor for Artikel 5"; exit 1; }
echo "$chat" | grep -q '"type":"text-delta"' || { echo "chat api: no streamed text"; exit 1; }
echo "$chat" | grep -q '"type":"finish"' || { echo "chat api: stream did not finish"; exit 1; }

# Permission demo: the default profile (no profileId) must not see DS-GVO.
chat_default=$(curl -sS -N -X POST http://127.0.0.1:3000/api/chat \
  -H 'content-type: application/json' \
  -d '{"messages":[{"id":"q2","role":"user","parts":[{"type":"text","text":"Wie lange darf ein Unternehmen personenbezogene Daten speichern?"}]}]}')
echo "$chat_default" | grep -q '32016R0679' && { echo "permissions: default profile saw DS-GVO"; exit 1; }
echo "permissions: default profile sees AI Act only"

echo "==> checking stats api"
sleep 5
stats=$(curl -sS http://127.0.0.1:3000/api/stats)
echo "$stats"
echo "$stats" | grep -q '"available":true' || { echo "stats api: unavailable"; exit 1; }
for field in answers retrievalSpans generations; do
  count=$(echo "$stats" | sed "s/.*\"$field\":\([0-9]*\).*/\1/")
  [ "$count" -ge 2 ] || { echo "stats api: expected >=2 $field, got $count"; exit 1; }
done
cost=$(echo "$stats" | sed 's/.*"avgCostEur":\([0-9.e-]*\).*/\1/')
awk "BEGIN{exit !($cost > 0)}" || { echo "stats api: expected non-zero avgCostEur, got $cost"; exit 1; }

echo "==> integration test passed"
