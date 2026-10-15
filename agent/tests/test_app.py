from agent.app import app


def test_app_exists() -> None:
    assert app.title == "RAGnarok agent"