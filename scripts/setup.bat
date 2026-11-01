@echo off
rem ============================================================
rem VTPal — fetch every third-party piece into runtime\ (Windows)
rem
rem   scripts\setup.bat
rem
rem Pinned downloads: llama.cpp b11856 (win-cpu-x64), piper
rem 2023.11.14-2, Qwen3-0.6B-Q8_0.gguf, id_ID news_tts voice.
rem Idempotent: existing verified files are kept.
rem ============================================================
setlocal enabledelayedexpansion
chcp 65001 >nul

set ROOT=%~dp0..
set DL=%ROOT%\runtime\dl
set BIN=%ROOT%\runtime\bin
set MODEL_DIR=%ROOT%\runtime\model
set VOICE_DIR=%ROOT%\runtime\voice
if not exist "%DL%" mkdir "%DL%"
if not exist "%BIN%" mkdir "%BIN%"
if not exist "%MODEL_DIR%" mkdir "%MODEL_DIR%"
if not exist "%VOICE_DIR%" mkdir "%VOICE_DIR%"

set LLAMA_URL=https://github.com/ggml-org/llama.cpp/releases/download/b11856/llama-b11856-bin-win-cpu-x64.zip
set LLAMA_SHA=b0be608ec81c811029406430796dfcd16b8d83dc152705a6682f0d47834a2f3b
set PIPER_URL=https://github.com/rhasspy/piper/releases/download/2023.11.14-2/piper_windows_x86_64.zip
set MODEL_URL=https://huggingface.co/Qwen/Qwen3-0.6B-GGUF/resolve/main/Qwen3-0.6B-Q8_0.gguf
set MODEL_SHA=9465e63a22add5354d9bb4b99e90117043c7124007664907259bd16d043bb031
set VOICE_BASE=https://huggingface.co/rhasspy/piper-voices/resolve/main/id/id_ID/news_tts/medium
set VOICE_ONNX_SHA=ed8f02aa593f7af6b19acbdb8142e0da0dd72f46194eb33d38e0eb10a52597e8
set VOICE_JSON_SHA=1ef677072668a5e172e0759b1d3871f129009d1167f093325a17607f7add5ad7

echo == [1/4] llama.cpp llama-server (win-cpu-x64) ==
if exist "%BIN%\llama-server.exe" (
  echo [=] llama-server already installed
) else (
  if not exist "%DL%\llama.zip" curl -fL --retry 3 -o "%DL%\llama.zip" "%LLAMA_URL%"
  for /f "skip=1 tokens=1" %%h in ('certutil -hashfile "%DL%\llama.zip" SHA256') do (
    if not defined LLAMA_GOT set "LLAMA_GOT=%%h"
  )
  if /i not "!LLAMA_GOT!"=="%LLAMA_SHA%" (
    echo [!] SHA256 mismatch for llama.zip — deleting, re-run setup.bat
    del "%DL%\llama.zip" & exit /b 1
  )
  powershell -NoProfile -Command "Expand-Archive -Force '%DL%\llama.zip' '%DL%\llama'"
  for /r "%DL%\llama" %%f in (llama-server.exe) do copy /y "%%f" "%BIN%\" >nul
  for /r "%DL%\llama" %%f in (*.dll) do copy /y "%%f" "%BIN%\" >nul
  echo [=] llama-server installed
)

echo == [2/4] piper TTS ==
if exist "%BIN%\piper.exe" (
  echo [=] piper already installed
) else (
  if not exist "%DL%\piper.zip" curl -fL --retry 3 -o "%DL%\piper.zip" "%PIPER_URL%"
  powershell -NoProfile -Command "Expand-Archive -Force '%DL%\piper.zip' '%DL%\piper'"
  for /r "%DL%\piper" %%f in (piper.exe) do copy /y "%%f" "%BIN%\" >nul
  for /r "%DL%\piper" %%f in (*.dll *.onnx) do copy /y "%%f" "%BIN%\" >nul
  for /r "%DL%\piper" /ad %%d in (espeak-ng-data) do robocopy "%%d" "%BIN%\espeak-ng-data" /e >nul
  echo [=] piper installed
)

echo == [3/4] Qwen3-0.6B Q8_0 brain (639 MB) ==
if exist "%MODEL_DIR%\Qwen3-0.6B-Q8_0.gguf" (
  echo [=] model already downloaded
) else (
  curl -fL --retry 3 -o "%MODEL_DIR%\Qwen3-0.6B-Q8_0.gguf.part" "%MODEL_URL%"
  for /f "skip=1 tokens=1" %%h in ('certutil -hashfile "%MODEL_DIR%\Qwen3-0.6B-Q8_0.gguf.part" SHA256') do (
    if not defined MODEL_GOT set "MODEL_GOT=%%h"
  )
  if /i not "!MODEL_GOT!"=="%MODEL_SHA%" (
    echo [!] SHA256 mismatch for model — deleting, re-run setup.bat
    del "%MODEL_DIR%\Qwen3-0.6B-Q8_0.gguf.part" & exit /b 1
  )
  ren "%MODEL_DIR%\Qwen3-0.6B-Q8_0.gguf.part" "Qwen3-0.6B-Q8_0.gguf"
)

echo == [4/4] piper voice id_ID (news_tts medium) ==
if not exist "%VOICE_DIR%\id_ID-news_tts-medium.onnx" (
  curl -fL --retry 3 -o "%VOICE_DIR%\id_ID-news_tts-medium.onnx" "%VOICE_BASE%/id_ID-news_tts-medium.onnx"
)
if not exist "%VOICE_DIR%\id_ID-news_tts-medium.onnx.json" (
  curl -fL --retry 3 -o "%VOICE_DIR%\id_ID-news_tts-medium.onnx.json" "%VOICE_BASE%/id_ID-news_tts-medium.onnx.json"
)

echo.
echo All set. Start your pal with:
echo   npm start          # then open http://127.0.0.1:3000
endlocal
