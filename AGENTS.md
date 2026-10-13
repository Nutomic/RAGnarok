# AGENTS.md

## Layout

The Node app lives in `app/` (`src`, `drizzle`, configs). The repo root holds deployment/meta files: `docker-compose.yml`, `docker/` (Dockerfile + init SQL), `scripts/` (integration + eval + benchmark scripts, git hooks), `data/` (corpus + eval artifacts + local model cache), `.env(.example)`, `mcp-server.mjs`, CI workflow, README, LICENSE, AGENTS.md. Run all npm commands from `app/`.

## Commands

Everything runs through docker compose; no local Node setup assumed.

```bash
cd app
npm run lint        # biome check . --error-onwarnings (CI gate)
npm run typecheck   # tsc --noEmit
npm run test        # vitest run (unit tests only, jsdom)
./scripts/integration-test.sh   # full stack: build, migrate, ingest, eval gate, chat API check (cd's to repo root itself)
npm run db:generate && npm run db:migrate   # drizzle schema change
npm run cli -- ingest | check-retrieval | evaluate-retrieval | judge-generation | eval-report
```

- `npm run cli` requires the built bundle: `npm run build:cli` first, and a running stack (`docker compose up -d` from the repo root).
- CI order: lint → typecheck → test (with `working-directory: app`), then a separate integration job running `scripts/integration-test.sh` (needs `MISTRAL_API_KEY` secret; real LLM calls).
- Pre-commit hook (`scripts/hooks/pre-commit`, wired via `npm run prepare` setting `core.hooksPath` to `scripts/hooks`): formats staged files with biome, re-stages them, and commits. It only covers files under `app/` (that's where biome.json lives); root files like `mcp-server.mjs` are not biome-formatted. Rejects only on `biome check` failures (fixable lint warnings are not auto-fixed).
- Biome expects a `.gitignore` inside `app/` (`vcs.useIgnoreFile` resolves it relative to `biome.json`); the root `.gitignore` covers `.env` and `app/` artifacts for git.

## Gotchas

- App startup applies migrations; chat API returns **503 on an empty index** until `cli ingest` has run (deliberate: no answers from parametric memory).
- Ingestion is idempotent (content-hash dedup); the corpus lives in `data/eurlex/`, eval golden set in `data/eval/golden.json`. The app reads `data/…` relative to `process.cwd()` — inside the container that is `/app`, where `COPY data/ ./data/` lands the corpus.
- The image build context is `.` (see `docker-compose.yml`); the Dockerfile at `docker/Dockerfile` copies `app/` (the Node code) plus `data/` (the corpus) into the image.
- Langfuse self-provisions from `.env` (`LANGFUSE_INIT_*`); the app waits for the key and seeds Mistral token prices on startup. Fresh install needs the keypair steps in README.
- `judge-generation` costs money (LLM judge) and is run locally on demand via `scripts/judge-generation.sh`, never in CI. `evaluate-retrieval` is the CI gate.
- Local inference (`GENERATION_PROVIDER=local` + `docker compose --profile local up -d`): llama.cpp server on AMD ROCm; all GPU/model values live in `.env` (`INFERENCE_*`, `GPU_*`), compose carries no defaults. `scripts/benchmark-local.sh` (manual, llama-bench matrix) finds optimal model/args for `INFERENCE_ARGS`.
- Generation eval results are split per provider: `data/eval/mistral-generation.json` (all strategies) and `data/eval/local-generation.json` (hybrid only — local benchmarks against the mistral hybrid numbers). `eval-report` joins both for the README comparison table + `generation.svg`. Judge calls run with concurrency 4 (`mapConcurrent`); `generateText` answer generation stays sequential because Mistral rate-limits.
- The RX 6700 XT (gfx1031) needs `HSA_OVERRIDE_GFX_VERSION=10.3.0` for ROCm. Keep the serving context ≤12k: the RAG prompt carries 5 retrieved chunks (~10k tokens) and the card is shared with the desktop (12 GB total; 12k ctx + 9B model ≈ 8.5 GB).
- Integration test asserts exact counts (3 documents incl. a Danish extract, 840 chunks before the built-in delete step; 2 documents / 827 chunks after) — ingest or chunking changes will break it; update deliberately.
- Migrations: `db:generate` may prompt interactively (TTY required) for renames/ambiguous diffs; in a non-TTY shell it fails. Migration 0006 was hand-written for exactly that reason: edit the generated SQL + snapshot (`app/drizzle/meta/0006_*.json`), keep the `prevId` → `id` chain intact, append the journal entry, then validate with `npm run db:generate` printing "No schema changes". Never edit a migration that is already applied to an existing volume — the migrator tracks counts, not content hashes, so changed SQL is silently skipped; wipe the volume (`docker compose down -v`) instead.

## Conventions

- TypeScript `strict`, biome, no unused deps. Hand-written SQL is intentional (drizzle for schema only) — don't replace retrieval SQL with an ORM query builder. All SQL lives in `src/db/` (one module per concern: `retrieve.ts`, `documents.ts`, `audit.ts`, `cache.ts`, …); routes/pages/CLI never query the DB directly, they call those modules.
- No comments restating code; comment only non-obvious why.
- No AI attribution in commits (`Co-Authored-By:` etc.), no tool dirs (`.claude/`, `.cursor/`) — see `rules-programming.md` §2.
- README is frozen until the ship slice: minimal one-liner + commands only, no feature sections.
- UI must follow `rules-programming.md` §5 (stone/emerald theme, flat colors, no shadcn defaults, no template skeleton).