#!/usr/bin/env bash
# Quick local-inference benchmark: llama-bench over a small model/args matrix
# to find the optimal quant + flags for INFERENCE_ARGS. Manual, not CI.
#
# Run from the repo root:
#   ./scripts/benchmark-local.sh
#
# GPU passthrough and ROCm env come from .env (same values the inference
# service uses). Models download once into the shared LLAMA_CACHE volume.
set -euo pipefail
cd "$(dirname "$0")/.."

if [ ! -f .env ]; then
  echo "error: .env missing (INFERENCE_* vars needed)"; exit 1
fi
# shellcheck disable=SC1091
set -a; source .env; set +a

# The ghcr server image ships only llama-server; llama-bench lives in `full`.
# Strip the -server suffix for rocm/llama.cpp-style names, else swap the tag.
bench_image="${INFERENCE_IMAGE/server-rocm/full-rocm}"
bench_image="${bench_image/:server/:full}"

# Matrix: repo:quant, KV cache type. Edit to taste; keep cells few, each one
# loads the model and takes ~1-2 min on a 12 GB card. Keep -p/-n modest:
# llama-bench sizes context itself and there is no -c flag; do NOT add
# --fit-target as an OOM guard — it silently falls back to host buffers
# (weights read over PCIe, tg collapses to ~3 t/s). Close GPU-heavy apps
# (games, video) while running; the desktop shares the card.
MODELS=(
  "unsloth/Qwen3.5-9B-GGUF:Q4_K_XL"
  "unsloth/Qwen3.5-9B-GGUF:Q6_K"
  "unsloth/Qwen3.5-4B-GGUF:Q8_0"
  "bloomer010/Ling-3.0-tiny-GGUF:Q8_0"
)
KVS=(q8_0 f16)

mkdir -p data/eval
out="data/eval/local-benchmark.md"
{
  echo "# Local inference benchmark"
  echo
  echo "Date: $(date -u '+%Y-%m-%d %H:%M UTC') · image: ${bench_image} · host GPU: $(lspci | grep -i 'vga\|display' | head -1 | cut -d: -f3- | xargs)"
  echo
  echo "| model | KV | prompt tps | gen tps |"
  echo "|---|---|---|---|---|"
} >> "$out"

for model in "${MODELS[@]}"; do
  for kv in "${KVS[@]}"; do
    echo "==> benching ${model} kv=${kv}"
    bench_out=$(docker run --rm \
      --entrypoint /app/llama-bench \
      --device="$GPU_DEVICE_1" --device="$GPU_DEVICE_2" \
      --group-add "$GPU_GROUP_1" --group-add "$GPU_GROUP_2" \
      -e "HSA_OVERRIDE_GFX_VERSION=${HSA_OVERRIDE_GFX_VERSION}" \
      -e "LLAMA_CACHE=/models" \
      -v "${INFERENCE_MODELS_DIR}:/models" \
      "$bench_image" \
      -hf "$model" -ngl 99 -fa on -ctk "$kv" -ctv "$kv" \
      -p 512 -n 256 -r 2)
    echo "$bench_out"
    # llama-bench prints one row per test (pp512, tg256); the t/s value is
    # the second-to-last column, layout varies between versions.
    pp=$(echo "$bench_out" | awk -F'|' '/pp512/ { gsub(/ /, "", $(NF-1)); print $(NF-1) }')
    tg=$(echo "$bench_out" | awk -F'|' '/tg256/ { gsub(/ /, "", $(NF-1)); print $(NF-1) }')
    echo "| ${model#unsloth/} | $kv | ${pp:-?} | ${tg:-?} |" >> "$out"
  done
done

echo
echo "results appended to $out"
echo "VRAM check while a model is loaded: docker run --rm --device=$GPU_DEVICE_1 --group-add $GPU_GROUP_1 $bench_image rocm-smi --showmeminfo vram"
echo "After picking a winner, set INFERENCE_ARGS in .env accordingly and verify end-to-end:"
echo "  docker compose --profile local up -d && curl -sN -X POST http://127.0.0.1:3000/api/chat ... (or use the chat UI)"