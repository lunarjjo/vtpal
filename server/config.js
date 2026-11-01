'use strict';
// Central configuration for VTPal. Everything overridable via environment
// variables so the same code runs locally, in CI, and in containers.

const path = require('path');

const ROOT = path.resolve(__dirname, '..');

function num(name, fallback) {
  const v = process.env[name];
  if (!v) return fallback;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function bool(name, fallback) {
  const v = process.env[name];
  if (v === undefined || v === '') return fallback;
  return !['0', 'false', 'no', 'off'].includes(String(v).toLowerCase());
}

const config = {
  root: ROOT,

  // Web UI + API
  port: num('APP_PORT', 3000),
  host: process.env.APP_HOST || '127.0.0.1',

  // llama-server sidecar
  llmPort: num('VTPAL_LLM_PORT', 8091),
  llmHost: '127.0.0.1',
  modelFile: process.env.VTPAL_MODEL
    || path.join(ROOT, 'runtime', 'model', 'Qwen3-0.6B-Q8_0.gguf'),
  ctxSize: num('VTPAL_CTX', 4096),
  llmStartTimeoutMs: num('VTPAL_LLM_START_TIMEOUT', 90_000),

  // piper TTS
  voiceFile: process.env.VTPAL_VOICE
    || path.join(ROOT, 'runtime', 'voice', 'id_ID-news_tts-medium.onnx'),
  voiceConfigFile: process.env.VTPAL_VOICE_CONFIG
    || path.join(ROOT, 'runtime', 'voice', 'id_ID-news_tts-medium.onnx.json'),

  // where the third-party binaries live after scripts/setup.sh
  binDir: process.env.VTPAL_BIN_DIR || path.join(ROOT, 'runtime', 'bin'),

  // user data (memory profiles, session logs)
  dataDir: process.env.VTPAL_DATA_DIR || path.join(ROOT, 'data'),

  // persona
  personaName: process.env.VTPAL_PERSONA || 'Mira',

  // When true, no external binaries are needed: the LLM replies from a
  // canned pool and TTS synthesizes a tiny valid WAV. Used by tests and CI.
  stub: bool('VTPAL_STUB', false),

  // chat behavior
  maxTurns: num('VTPAL_MAX_TURNS', 12),       // turns kept verbatim in context
  temperature: Number(process.env.VTPAL_TEMP || 0.8),

  llmBinaryName: 'llama-server',
  ttsBinaryName: 'piper',
};

config.llmBinary = process.env.VTPAL_LLAMA_SERVER
  || path.join(config.binDir, 'llama-server');
config.ttsBinary = process.env.VTPAL_PIPER
  || path.join(config.binDir, 'piper');

config.dataDirProfiles = path.join(config.dataDir, 'profiles');
config.dataDirLogs = path.join(config.dataDir, 'logs');

module.exports = config;
