'use strict';
// VTPal — local-first AI VTuber companion server.
//
// One process serves the Web UI + JSON API, and (unless stubbed) manages a
// llama-server sidecar for the brain. Speech is synthesized per request via
// piper. All state lives under ./data (memory profiles + session logs).

const http = require('http');
const fs = require('fs');
const path = require('path');
const config = require('./config');
const { Memory } = require('./memory');
const { ChatController } = require('./chat');
const llm = require('./llm');
const tts = require('./tts');
const logs = require('./logs');
const { serveStatic } = require('./static');

const PUBLIC_DIR = path.join(config.root, 'public');

function readBody(req, { limit = 256 * 1024 } = {}) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(new Error('body too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

async function readJson(req) {
  const raw = await readBody(req);
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch (_e) {
    throw new Error('invalid JSON body');
  }
}

function json(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function createApp({ config: cfg = config, memory = null, chat = null, log = console.log } = {}) {
  memory = memory || new Memory({ dataDir: cfg.dataDir });
  let llamaChild = null;
  let llmState = cfg.stub ? { mode: 'stub', ready: true } : { mode: 'external', ready: false, error: 'starting' };

  async function startSidecar() {
    if (cfg.stub) {
      llmState = { mode: 'stub', ready: true };
      return;
    }
    const res = await llm.startLlamaServer(cfg, log);
    llamaChild = res.child;
    llmState = res.ready
      ? { mode: 'llama-server', ready: true }
      : { mode: 'error', ready: false, error: res.error };
    if (!res.ready) log(`LLM not ready: ${res.error}`);
  }

  const controller = chat || new ChatController({
    config: cfg,
    memory,
    llm: {
      chat: async ({ messages, turn }) => llm.chat(cfg, messages, { turn }),
    },
    log,
  });

  async function handleApi(req, res, url) {
    const { pathname } = url;

    if (pathname === '/api/health' && req.method === 'GET') {
      return json(res, 200, {
        ok: true,
        app: 'vtpal',
        version: require('../package.json').version,
        llm: llmState,
        tts: { ...tts.voiceInfo(cfg), mode: cfg.stub ? 'stub' : 'piper' },
        persona: cfg.personaName,
      });
    }

    if (pathname === '/api/chat' && req.method === 'POST') {
      let body;
      try {
        body = await readJson(req);
      } catch (e) {
        return json(res, 400, { error: e.message });
      }
      if (!llmState.ready) {
        return json(res, 503, { error: `brain not ready (${llmState.error || llmState.mode})` });
      }
      const out = await controller.handle(body.text);
      if (out.error) return json(res, 502, out);
      logs.appendEvent(cfg.dataDir, {
        kind: 'chat',
        user: String(body.text || '').slice(0, 500),
        reply: String(out.reply || '').slice(0, 500),
        expression: out.expression,
      });
      return json(res, 200, out);
    }

    if (pathname === '/api/tts' && req.method === 'POST') {
      let body;
      try {
        body = await readJson(req);
      } catch (e) {
        return json(res, 400, { error: e.message });
      }
      try {
        const { wav, silent } = await tts.synthesize(cfg, String(body.text || ''));
        res.writeHead(200, { 'Content-Type': 'audio/wav', 'Content-Length': wav.length });
        res.end(wav);
        return 200;
      } catch (err) {
        return json(res, 503, { error: err.message, code: err.code || null });
      }
    }

    if (pathname === '/api/memory' && req.method === 'GET') {
      const profile = memory.loadProfile();
      return json(res, 200, {
        name: profile.name,
        chatCount: profile.chatCount || 0,
        mood: profile.mood || 'neutral',
        facts: (profile.facts || []).map((f) => ({ text: f.text, hits: f.hits || 0, createdAt: f.createdAt })),
      });
    }

    if (pathname === '/api/memory/facts' && req.method === 'POST') {
      let body;
      try {
        body = await readJson(req);
      } catch (e) {
        return json(res, 400, { error: e.message });
      }
      const r = memory.addFact(body.text);
      return json(res, r.added ? 201 : 200, r);
    }

    if (pathname === '/api/memory/facts' && req.method === 'DELETE') {
      let body;
      try {
        body = await readJson(req);
      } catch (e) {
        return json(res, 400, { error: e.message });
      }
      const removed = memory.forgetFact(body.text || '');
      return json(res, 200, { removed });
    }

    if (pathname === '/api/chat/reset' && req.method === 'POST') {
      controller.resetHistory();
      return json(res, 200, { ok: true });
    }

    if (pathname === '/api/logs' && req.method === 'GET') {
      const limit = Math.min(500, Number(url.searchParams.get('limit') || 100));
      return json(res, 200, { events: logs.readEvents(cfg.dataDir, { limit }) });
    }

    return json(res, 404, { error: 'unknown API route' });
  }

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    try {
      if (url.pathname.startsWith('/api/')) {
        await handleApi(req, res, url);
        return;
      }
      serveStatic(PUBLIC_DIR, url.pathname, res);
    } catch (err) {
      log(`request error: ${err.stack || err.message}`);
      if (!res.headersSent) json(res, 500, { error: 'internal error' });
      else res.end();
    }
  });

  return {
    server,
    startSidecar,
    stopSidecar: () => llm.stopLlamaServer(llamaChild),
    controller,
    memory,
    config: cfg,
    getState: () => ({ llmState }),
  };
}

async function main() {
  fs.mkdirSync(config.dataDirProfiles, { recursive: true });
  fs.mkdirSync(config.dataDirLogs, { recursive: true });

  const banner = (s) => console.log(s);
  banner('  __   __ _  ____ _           ');
  banner('  \\ \\ / /(_)|  __| |  VTPal  ');
  banner('   \\ V / | || |    |  local AI VTuber companion');
  banner('    \\_/  |_||_|    |__________');
  banner(`  UI      : http://${config.host}:${config.port}`);
  banner(`  mode    : ${config.stub ? 'STUB (no binaries)' : 'full (llama-server + piper)'}`);

  const app = createApp({ config });

  await app.startSidecar();

  await new Promise((resolve, reject) => {
    app.server.once('error', reject);
    app.server.listen(config.port, config.host, resolve);
  });
  banner(`  ready   : open http://${config.host}:${config.port} in your browser`);
  banner('  stop    : Ctrl+C');

  let shuttingDown = false;
  async function shutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`\n${signal} received — shutting down cleanly...`);
    app.server.close();
    await app.stopSidecar();
    process.exit(0);
  }
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

if (require.main === module) {
  main().catch((err) => {
    console.error(`fatal: ${err.message}`);
    process.exit(1);
  });
}

module.exports = { createApp, main };
