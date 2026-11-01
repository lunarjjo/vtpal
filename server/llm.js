'use strict';
// LLM layer: manages the llama-server sidecar and performs chat calls.
//
// In stub mode (VTPAL_STUB=1) nothing external is spawned — replies come
// from a canned pool. Tests and CI use that; real users get the real model.

const { spawn } = require('child_process');
const http = require('http');

const STUB_REPLIES = [
  '[happy] Hei! Aku di sini — ceritakan apa saja kepadaku.',
  '[relaxed] Hmm, menarik. Ceritakan lebih banyak, dong.',
  '[happy] Wah, aku senang kamu mengobrol denganku!',
  '[relaxed] Aku dengar. Terus, aku mengikuti.',
  '[surprised] Oh? Itu baru! Bojorkan lagi.',
];

function stubReply(turn = 0) {
  return STUB_REPLIES[turn % STUB_REPLIES.length];
}

// POST JSON, resolve parsed body, reject on any failure.
function postJson(urlPath, body, { host, port, timeoutMs = 120_000 } = {}) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const req = http.request(
      {
        host,
        port,
        path: urlPath,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
        },
        timeout: timeoutMs,
      },
      (res) => {
        let raw = '';
        res.on('data', (c) => { raw += c; });
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            try {
              resolve(JSON.parse(raw));
            } catch (e) {
              reject(new Error(`bad JSON from llama-server: ${e.message}`));
            }
          } else {
            reject(new Error(`llama-server HTTP ${res.statusCode}: ${raw.slice(0, 200)}`));
          }
        });
      }
    );
    req.on('timeout', () => req.destroy(new Error('llama-server request timed out')));
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

function getOk({ host, port, path = '/health', timeoutMs = 3000 } = {}) {
  return new Promise((resolve) => {
    const req = http.get({ host, port, path, timeout: timeoutMs }, (res) => {
      res.resume();
      resolve(res.statusCode === 200);
    });
    req.on('timeout', () => { req.destroy(); resolve(false); });
    req.on('error', () => resolve(false));
  });
}

// Wait until /health answers 200 (or timeout). Resolves {ok, elapsedMs}.
async function waitUntilHealthy(cfg, { timeoutMs, onTick } = {}) {
  const started = Date.now();
  for (;;) {
    if (await getOk({ host: cfg.llmHost, port: cfg.llmPort })) {
      return { ok: true, elapsedMs: Date.now() - started };
    }
    if (Date.now() - started > (timeoutMs ?? cfg.llmStartTimeoutMs)) {
      return { ok: false, elapsedMs: Date.now() - started };
    }
    if (onTick) onTick(Date.now() - started);
    await new Promise((r) => setTimeout(r, 500));
  }
}

// Spawn llama-server and wait for health. Returns { child, ready }.
async function startLlamaServer(cfg, log = () => {}) {
  if (cfg.stub) return { child: null, ready: true, stub: true };
  const fs = require('fs');
  if (!fs.existsSync(cfg.llmBinary)) {
    return {
      child: null,
      ready: false,
      stub: false,
      error: `llama-server not found at ${cfg.llmBinary} — run: npm run setup`,
    };
  }
  if (!fs.existsSync(cfg.modelFile)) {
    return {
      child: null,
      ready: false,
      stub: false,
      error: `model not found at ${cfg.modelFile} — run: npm run setup`,
    };
  }

  const args = [
    '--host', cfg.llmHost,
    '--port', String(cfg.llmPort),
    '-m', cfg.modelFile,
    '--ctx-size', String(cfg.ctxSize),
    '--jinja',
  ];
  log(`starting llama-server on ${cfg.llmHost}:${cfg.llmPort}`);
  const child = spawn(cfg.llmBinary, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.on('data', () => {});
  child.stderr.on('data', (d) => {
    const s = String(d);
    if (s.includes('error') || s.includes('failed')) log(`llama: ${s.trim().slice(0, 200)}`);
  });

  // The sidecar must never outlive the app: index.js calls stopLlamaServer
  // on SIGINT/SIGTERM, and this exit hook is the last-resort safety net.
  const killChild = () => {
    try { child.kill('SIGKILL'); } catch (_e) { /* already gone */ }
  };
  process.once('exit', killChild);

  const ready = await waitUntilHealthy(cfg);
  return { child, ready: ready.ok, stub: false, error: ready.ok ? null : 'llama-server did not become healthy in time' };
}

function stopLlamaServer(child) {
  if (!child || child.exitCode !== null) return Promise.resolve();
  return new Promise((resolve) => {
    const t = setTimeout(() => {
      try { child.kill('SIGKILL'); } catch (_e) { /* gone */ }
      resolve();
    }, 3000);
    child.once('exit', () => { clearTimeout(t); resolve(); });
    try { child.kill('SIGTERM'); } catch (_e) { clearTimeout(t); resolve(); }
  });
}

// One chat round-trip. messages: [{role, content}...] openai-style.
async function chat(cfg, messages, { turn = 0 } = {}) {
  if (cfg.stub) {
    return { content: stubReply(turn), stub: true };
  }
  const body = {
    messages,
    temperature: cfg.temperature,
    // VTuber replies are 1-3 short sentences; a hard token cap also bounds
    // worst-case latency when the tiny model falls into a repetition loop
    max_tokens: 200,
    repeat_penalty: 1.12,
    // Qwen3 hard switch: without this the hybrid brain burns every token in
    // reasoning_content (2-minute hangs, empty answers). With it: ~1.5s.
    chat_template_kwargs: { enable_thinking: false },
    stream: false,
  };
  const res = await postJson('/v1/chat/completions', body, {
    host: cfg.llmHost,
    port: cfg.llmPort,
  });
  const content = res?.choices?.[0]?.message?.content;
  if (typeof content !== 'string' || content.length === 0) {
    throw new Error('llama-server returned an empty completion');
  }
  return { content, stub: false };
}

module.exports = { startLlamaServer, stopLlamaServer, waitUntilHealthy, chat, postJson, getOk, stubReply, STUB_REPLIES };
