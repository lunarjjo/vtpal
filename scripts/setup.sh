#!/bin/sh
# ============================================================
# VTPal — fetch every third-party piece into runtime/
#
#   sh scripts/setup.sh            (linux x86_64 / macOS x64)
#
# Downloads, with SHA-256 pinning:
#   - llama.cpp llama-server   (ggml-org/llama.cpp b11856)
#   - piper TTS binary         (rhasspy/piper 2023.11.14-2)
#   - Qwen3-0.6B-Q8_0.gguf     (official Qwen GGUF, Apache-2.0)
#   - id_ID news_tts voice     (rhasspy/piper-voices, MIT)
#
# Every step is idempotent: re-running skips whatever is already in place
# and verified. Downloads resume with curl -C -.
# ============================================================
set -eu

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DL="$ROOT/runtime/dl"
BIN="$ROOT/runtime/bin"
MODEL_DIR="$ROOT/runtime/model"
VOICE_DIR="$ROOT/runtime/voice"
mkdir -p "$DL" "$BIN" "$MODEL_DIR" "$VOICE_DIR"

OS="$(uname -s)"
ARCH="$(uname -m)"
case "$OS" in
  Linux)  OS_TAG="linux" ;;
  Darwin) OS_TAG="macos" ;;
  *) echo "[!] unsupported OS '$OS' — on Windows use scripts/setup.bat" >&2; exit 1 ;;
esac
case "$ARCH" in
  x86_64|amd64) ARCH_TAG="x64" ;;
  arm64|aarch64)
    if [ "$OS_TAG" = "macos" ]; then ARCH_TAG="x64"; echo "[i] Apple Silicon: using the x64 build under Rosetta"; else echo "[!] unsupported arch '$ARCH' for linux"; exit 1; fi ;;
  *) echo "[!] unsupported arch '$ARCH'" >&2; exit 1 ;;
esac

# ---- pinned artifacts ------------------------------------------------------
LLAMA_TAG="b11856"
if [ "$OS_TAG" = "linux" ]; then
  LLAMA_URL="https://github.com/ggml-org/llama.cpp/releases/download/${LLAMA_TAG}/llama-${LLAMA_TAG}-bin-ubuntu-${ARCH_TAG}.tar.gz"
  LLAMA_SHA="71b660dd4a90c13db899acdef59862226f7ec8d27907b7c107febc99904c00be"
else
  LLAMA_URL="https://github.com/ggml-org/llama.cpp/releases/download/${LLAMA_TAG}/llama-${LLAMA_TAG}-bin-macos-${ARCH_TAG}.tar.gz"
  LLAMA_SHA="a06974186c508a8cb229803b5561fc6f0540702197fdd2dafc243fcee1d44708"
fi

PIPER_TAG="2023.11.14-2"
if [ "$OS_TAG" = "linux" ]; then
  PIPER_URL="https://github.com/rhasspy/piper/releases/download/${PIPER_TAG}/piper_linux_x86_64.tar.gz"
  PIPER_SHA="a50cb45f355b7af1f6d758c1b360717877ba0a398cc8cbe6d2a7a3a26e225992"
else
  PIPER_URL="https://github.com/rhasspy/piper/releases/download/${PIPER_TAG}/piper_macos_x86_64.tar.gz"
  PIPER_SHA=""  # verify-on-first-download (no known-good pin yet)
fi

MODEL_URL="https://huggingface.co/Qwen/Qwen3-0.6B-GGUF/resolve/main/Qwen3-0.6B-Q8_0.gguf"
MODEL_SHA="9465e63a22add5354d9bb4b99e90117043c7124007664907259bd16d043bb031"
MODEL_NAME="Qwen3-0.6B-Q8_0.gguf"

VOICE_BASE="https://huggingface.co/rhasspy/piper-voices/resolve/main/id/id_ID/news_tts/medium"
VOICE_ONNX_SHA="ed8f02aa593f7af6b19acbdb8142e0da0dd72f46194eb33d38e0eb10a52597e8"
VOICE_JSON_SHA="1ef677072668a5e172e0759b1d3871f129009d1167f093325a17607f7add5ad7"

# ---- helpers ---------------------------------------------------------------
fetch() { # fetch <url> <sha|-> <out>
  if [ -f "$3" ] && [ "$2" != "-" ]; then
    if printf '%s  %s\n' "$2" "$3" | sha256sum -c - >/dev/null 2>&1; then
      echo "[=] cached: $(basename "$3")"
      return 0
    fi
    echo "[!] sha mismatch, re-downloading: $(basename "$3")"
    rm -f "$3"
  fi
  echo "[+] fetching: $1"
  curl -fL --retry 3 --retry-delay 2 -C - -o "$3" "$1"
  if [ "$2" != "-" ]; then
    printf '%s  %s\n' "$2" "$3" | sha256sum -c - >/dev/null || {
      echo "[!] SHA256 mismatch for $3" >&2; rm -f "$3"; exit 1; }
  fi
}

have() { [ -f "$1" ]; }

# ---- 1/4 llama-server ------------------------------------------------------
echo "== [1/4] llama.cpp llama-server (${LLAMA_TAG}, ${OS_TAG}/${ARCH_TAG}) =="
if have "$BIN/llama-server"; then
  echo "[=] llama-server already installed"
else
  fetch "$LLAMA_URL" "$LLAMA_SHA" "$DL/llama.tar.gz"
  TMP="$(mktemp -d)"
  tar xzf "$DL/llama.tar.gz" -C "$TMP"
  find "$TMP" -name 'llama-server' -exec cp {} "$BIN/" \;
  # the release ships its shared libraries flat next to the binaries
  find "$TMP" -name 'lib*.so*' -exec cp -a {} "$BIN/" \; 2>/dev/null || true
  chmod +x "$BIN/llama-server"
  rm -rf "$TMP"
  echo "[=] llama-server installed"
fi

# ---- 2/4 piper -------------------------------------------------------------
echo "== [2/4] piper TTS (${PIPER_TAG}) =="
if have "$BIN/piper"; then
  echo "[=] piper already installed"
else
  fetch "$PIPER_URL" "$PIPER_SHA" "$DL/piper.tar.gz"
  TMP="$(mktemp -d)"
  tar xzf "$DL/piper.tar.gz" -C "$TMP"
  # keep piper's layout: binary + espeak-ng-data + its own libs, all in bin/
  find "$TMP" -maxdepth 2 -type f -exec cp -a {} "$BIN/" \; 2>/dev/null || true
  find "$TMP" -maxdepth 2 -type d -name 'espeak-ng-data' -exec cp -a {} "$BIN/" \; 2>/dev/null || true
  chmod +x "$BIN/piper"
  rm -rf "$TMP"
  echo "[=] piper installed"
fi

# ---- 3/4 brain model -------------------------------------------------------
echo "== [3/4] Qwen3-0.6B Q8_0 brain (639 MB) =="
fetch "$MODEL_URL" "$MODEL_SHA" "$MODEL_DIR/$MODEL_NAME"

# ---- 4/4 Indonesian voice --------------------------------------------------
echo "== [4/4] piper voice id_ID (news_tts medium) =="
fetch "$VOICE_BASE/id_ID-news_tts-medium.onnx" "$VOICE_ONNX_SHA" "$VOICE_DIR/id_ID-news_tts-medium.onnx"
fetch "$VOICE_BASE/id_ID-news_tts-medium.onnx.json" "$VOICE_JSON_SHA" "$VOICE_DIR/id_ID-news_tts-medium.onnx.json"

echo ""
echo "All set. Start your pal with:"
echo "  npm start          # then open http://127.0.0.1:3000"
