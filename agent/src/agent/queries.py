from dataclasses import dataclass
from datetime import datetime

from agent.db import connection


@dataclass(frozen=True, slots=True)
class Document:
    id: str
    title: str
    celex: str | None
    visibility: str
    created_at: datetime


async def document_count() -> int:
    async with connection() as conn:
        row = await conn.execute("SELECT count(*) FROM documents")
        result = await row.fetchone()
        return int(result[0]) if result is not None else 0


async def list_documents(limit: int = 20) -> list[Document]:
    async with connection() as conn:
        cur = await conn.execute(
            """
            SELECT id, title, celex, visibility::text, created_at
            FROM documents
            ORDER BY created_at DESC
            LIMIT %s
            """,
            (limit,),
        )
        return [
            Document(
                id=str(row[0]),
                title=row[1],
                celex=row[2],
                visibility=row[3],
                created_at=row[4],
            )
            for row in await cur.fetchall()
        ]