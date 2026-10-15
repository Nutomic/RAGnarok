from pathlib import Path

import numpy as np
import onnxruntime as ort
from huggingface_hub import snapshot_download
from pydantic import BaseModel
from tokenizers import Tokenizer

DEFAULT_MODEL_REPO = "Xenova/multilingual-e5-base"
# e5 models need "query: " / "passage: " prefixes
MODEL_FILE = "onnx/model_quantized.onnx"
MAX_SEQ_LEN = 512


class EmbedResult(BaseModel):
    embedding: list[float]
    tokens: int


def _resolve_model_dir(repo: str, model_dir: str | None) -> Path:
    # local dir with the model files, or download them from the HF hub
    if model_dir is not None:
        return Path(model_dir)
    return Path(
        snapshot_download(
            repo, allow_patterns=["tokenizer.json", "tokenizer_config.json", MODEL_FILE]
        )
    )


class OnnxEmbedder:
    """Embedder reusing the exact ONNX q8 artifact the TS app (transformers.js)
    uses, so both services produce the same vectors — byte-identical model and
    tokenizer files, only the runtime differs. Loaded once at service start."""

    def __init__(self, tokenizer: Tokenizer, session: ort.InferenceSession) -> None:
        self._tokenizer = tokenizer
        self._session = session

    @classmethod
    def load(cls, repo: str = DEFAULT_MODEL_REPO, model_dir: str | None = None) -> "OnnxEmbedder":
        base = _resolve_model_dir(repo, model_dir)
        tokenizer = Tokenizer.from_file(str(base / "tokenizer.json"))
        tokenizer.enable_truncation(max_length=MAX_SEQ_LEN)
        session = ort.InferenceSession(
            str(base / MODEL_FILE), providers=["CPUExecutionProvider"]
        )
        return cls(tokenizer, session)

    def embed(self, text: str, mode: str = "passage") -> EmbedResult:
        enc = self._tokenizer.encode(f"{mode}: {text}")
        ids = np.array([enc.ids], dtype=np.int64)
        mask = np.array([enc.attention_mask], dtype=np.int64)
        hidden = self._session.run(None, {"input_ids": ids, "attention_mask": mask})[0][0]
        # one vector per token -> average into one sentence vector -> scale to length 1
        weights = mask[0][:, None].astype(np.float32)
        pooled = (hidden * weights).sum(axis=0) / np.clip(weights.sum(axis=0), 1e-9, None)
        embedding = pooled / np.linalg.norm(pooled)
        return EmbedResult(embedding=embedding.astype(np.float32).tolist(), tokens=len(enc.ids))


# Single instance, created in the FastAPI lifespan
_instance: OnnxEmbedder | None = None


def init_embedder() -> None:
    global _instance
    _instance = OnnxEmbedder.load()


def get_embedder() -> OnnxEmbedder:
    if _instance is None:
        raise RuntimeError("embedder not initialized")
    return _instance