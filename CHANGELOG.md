# Changelog

All notable changes to vtpal are documented here.

## 0.1.0 — 2026-11-01

First release: a complete local-first AI VTuber companion.

- **Brain**: Qwen3-0.6B Q8_0 via the official llama-server binary, thinking
  mode hard-disabled (`chat_template_kwargs.enable_thinking=false`), 200-token
  cap + repeat penalty to bound worst-case latency; ~2 s per live turn.
- **Voice**: piper TTS with the Indonesian `id_ID-news_tts-medium` voice;
  raw PCM wrapped into 22.05 kHz WAVs server-side; any piper voice pair can
  be swapped in via env vars.
- **Avatar**: Rose.vrm (CC0, by Polygonal Mind) rendered with vendored
  three.js r171 + @pixiv/three-vrm v3.4.2 — fully offline, no build step.
  Skinned-vertex auto recenter, A-pose relax, idle sway, blinking, mood-tag
  expression presets, WebAudio RMS lip-sync.
- **Memory**: persistent JSON profiles, fact dedup (Jaccard), keyword recall,
  explicit `remember this:` / `ingat:` capture, teach/forget UI.
- **Logs**: daily JSONL session journals with a Logs tab.
- **Zero runtime dependencies** (Node ≥ 18 stdlib only); 36 offline tests;
  CI = unit matrix (Node 20/22/24) + live smoke E2E that downloads the pinned
  stack, boots the real brain and voice, and verifies chat, memory and spoken
  WAV end to end.
- **Setup**: pinned SHA-256 downloads for every third-party artifact
  (setup.sh for linux/macOS, setup.bat for Windows).

### Fixed during bring-up (live-debugged)

- three r171 splits its build — vendored `three.core.js` + the GLTFLoader's
  `utils/BufferGeometryUtils.js` so the module graph resolves offline.
- The voxel VRM rests ~1.6 m off-origin in its posed skeleton while
  `Box3.setFromObject` only reads the bind pose — avatar recentered from
  `SkinnedMesh.computeBoundingBox()` after skinning evaluates.
- Qwen3's soft `/no_think` prompt switch alone let the model burn entire
  completions in `reasoning_content` (2-minute hangs, empty answers).
- `find -type f` in setup silently dropped piper's 5 soname symlinks →
  instant piper death → unhandled EPIPE on its stdin crashed the server.
