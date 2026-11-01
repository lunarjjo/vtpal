# LICENSES-NOTICE

VTPal's own code is MIT (see [LICENSE](LICENSE)). It orchestrates and bundles
third-party works that keep their own licenses:

| Piece | Role | License | Source |
| --- | --- | --- | --- |
| Qwen3-0.6B-Q8_0.gguf | chat brain (downloaded, pinned SHA) | Apache-2.0 | https://huggingface.co/Qwen/Qwen3-0.6B-GGUF |
| llama.cpp `llama-server` b11856 | LLM sidecar binary (downloaded, pinned SHA) | MIT | https://github.com/ggml-org/llama.cpp |
| piper 2023.11.14-2 | TTS binary (downloaded, pinned SHA) | MIT | https://github.com/rhasspy/piper |
| id_ID-news_tts-medium voice | Indonesian TTS voice (downloaded, pinned SHA) | MIT | https://huggingface.co/rhasspy/piper-voices |
| three.js r171 + GLTFLoader | 3D rendering (vendored in `public/vendor/`) | MIT | https://github.com/mrnimaa/three.js (build used: unpkg three@0.171.0) |
| @pixiv/three-vrm v3.4.2 | VRM loading/expressions (vendored in `public/vendor/`) | MIT | https://github.com/pixiv/three-vrm |
| Rose.vrm | default avatar model (bundled `public/assets/rose.vrm`) | CC0 1.0 — by Polygonal Mind | https://github.com/ToxSam/open-source-avatars (Open Source Avatars registry, 100Avatars R1 collection, CC0) |

The default avatar (Rose) was selected specifically because its author
dedicated it to the public domain (CC0) — the VRM file's own embedded metadata
declares `license: CC0`, and the hosting registry documents the collection as
CC0. Attribution is given here as a courtesy, not because CC0 requires it.

If you redistribute VTPal, keep this notice intact.
