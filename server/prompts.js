'use strict';
// Prompt building + reply post-processing for the VTuber brain.
//
// Qwen3 is a hybrid thinking model; on a 0.6B the thinking phase is slow and
// adds little to small talk, so we use the documented soft switch "/no_think".
// Replies may carry a leading expression tag ([happy] ...) that drives the
// avatar; we parse it out so it is never spoken.

const EXPRESSIONS = ['happy', 'sad', 'surprised', 'angry', 'relaxed'];

function buildSystemPrompt({ personaName = 'Mira', facts = [], userName = 'friend' } = {}) {
  const lines = [];
  lines.push('/no_think');
  lines.push(
    `You are ${personaName}, a cheerful VTuber companion chatting live with your viewer (${userName}).`
  );
  lines.push(
    'Style: short, warm, playful. 1-3 sentences, like friendly stream chat. ' +
    'Never mention that you are an AI language model.'
  );
  lines.push(
    'Language: reply in the same language the viewer uses ' +
    '(Bahasa Indonesia gets Bahasa Indonesia, English gets English).'
  );
  lines.push(
    'Optionally start your reply with exactly one mood tag from this list: ' +
    '[happy] [sad] [surprised] [angry] [relaxed]. ' +
    'The tag is read by your avatar engine and never shown or spoken.'
  );
  if (facts.length > 0) {
    lines.push('Things you remember about your viewer:');
    for (const f of facts) lines.push(`- ${f}`);
  }
  return lines.join('\n');
}

// Parses a leading [tag] off a reply. Returns { text, expression }.
function parseExpression(text) {
  const s = String(text || '');
  const m = s.match(/^\s*\[(happy|sad|surprised|angry|relaxed)\]\s*/i);
  if (!m) return { text: s.trim(), expression: null };
  const tag = m[1].toLowerCase();
  return { text: s.slice(m[0].length).trim(), expression: EXPRESSIONS.includes(tag) ? tag : null };
}

// Strips reasoning blocks and stray markup a small model sometimes emits.
function cleanReply(text) {
  let s = String(text || '');
  s = s.replace(/<think>[\s\S]*?<\/think>/gi, '');
  s = s.replace(/<\|?(?:im_start|im_end|endoftext)\|?>/g, '');
  if (/<think>/i.test(s)) {
    // unclosed think block: the model never answered — prefer whatever it
    // wrote BEFORE the reasoning started, else nothing but whitespace
    const before = s.slice(0, s.toLowerCase().indexOf('<think>'));
    const after = s.slice(s.toLowerCase().lastIndexOf('<think>') + '<think>'.length).replace(/<\/think>/gi, '');
    s = before.trim().length > 0 ? before : after;
  }
  s = s.replace(/^\s*(?:mira|assistant)\s*:\s*/i, '');
  s = s.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n');
  return s.trim();
}

module.exports = { buildSystemPrompt, parseExpression, cleanReply, EXPRESSIONS };
