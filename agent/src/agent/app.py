import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException

from agent.db import close_pool, init_pool
from agent.queries import document_count
from agent.settings import Settings

# healthcheck runs every 10s; log the error message only, not a traceback
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    await init_pool(Settings())  # type: ignore[call-arg]
    try:
        yield
    finally:
        await close_pool()


app = FastAPI(title="RAGnarok agent", lifespan=lifespan)


@app.get("/health")
async def health() -> dict[str, str]:
    try:
        await document_count()
    except Exception as e:
        logger.warning("health check DB query failed: %s", e)
        raise HTTPException(status_code=503, detail="database unavailable") from None
    return {"status": "ok"}