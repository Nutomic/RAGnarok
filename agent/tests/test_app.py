import pytest
from fastapi import HTTPException
from pydantic import ValidationError

from agent.app import app, health
from agent.settings import Settings


def test_app_exists() -> None:
    assert app.title == "RAGnarok agent"


def test_settings_requires_database_url(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("DATABASE_URL", raising=False)
    with pytest.raises(ValidationError):
        Settings()  # type: ignore[call-arg]


async def test_health_returns_503_without_db(monkeypatch: pytest.MonkeyPatch) -> None:
    async def fail() -> int:
        raise RuntimeError("no pool")

    monkeypatch.setattr("agent.app.document_count", fail)
    with pytest.raises(HTTPException) as exc_info:
        await health()
    assert exc_info.value.status_code == 503