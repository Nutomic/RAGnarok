# RAGnarok

DSGVO-first, permission-aware RAG assistant over a company's internal documents, on a single PostgreSQL (pgvector + German full-text search). One `docker compose up`.

Working title, repo under construction. This is slice 0: the Next.js scaffold with strict TypeScript, biome and vitest. The retrieval pipeline, evals and observability land in later slices.

## Status

- [x] Next.js (App Router) scaffold, boilerplate removed
- [x] Strict TypeScript, biome, vitest
- [ ] Ingestion pipeline (EUR-Lex DS-GVO + AI Act)
- [ ] Hybrid retrieval (pgvector + `tsvector german` + RRF)
- [ ] Chat UI with citations
- [ ] Permission-aware retrieval
- [ ] Eval harness + CI gate
- [ ] Langfuse observability
- [ ] Deletion propagation + audit trail

## Quickstart

```bash
npm install
npm run dev
```

Open http://localhost:3000.

## Scripts

```bash
npm run dev        # dev server
npm run build      # production build
npm run typecheck  # tsc --noEmit
npm run lint       # biome check
npm run test       # vitest
```

## Honest limits

Nothing works yet beyond the scaffold. No retrieval, no numbers, no demo. That is the point of building in slices: each one leaves the repo runnable and public.
