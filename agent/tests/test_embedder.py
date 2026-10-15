import json
import os
from pathlib import Path

import pytest

from agent.embedder import OnnxEmbedder

# TS transformers.js reference vectors, dumped from app/src/ingest/embed.ts
REFERENCE = json.loads((Path(__file__).parent / "ts-embeddings.json").read_text())
# onnxruntime CPU vs onnxruntime-web WASM differ in float accumulation order;
# 1e-4 per dimension keeps rankings effectively identical
TOLERANCE = 1e-4

# local checkout of the TS node_modules model cache; parity test only runs
# where those files exist (CI downloads via HF hub into the default cache
# only when running the live parity job, not unit tests)
LOCAL_MODEL_DIR = Path(
    os.environ.get(
        "EMBEDDING_MODEL_DIR",
        "/home/felix/workspace/ragnarok/app/node_modules/@huggingface/transformers/.cache/Xenova/multilingual-e5-base",
    )
)


@pytest.fixture(scope="module")
def embedder() -> OnnxEmbedder:
    if not (LOCAL_MODEL_DIR / "tokenizer.json").exists():
        pytest.skip(f"model files not found at {LOCAL_MODEL_DIR}")
    return OnnxEmbedder.load(model_dir=str(LOCAL_MODEL_DIR))


@pytest.mark.parametrize("i", range(len(REFERENCE)))
def test_matches_ts_reference(embedder: OnnxEmbedder, i: int) -> None:
    case = REFERENCE[i]
    result = embedder.embed(case["text"], mode=case["mode"])
    assert result.tokens == case["tokens"]
    assert len(result.embedding) == len(case["embedding"])
    for got, want in zip(result.embedding, case["embedding"], strict=True):
        assert abs(got - want) < TOLERANCE