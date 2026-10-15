import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException

from agent.db import close_pool, init_pool
from agent.embedder import get_embedder, init_embedder
from agent.queries import document_count
from agent.settings import Settings

# healthcheck runs every 10s; log the error message only, not a traceback
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    settings = Settings()  # type: ignore[call-arg]
    await init_pool(settings)
    init_embedder()
    try:
        yield
    finally:
        await close_pool()


app = FastAPI(title="RAGnarok agent", lifespan=lifespan)


@app.get("/health")
async def health() -> dict[str, str]:
    try:
        await document_count()
        # full embed: proves the whole inference path, not just that the
        # instance exists; ~10 ms is nothing against the 10 s interval
        get_embedder().embed("health")
    except Exception as e:
        logger.warning("health check failed: %s", e)
        raise HTTPException(status_code=503, detail="service not ready") from None
    return {"status": "ok"}