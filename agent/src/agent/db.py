from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from psycopg import AsyncConnection
from psycopg_pool import AsyncConnectionPool

from agent.settings import Settings

# The agent connects as the same (writable) user as the TS app, so read-only
# is enforced here via server-side connection options.
_POOL_OPTIONS = "-c default_transaction_read_only=on -c statement_timeout=10000"
_pool: AsyncConnectionPool[AsyncConnection] | None = None


async def init_pool(settings: Settings) -> None:
    global _pool
    _pool = AsyncConnectionPool(
        settings.database_url, open=True, min_size=1, max_size=5, kwargs={"options": _POOL_OPTIONS}
    )
    await _pool.wait()


async def close_pool() -> None:
    global _pool
    if _pool is not None:
        await _pool.close()
        _pool = None


def pool() -> AsyncConnectionPool[AsyncConnection]:
    if _pool is None:
        raise RuntimeError("connection pool not initialized")
    return _pool


@asynccontextmanager
async def connection() -> AsyncIterator[AsyncConnection]:
    async with pool().connection() as conn:
        yield conn