## Retrieval strategies (golden set, n=23 answerable)
| Strategie | hit@5 | mrr@5 | context recall | SQL-Latenz (mean) |
|---|---|---|---|---|
| fts | 35% | 16% | 28% | 6.7ms |
| vector | 78% | 54% | 72% | 5.2ms |
| hybrid | 83% | 60% | 74% | 7.1ms |
| rerank | 78% | 63% | 76% | 4692.3ms |
_Embedding: 24.9ms mean (einmal pro Frage) · 2026-10-06T11:41:48.207Z_
## Generation (LLM-Judge, n=30)
| Strategie | faithfulness | relevancy | refusal rate |
|---|---|---|---|
| fts | 81% | 70% | 100% |
| vector | 89% | 75% | 100% |
| hybrid | 89% | 85% | 100% |
| rerank | 90% | 92% | 100% |
_Modell: `ministral-14b-latest` · Judge: `zai-org/GLM-5.3-Flash`_