# RAGnarok

DSGVO-first, permission-aware RAG assistant over a company's internal documents, on a single PostgreSQL (pgvector + German full-text search).

## Evaluation

![Bar graph visualizing the metrics below](data/eval/eval-results.svg)

| Metrik | Wert | Bedeutung |
|---|---|---|
| hit_at_5 | 70% | erwarteter Artikel/Erwägungsgrund in Top 5 |
| mrr_at_5 | 46% | mittlere Position des ersten Treffers |
| context_recall | 87% | Anteil aller erwarteten Abschnitte gefunden |
| faithfulness | 92% | Anteil belegter Aussagen (LLM-Judge) |
| relevancy | 85% | Antwort beantwortet die Frage (LLM-Judge) |
| refusal_rate | 100% | Abstention-Fragen korrekt abgelehnt |

_Modell: `ministral-14b-latest` · Judge: `zai-org/GLM-5.3-Flash` · Commit: `be9f3e97a`_

## Development

Everything runs via docker compose, no local Node setup:

```bash
cp .env.example .env   # fill in secrets, see Langfuse setup below
docker compose up -d
```

App on http://localhost:3000, Langfuse dashboard on http://localhost:3001.
First start applies migrations, ingests nothing: the chat API returns 503 with
the ingest command until the corpus is loaded, because an empty index would
make the model answer from parametric memory instead of refusing.

Ingest the EUR-Lex corpus (DS-GVO + AI Act):

```bash
docker compose run --rm app npm run cli -- ingest
```

Idempotent: re-running skips already-ingested documents. The same CLI runs the
evals (`evaluate-retrieval`, `judge-generation`, `eval-report`).

### Langfuse setup

Langfuse provisions itself from `.env`: the compose file passes the API key
(`LANGFUSE_INIT_*`) into the Langfuse container, which creates org `ragnarok`,
project `RAGnarok` and the key on startup. The app waits for that key, seeds the
Mistral token prices (cost per answer) and starts tracing every chat request
(retrieval span + generation span).

Manual steps on a fresh install:

1. Generate the keypair into `.env` (two uuids):

   ```bash
   echo "LANGFUSE_PUBLIC_KEY=pk-lf-$(cat /proc/sys/kernel/random/uuid)"
   echo "LANGFUSE_SECRET_KEY=sk-lf-$(cat /proc/sys/kernel/random/uuid)"
   ```

2. Optional UI login (owner of the provisioned org), set in `.env`:

   ```
   LANGFUSE_INIT_USER_EMAIL=you@example.com
   LANGFUSE_INIT_USER_PASSWORD=at-least-8-chars
   ```

3. `docker compose up -d` — dashboard at http://localhost:3001, project
   `RAGnarok`. Without the init user, tracing still works but nobody can log
   into the UI.

The stats line under each answer and the p95/cost chip in the header read
Langfuse via `/api/stats`. Keys stay in `.env`, they grant trace read access.
