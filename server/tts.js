'use strict';
// TTS layer: piper-backed speech synthesis returning WAV buffers.
//
// Piper streams headerless raw PCM (`--output-raw`); we wrap it into a WAV
// with the voice's declared sample rate so the browser can play it directly.
//
// In stub mode (VTPAL_STUB=1) a tiny valid WAV is generated in-process so
// tests and CI exercise the exact same HTTP surface without the binary.

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { sanitizeForTts } = require('./text');

function wrapPcmToWav(pcm, { rate = 22050, channels = 1, bits = 16 } = {}) {
  const header = Buffer.alloc(44);
  const byteRate = (rate * channels * bits) / 8;
  const blockAlign = (channels * bits) / 8;
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);              // PCM
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bits, 34);
  header.write('data', 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

function makeStubWav({ seconds = 0.5, rate = 22050 } = {}) {
  const n = Math.floor(seconds * rate);
  const data = Buffer.alloc(n * 2);
  for (let i = 0; i < n; i++) {
    // gentle 220Hz sine so the bytes are not all zero
    const v = Math.round(Math.sin((i / rate) * 220 * 2 * Math.PI) * 8000);
    data.writeInt16LE(v, i * 2);
  }
  return wrapPcmToWav(data, { rate });
}

function voiceInfo(cfg) {
  const base = {
    found: fs.existsSync(cfg.voiceFile),
    name: path.basename(cfg.voiceFile || '', '.onnx'),
    language: null,
    sampleRate: null,
  };
  try {
    const json = JSON.parse(fs.readFileSync(cfg.voiceConfigFile, 'utf8'));
    base.language = (json.language && (json.language.name || json.language.code)) || null;
    base.sampleRate = (json.audio && json.audio.sample_rate) || null;
  } catch (_e) { /* keep base */ }
  return base;
}

// Synthesize one utterance to a WAV buffer. Rejects with a helpful error
// when the binary/voice is missing (the UI shows it in the status bar).
async function synthesize(cfg, text, { timeoutMs = 60_000 } = {}) {
  const clean = sanitizeForTts(text);
  if (!clean) return { wav: makeStubWav({ seconds: 0.2 }), silent: true };

  if (cfg.stub) {
    return { wav: makeStubWav({ seconds: Math.min(3, 0.3 + clean.length * 0.02) }), silent: false };
  }

  for (const [label, p] of [['piper binary', cfg.ttsBinary], ['voice model', cfg.voiceFile], ['voice config', cfg.voiceConfigFile]]) {
    if (!fs.existsSync(p)) {
      const err = new Error(`${label} not found at ${p} — run: npm run setup`);
      err.code = 'VTPAL_TTS_NOT_SET_UP';
      throw err;
    }
  }

  const info = voiceInfo(cfg);
  const rate = info.sampleRate || 22050;

  return await new Promise((resolve, reject) => {
    const chunks = [];
    const child = spawn(
      cfg.ttsBinary,
      ['--model', cfg.voiceFile, '--config', cfg.voiceConfigFile, '--output-raw'],
      { stdio: ['pipe', 'pipe', 'pipe'] }
    );
    let stderr = '';
    const timer = setTimeout(() => {
      try { child.kill('SIGKILL'); } catch (_e) { /* gone */ }
    }, timeoutMs);

    child.stdout.on('data', (c) => chunks.push(c));
    child.stderr.on('data', (c) => { stderr += String(c); });
    child.on('error', (e) => {
      clearTimeout(timer);
      reject(new Error(`failed to start piper: ${e.message}`));
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      const pcm = Buffer.concat(chunks);
      if (code !== 0 || pcm.length < 3200) {
        reject(new Error(`piper exited ${code}: ${stderr.trim().slice(0, 300) || 'no audio produced'}`));
        return;
      }
      resolve({ wav: wrapPcmToWav(pcm, { rate }), silent: false });
    });
    child.stdin.write(clean + '\n');
    child.stdin.end();
  });
}

module.exports = { synthesize, voiceInfo, makeStubWav, wrapPcmToWav };
