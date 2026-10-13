## Retrieval strategies (golden set, n=23 answerable)
| Strategie | hit@5 | mrr@5 | context recall | SQL-Latenz (mean) |
|---|---|---|---|---|
| fts | 30% | 18% | 24% | 6.6ms |
| vector | 78% | 54% | 72% | 5.6ms |
| hybrid | 83% | 61% | 76% | 7.6ms |
| rerank | 78% | 63% | 76% | 4660.3ms |
_Embedding: 22.3ms mean (einmal pro Frage) · 2026-10-13T08:38:10.245Z_
## Generation (LLM-Judge, n=30)
| Modell | Strategie | faithfulness | relevancy | refusal rate |
|---|---|---|---|---|
| `ministral-14b-latest` | fts | 81% | 70% | 100% |
| `ministral-14b-latest` | vector | 89% | 75% | 100% |
| `ministral-14b-latest` | hybrid | 89% | 85% | 100% |
| `ministral-14b-latest` | rerank | 90% | 92% | 100% |
| `qwen3.5-9b-q8` | hybrid | 100% | 84% | 100% |
_Modelle: `ministral-14b-latest`, `qwen3.5-9b-q8` · Judge: `zai-org/GLM-5.3-Flash`_