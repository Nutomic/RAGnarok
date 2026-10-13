# Local inference benchmark

Date: 2026-10-13 11:20 UTC · image: ghcr.io/ggml-org/llama.cpp:full-rocm · host GPU: Advanced Micro Devices, Inc. [AMD/ATI] Navi 22 [Radeon RX 6700/6700 XT/6750 XT / 6800M/6850M XT] (rev c1)

| model | KV | prompt tps | gen tps |
|---|---|---|---|---|
| Qwen3.5-9B-GGUF:Q4_K_XL | q8_0 | 889.73±22.99 | 51.32±0.13 |
| Qwen3.5-9B-GGUF:Q4_K_XL | f16 | 902.86±24.63 | 52.36±0.19 |
| Qwen3.5-9B-GGUF:Q6_K | q8_0 | 687.86±20.02 | 42.71±0.03 |
| Qwen3.5-9B-GGUF:Q6_K | f16 | 775.37±38.92 | 43.92±0.02 |
| Qwen3.5-4B-GGUF:Q8_0 | q8_0 | 2003.25±54.09 | 59.05±0.03 |
| Qwen3.5-4B-GGUF:Q8_0 | f16 | 2018.66±47.05 | 60.81±0.01 |
| bloomer010/Ling-3.0-tiny-GGUF:Q8_0 | q8_0 | 2669.72±417.63 | 111.33±0.27 |
| bloomer010/Ling-3.0-tiny-GGUF:Q8_0 | f16 | 3523.19±156.75 | 112.67±0.21 |
