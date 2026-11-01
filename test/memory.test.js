'use strict';
const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Memory } = require('../server/memory');

function tmpData() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'vtpal-mem-'));
}

describe('Memory', () => {
  test('stores and reloads facts across instances', () => {
    const dir = tmpData();
    const m1 = new Memory({ dataDir: dir });
    const r = m1.addFact('kucing saya bernama Bimo');
    assert.equal(r.added, true);
    m1.saveProfile();

    const m2 = new Memory({ dataDir: dir });
    const profile = m2.loadProfile();
    assert.equal(profile.facts.length, 1);
    assert.equal(profile.facts[0].text, 'kucing saya bernama Bimo');
  });

  test('deduplicates near-identical facts', () => {
    const m = new Memory({ dataDir: tmpData() });
    assert.equal(m.addFact('my cat is named Bimo').added, true);
    const dup = m.addFact('My cat is named Bimo!');
    assert.equal(dup.added, false);
    assert.equal(dup.reason, 'known');
    assert.equal(m.loadProfile().facts.length, 1);
  });

  test('rejects empty and oversized facts', () => {
    const m = new Memory({ dataDir: tmpData() });
    assert.equal(m.addFact('   ').added, false);
    assert.equal(m.addFact('x'.repeat(201)).added, false);
  });

  test('forgetFact removes the matching fact', () => {
    const m = new Memory({ dataDir: tmpData() });
    m.addFact('saya suka kopi pahit');
    assert.equal(m.forgetFact('saya suka kopi pahit'), 1);
    assert.equal(m.loadProfile().facts.length, 0);
  });

  test('recall surfaces keyword-overlapping facts first', () => {
    const m = new Memory({ dataDir: tmpData() });
    m.addFact('I stream every Friday night');
    m.addFact('my favorite drink is iced coffee');
    m.addFact('I have a dog named Pocky');
    const hits = m.recall('what drink do I like?');
    assert.ok(hits.length >= 1);
    assert.match(hits[0], /iced coffee/);
  });

  test('recall cold-start returns the newest facts', () => {
    const m = new Memory({ dataDir: tmpData() });
    assert.deepEqual(m.recall('hello there stranger'), []);
    m.addFact('first fact here');
    const hits = m.recall('hello there stranger');
    assert.deepEqual(hits, ['first fact here']);
  });

  test('bumpChat and setMood persist', () => {
    const dir = tmpData();
    const m = new Memory({ dataDir: dir });
    m.bumpChat();
    m.bumpChat();
    m.setMood('happy');
    const reloaded = new Memory({ dataDir: dir }).loadProfile();
    assert.equal(reloaded.chatCount, 2);
    assert.equal(reloaded.mood, 'happy');
  });

  test('extractRemember understands Indonesian and English', () => {
    assert.equal(Memory.extractRemember('remember this: my birthday is May 5'), 'my birthday is May 5');
    assert.equal(Memory.extractRemember('ingat: aku tinggal di Bandung'), 'aku tinggal di Bandung');
    assert.equal(Memory.extractRemember('ingat namaku Rani'), 'namaku Rani');
    assert.equal(Memory.extractRemember('hello world'), null);
  });

  test('corrupt profile file recovers as fresh profile', () => {
    const dir = tmpData();
    fs.mkdirSync(path.join(dir, 'profiles'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'profiles', 'default.json'), '{not json');
    const m = new Memory({ dataDir: dir });
    const p = m.loadProfile();
    assert.equal(p.name, 'default');
    assert.deepEqual(p.facts, []);
  });
});
