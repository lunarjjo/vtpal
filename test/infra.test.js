'use strict';
const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { appendEvent, readEvents } = require('../server/logs');
const { wrapPcmToWav, makeStubWav } = require('../server/tts');
const { resolveFile } = require('../server/static');

describe('logs', () => {
  test('append + read roundtrip, newest first', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vtpal-log-'));
    appendEvent(dir, { kind: 'chat', user: 'hai', reply: 'halo!' });
    appendEvent(dir, { kind: 'chat', user: 'apa kabar', reply: 'baik!' });
    const events = readEvents(dir, { limit: 10 });
    assert.equal(events.length, 2);
    assert.equal(events[0].user, 'apa kabar');
    assert.equal(events[1].user, 'hai');
    assert.ok(events[0].ts);
  });

  test('readEvents on missing dir is empty, torn lines skipped', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vtpal-log-'));
    assert.deepEqual(readEvents(dir), []);
    fs.mkdirSync(path.join(dir, 'logs'));
    fs.writeFileSync(path.join(dir, 'logs', '2099-01-01.jsonl'), '{"kind":"ok"}\nnot json\n');
    const events = readEvents(dir);
    assert.equal(events.length, 1);
    assert.equal(events[0].kind, 'ok');
  });
});

describe('tts wav wrapping', () => {
  test('wrapPcmToWav produces a parseable RIFF header', () => {
    const pcm = Buffer.alloc(3200);
    const wav = wrapPcmToWav(pcm, { rate: 22050 });
    assert.equal(wav.slice(0, 4).toString(), 'RIFF');
    assert.equal(wav.slice(8, 12).toString(), 'WAVE');
    assert.equal(wav.readUInt32LE(24), 22050);
    assert.equal(wav.readUInt32LE(40), 3200);
  });

  test('stub wav is a valid 16-bit PCM file', () => {
    const wav = makeStubWav({ seconds: 0.4 });
    assert.equal(wav.slice(0, 4).toString(), 'RIFF');
    assert.equal(wav.readUInt16LE(20), 1); // PCM
    assert.equal(wav.readUInt16LE(22), 1); // mono
    assert.equal(wav.length, 44 + 0.4 * 22050 * 2);
  });
});

describe('static guard', () => {
  test('blocks traversal outside root', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vtpal-pub-'));
    assert.equal(resolveFile(root, '/../etc/passwd'), null);
    assert.equal(resolveFile(root, '/%2e%2e/etc/passwd'), null);
    assert.equal(resolveFile(root, '/a/../../b'), null);
    assert.equal(resolveFile(root, '/\0'), null);
  });

  test('resolves legit files inside root', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vtpal-pub-'));
    fs.writeFileSync(path.join(root, 'hello.txt'), 'x');
    const p = resolveFile(root, '/hello.txt');
    assert.ok(p && p.endsWith('hello.txt'));
  });
});
