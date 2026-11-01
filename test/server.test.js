'use strict';
// Full-stack integration test in STUB mode: boots the real HTTP server with
// an in-process stub brain, then exercises every API route like a browser
// would. No external binaries required.

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { createApp } = require('../server/index');
const config = require('../server/config');

function tmpRoot() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vtpal-app-'));
  return dir;
}

function request(port, method, urlPath, body) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? null : JSON.stringify(body);
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        path: urlPath,
        method,
        headers: payload
          ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
          : {},
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const buf = Buffer.concat(chunks);
          resolve({
            status: res.statusCode,
            json: () => JSON.parse(buf.toString('utf8')),
            buffer: buf,
            contentType: res.headers['content-type'] || '',
          });
        });
      }
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

describe('VTPal server (stub mode)', () => {
  let app;
  let port;
  let dataDir;

  before(async () => {
    dataDir = tmpRoot();
    const cfg = Object.create(config);
    cfg.stub = true;
    cfg.dataDir = dataDir;
    cfg.port = 0; // ephemeral
    cfg.llmPort = 1; // must never be contacted in stub mode
    app = createApp({ config: cfg });
    await app.startSidecar();
    await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
    port = app.server.address().port;
  });

  after(async () => {
    await app.stopSidecar();
    await new Promise((resolve) => app.server.close(resolve));
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  test('health reports stub brain and voice status', async () => {
    const res = await request(port, 'GET', '/api/health');
    assert.equal(res.status, 200);
    const h = res.json();
    assert.equal(h.ok, true);
    assert.equal(h.app, 'vtpal');
    assert.equal(h.llm.mode, 'stub');
    assert.equal(h.llm.ready, true);
    assert.ok(h.tts);
  });

  test('chat round-trip returns reply + expression, logs the event', async () => {
    const res = await request(port, 'POST', '/api/chat', { text: 'halo, siapa kamu?' });
    assert.equal(res.status, 200);
    const out = res.json();
    assert.ok(out.reply && out.reply.length > 0);
    assert.ok(['happy', 'sad', 'surprised', 'angry', 'relaxed', null].includes(out.expression));

    const logsRes = await request(port, 'GET', '/api/logs?limit=10');
    assert.equal(logsRes.status, 200);
    const events = logsRes.json().events;
    assert.equal(events.length, 1);
    assert.equal(events[0].kind, 'chat');
    assert.equal(events[0].user, 'halo, siapa kamu?');
  });

  test('empty chat message is rejected', async () => {
    const res = await request(port, 'POST', '/api/chat', { text: '   ' });
    assert.equal(res.status, 502);
    assert.ok(res.json().error);
  });

  test('remember flow stores a fact and recall uses it later', async () => {
    const r1 = await request(port, 'POST', '/api/chat', { text: 'ingat: minuman favoritku es kopi susu' });
    assert.equal(r1.status, 200);
    assert.ok(r1.json().remembered && r1.json().remembered.stored);

    const mem = await request(port, 'GET', '/api/memory');
    const facts = mem.json().facts.map((f) => f.text);
    assert.ok(facts.some((f) => /es kopi susu/.test(f)), JSON.stringify(facts));
    assert.equal(mem.json().chatCount, 2); // 2 chats so far in this suite

    const r2 = await request(port, 'POST', '/api/chat', { text: 'apa minuman favoritku?' });
    assert.equal(r2.status, 200);
  });

  test('add + forget fact via API', async () => {
    const add = await request(port, 'POST', '/api/memory/facts', { text: 'saya punya kucing hitam' });
    assert.equal(add.status, 201);
    const dup = await request(port, 'POST', '/api/memory/facts', { text: 'saya punya kucing hitam' });
    assert.equal(dup.status, 200);
    assert.equal(dup.json().added, false);

    const del = await request(port, 'DELETE', '/api/memory/facts', { text: 'saya punya kucing hitam' });
    assert.equal(del.status, 200);
    assert.equal(del.json().removed, 1);
  });

  test('tts returns a playable WAV (stub synthesis)', async () => {
    const res = await request(port, 'POST', '/api/tts', { text: '[happy] Halo dunia, aku Mira!' });
    assert.equal(res.status, 200);
    assert.match(res.contentType, /audio\/wav/);
    const wav = res.buffer;
    assert.equal(wav.slice(0, 4).toString(), 'RIFF');
    assert.equal(wav.slice(8, 12).toString(), 'WAVE');
    assert.ok(wav.length > 1000, `wav too small: ${wav.length}`);
  });

  test('tts with no text still returns a short wav', async () => {
    const res = await request(port, 'POST', '/api/tts', { text: '' });
    assert.equal(res.status, 200);
    assert.ok(res.buffer.length >= 44);
  });

  test('invalid JSON body gives 400', async () => {
    const res = await new Promise((resolve, reject) => {
      const req = http.request(
        { host: '127.0.0.1', port, path: '/api/chat', method: 'POST', headers: { 'Content-Type': 'application/json' } },
        (r) => {
          const chunks = [];
          r.on('data', (c) => chunks.push(c));
          r.on('end', () => resolve({ status: r.statusCode, json: () => JSON.parse(Buffer.concat(chunks).toString()) }));
        }
      );
      req.on('error', reject);
      req.end('{broken');
    });
    assert.equal(res.status, 400);
  });

  test('unknown API route 404s with JSON', async () => {
    const res = await request(port, 'GET', '/api/nope');
    assert.equal(res.status, 404);
    assert.equal(res.json().error, 'unknown API route');
  });

  test('static serving: index.html, vendor js, vrm asset', async () => {
    const html = await request(port, 'GET', '/');
    assert.equal(html.status, 200);
    assert.match(html.contentType, /text\/html/);
    assert.match(html.buffer.toString(), /<html/i);

    const vrm = await request(port, 'GET', '/assets/rose.vrm');
    assert.equal(vrm.status, 200);
    assert.match(vrm.contentType, /gltf-binary/);
    assert.equal(vrm.buffer.slice(0, 4).toString(), 'glTF');
  });

  test('static traversal blocked', async () => {
    const res = await request(port, 'GET', '/..%2f..%2fserver%2findex.js');
    assert.ok([403, 404].includes(res.status));
  });

  test('chat reset clears history without touching memory', async () => {
    const res = await request(port, 'POST', '/api/chat/reset');
    assert.equal(res.status, 200);
    const mem = await request(port, 'GET', '/api/memory');
    assert.ok(mem.json().chatCount >= 2);
  });

  test('memory persists across app restart', async () => {
    // restart the app against the same dataDir
    await new Promise((resolve) => app.server.close(resolve));
    const cfg = Object.create(config);
    cfg.stub = true;
    cfg.dataDir = dataDir;
    cfg.port = 0;
    cfg.llmPort = 1;
    const app2 = createApp({ config: cfg });
    await new Promise((resolve) => app2.server.listen(0, '127.0.0.1', resolve));
    const port2 = app2.server.address().port;

    const mem = await request(port2, 'GET', '/api/memory');
    assert.ok(mem.json().chatCount >= 2, 'chatCount must survive restart');
    assert.ok(mem.json().facts.some((f) => /es kopi susu/.test(f.text)), 'fact must survive restart');

    await new Promise((resolve) => app2.server.close(resolve));
  });
});
