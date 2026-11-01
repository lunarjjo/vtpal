'use strict';
// Shared text helpers: TTS-oriented sanitizing and sentence splitting.

// Piper reads plain prose. Strip emoji, markup, URLs, and bracketed tags.
function sanitizeForTts(text) {
  let s = String(text || '');
  s = s.replace(/<think>[\s\S]*?(?:<\/think>|$)/gi, '');
  s = s.replace(/\[(?:happy|sad|surprised|angry|relaxed)\]/gi, ' ');
  s = s.replace(/https?:\/\/\S+/g, ' ');
  s = s.replace(/[*_`~#>|]/g, ' ');
  s = s.replace(
    /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}]/gu,
    ' '
  );
  s = s.replace(/\s+/g, ' ').trim();
  return s;
}

// Split into speakable sentences (Latin punctuation + common abbreviations).
// Very short fragments are merged into their neighbor so piper does not
// synthesize choppy 2-word clips.
function splitSentences(text, { maxLen = 220 } = {}) {
  const clean = sanitizeForTts(text);
  if (!clean) return [];
  const parts = clean
    .split(/(?<=[.!?…])\s+|\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const out = [];
  for (const p of parts) {
    const last = out[out.length - 1];
    if (last && (last.length < 24 || p.length < 24) && last.length + p.length + 1 <= maxLen) {
      out[out.length - 1] = `${last} ${p}`;
    } else {
      out.push(p);
    }
  }
  // hard-split anything pathological (no punctuation at all)
  const final = [];
  for (const p of out) {
    if (p.length <= maxLen) {
      final.push(p);
      continue;
    }
    let rest = p;
    while (rest.length > maxLen) {
      let cut = rest.lastIndexOf(' ', maxLen);
      if (cut < maxLen * 0.5) cut = maxLen;
      final.push(rest.slice(0, cut).trim());
      rest = rest.slice(cut).trim();
    }
    if (rest) final.push(rest);
  }
  return final;
}

module.exports = { sanitizeForTts, splitSentences };
