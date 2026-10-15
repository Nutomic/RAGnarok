# syntax=docker/dockerfile:1

FROM ghcr.io/astral-sh/uv:python3.13-bookworm-slim AS builder
WORKDIR /build
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy
COPY agent/pyproject.toml agent/uv.lock ./
COPY agent/src ./src
RUN uv sync --frozen --no-dev --no-install-project
# --no-editable: install the project as a real package into the venv, so the
# runner stage works without the /build source tree
RUN uv sync --frozen --no-dev --no-editable

FROM python:3.13-slim AS runner
WORKDIR /app
# curl for the compose healthcheck
RUN apt-get update && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --system agent && useradd --system --create-home --gid agent agent
# cache dir pre-created owned by agent: an empty named volume mounted here
# inherits image ownership instead of initializing as root
RUN mkdir -p /home/agent/.cache/huggingface && chown agent:agent /home/agent/.cache/huggingface
COPY --from=builder /build/.venv ./.venv
USER agent
EXPOSE 8000
# `python` must resolve to the venv interpreter (site-packages + uvicorn live there)
ENV PATH="/app/.venv/bin:$PATH"
# Launch via python -m: venv entrypoint shebangs point to the builder path
CMD ["python", "-m", "uvicorn", "agent.app:app", "--host", "0.0.0.0", "--port", "8000"]
