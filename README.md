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
docker compose run --rm app npm run cli -- ingest
```

Idempotent: re-running skips already-ingested documents.
