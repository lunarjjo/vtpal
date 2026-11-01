'use strict';
// Persistent memory bank for VTPal.
//
// A profile is a single JSON file with:
//   - facts: short self-contained statements worth remembering ("my cat is Bimo")
//   - meta:  counters, mood, timestamps
//
// Everything is dependency-injectable (fs, now, path) so tests run offline
// in temp directories with a frozen clock.

const DEFAULT_PROFILE = 'default';

function normalizeText(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const STOPWORDS = new Set(
  ('the a an and or of to in on for with my i me you your is are was were be been ' +
   'this that it its as at by from so do does did have has had will would can could ' +
   'yang dan di ke dari ini itu aku saya kamu kamu adalah dengan untuk pada ada').split(' ')
);

function tokenize(s) {
  return normalizeText(s)
    .split(' ')
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));
}

function jaccard(a, b) {
  const sa = new Set(a);
  const sb = new Set(b);
  if (sa.size === 0 && sb.size === 0) return 1;
  let inter = 0;
  for (const t of sa) if (sb.has(t)) inter++;
  const union = sa.size + sb.size - inter;
  return union === 0 ? 0 : inter / union;
}

class Memory {
  constructor({ dataDir, fs = require('fs'), path = require('path'), now = () => new Date().toISOString() } = {}) {
    if (!dataDir) throw new Error('Memory: dataDir is required');
    this.dataDir = dataDir;
    this.fs = fs;
    this.path = path;
    this.now = now;
    this.cache = new Map();
  }

  profilePath(name) {
    return this.path.join(this.dataDir, 'profiles', `${name}.json`);
  }

  loadProfile(name = DEFAULT_PROFILE) {
    const file = this.profilePath(name);
    if (this.cache.has(name)) return this.cache.get(name);
    let profile = null;
    try {
      profile = JSON.parse(this.fs.readFileSync(file, 'utf8'));
    } catch (_e) {
      profile = null;
    }
    if (!profile || typeof profile !== 'object') {
      profile = {
        name,
        facts: [],
        chatCount: 0,
        mood: 'neutral',
        createdAt: this.now(),
      };
    }
    if (!Array.isArray(profile.facts)) profile.facts = [];
    profile.name = name;
    this.cache.set(name, profile);
    return profile;
  }

  saveProfile(name = DEFAULT_PROFILE) {
    const profile = this.loadProfile(name);
    profile.updatedAt = this.now();
    const dir = this.path.join(this.dataDir, 'profiles');
    this.fs.mkdirSync(dir, { recursive: true });
    const file = this.profilePath(name);
    const tmp = `${file}.tmp`;
    this.fs.writeFileSync(tmp, JSON.stringify(profile, null, 2));
    this.fs.renameSync(tmp, file);
    return profile;
  }

  // Adds a fact. Returns {added, fact} where added=false when the profile
  // already had (nearly) the same fact — that one's hits counter goes up.
  addFact(text, name = DEFAULT_PROFILE) {
    const clean = String(text || '').trim().replace(/\s+/g, ' ');
    if (!clean) return { added: false, reason: 'empty' };
    if (clean.length > 200) return { added: false, reason: 'too long (max 200 chars)' };
    const profile = this.loadProfile(name);
    const tokens = tokenize(clean);
    for (const f of profile.facts) {
      if (jaccard(tokenize(f.text), tokens) >= 0.75) {
        f.hits = (f.hits || 0) + 1;
        f.updatedAt = this.now();
        this.saveProfile(name);
        return { added: false, reason: 'known', fact: f };
      }
    }
    const fact = { text: clean, tokens, hits: 0, createdAt: this.now() };
    profile.facts.push(fact);
    if (profile.facts.length > 200) profile.facts.shift(); // ring buffer
    this.saveProfile(name);
    return { added: true, fact };
  }

  forgetFact(text, name = DEFAULT_PROFILE) {
    const profile = this.loadProfile(name);
    const tokens = tokenize(text);
    const before = profile.facts.length;
    profile.facts = profile.facts.filter(
      (f) => jaccard(tokenize(f.text), tokens) < 0.75
    );
    this.saveProfile(name);
    return before - profile.facts.length;
  }

  // Recall the facts most relevant to a user message: keyword overlap with a
  // recency tiebreaker, plus the newest few when nothing overlaps.
  recall(query, { limit = 5, name = DEFAULT_PROFILE } = {}) {
    const profile = this.loadProfile(name);
    const q = tokenize(query);
    const scored = profile.facts.map((f, i) => {
      let score = 0;
      for (const t of q) if (f.tokens.includes(t)) score += 2;
      score += Math.min(f.hits, 3) * 0.1; // often-recalled facts creep up
      score -= (profile.facts.length - i) * 0.001;
      return { fact: f, score };
    });
    scored.sort((a, b) => b.score - a.score);
    const top = scored.slice(0, limit).filter((s) => s.score > 0.05).map((s) => s.fact.text);
    if (top.length > 0) return top;
    // cold start: just the newest facts
    return profile.facts.slice(-Math.min(2, profile.facts.length)).map((f) => f.text);
  }

  bumpChat(name = DEFAULT_PROFILE) {
    const profile = this.loadProfile(name);
    profile.chatCount = (profile.chatCount || 0) + 1;
    this.saveProfile(name);
  }

  setMood(mood, name = DEFAULT_PROFILE) {
    const profile = this.loadProfile(name);
    profile.mood = String(mood || 'neutral');
    this.saveProfile(name);
  }

  // "remember this: ..." / "ingat: ..." — returns the payload or null.
  static extractRemember(text) {
    const m = String(text || '').match(/^\s*(?:remember|ingat(?:kan)?)\b\s*(?:this|ini)?\s*[:,-]?\s*(.+)$/i);
    return m ? m[1].trim() : null;
  }
}

module.exports = { Memory, normalizeText, tokenize, jaccard, DEFAULT_PROFILE };
