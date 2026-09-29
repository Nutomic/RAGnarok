# RAGnarok

DSGVO-first, permission-aware RAG assistant over a company's internal documents, on a single PostgreSQL (pgvector + German full-text search).

```bash
npm install
npm dev
```

Open http://localhost:3000.

Full stack (app + Postgres 17 pgvector + Langfuse):

```bash
cp .env.example .env   # fill in secrets
docker compose up -d
```

App on http://localhost:3000. Langfuse dashboard on http://localhost:3001.

Ingest the EUR-Lex corpus (DS-GVO + AI Act) into Postgres:

```bash
docker compose run --rm app npm run ingest
```

Idempotent: re-running skips already-ingested documents.
