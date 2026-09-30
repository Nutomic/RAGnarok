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

echo "==> running retrieval check"
docker compose run --rm app npm run cli -- check-retrieve

echo "==> verifying db content"
docs=$(docker compose exec -T db psql -U ragnarok -d ragnarok -tAc "SELECT count(*) FROM documents")
chunks=$(docker compose exec -T db psql -U ragnarok -d ragnarok -tAc "SELECT count(*) FROM chunks")
echo "documents=$docs chunks=$chunks"
[ "$docs" = "2" ] || { echo "expected 2 documents, got $docs"; exit 1; }
[ "$chunks" = "827" ] || { echo "expected 827 chunks, got $chunks"; exit 1; }

echo "==> checking chat api"
chat=$(curl -sS -N -X POST http://127.0.0.1:3000/api/chat \
  -H 'content-type: application/json' \
  -d '{"messages":[{"id":"q1","role":"user","parts":[{"type":"text","text":"Wie lange darf ein Unternehmen personenbezogene Daten speichern?"}]}]}')
echo "$chat" | grep -q '"type":"data-sources"' || { echo "chat api: no data-sources part"; exit 1; }
echo "$chat" | grep -q '#art_5' || { echo "chat api: no EUR-Lex anchor for Artikel 5"; exit 1; }
echo "$chat" | grep -q '"type":"text-delta"' || { echo "chat api: no streamed text"; exit 1; }
echo "$chat" | grep -q '"type":"finish"' || { echo "chat api: stream did not finish"; exit 1; }

echo "==> integration test passed"
