from agent.app import HealthResponse, app, health


def test_health() -> None:
    assert health() == HealthResponse(status="ok")


def test_app_exists() -> None:
    assert app.title == "RAGnarok agent"