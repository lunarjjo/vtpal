'use strict';
const { test, describe } = require('node:test');
const assert = require('node:assert');
const { buildSystemPrompt, parseExpression, cleanReply } = require('../server/prompts');
const { sanitizeForTts, splitSentences } = require('../server/text');

describe('prompts', () => {
  test('system prompt carries no_think switch, persona and facts', () => {
    const p = buildSystemPrompt({ personaName: 'Mira', facts: ['likes iced coffee'], userName: 'Rani' });
    assert.match(p, /\/no_think/);
    assert.match(p, /Mira/);
    assert.match(p, /Rani/);
    assert.match(p, /likes iced coffee/);
  });

  test('system prompt omits the facts block when empty', () => {
    const p = buildSystemPrompt({ personaName: 'Mira', facts: [] });
    assert.doesNotMatch(p, /remember/);
  });

  test('parses a leading expression tag and strips it', () => {
    const r = parseExpression('[happy] Hei, halo!');
    assert.equal(r.expression, 'happy');
    assert.equal(r.text, 'Hei, halo!');
  });

  test('rejects unknown or misplaced tags', () => {
    assert.equal(parseExpression('hello [happy] world').expression, null);
    assert.equal(parseExpression('[dancing] hello').expression, null);
    assert.equal(parseExpression('just talking').expression, null);
  });

  test('cleanReply strips thinking blocks and role prefixes', () => {
    assert.equal(cleanReply('<think>hmm</think>Halo!'), 'Halo!');
    assert.equal(cleanReply('Mira: hai'), 'hai');
    // unclosed think block: never speak the reasoning aloud
    assert.equal(cleanReply('jawaban <think>reasoning never closed'), 'jawaban');
    assert.equal(cleanReply('<think>only reasoning'), 'only reasoning');
  });
});

describe('text helpers', () => {
  test('sanitizeForTts removes tags, urls, emoji and markup', () => {
    const out = sanitizeForTts('[happy] cek https://x.y/*a* ini 🎉 ya!');
    assert.equal(out, 'cek ini ya!');
  });

  test('splitSentences merges tiny fragments and splits on punctuation', () => {
    const out = splitSentences('Halo! Aku Mira. Senang bertemu! Aku VTuber yang tinggal di komputermu.');
    assert.ok(out.length >= 2 && out.length <= 3, `got ${out.length}: ${JSON.stringify(out)}`);
    assert.ok(out[0].startsWith('Halo'));
  });

  test('splitSentences hard-splits pathological input', () => {
    const out = splitSentences('a'.repeat(600));
    assert.ok(out.every((s) => s.length <= 220));
    assert.ok(out.length >= 3);
  });
});
