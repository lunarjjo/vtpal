'use strict';
// Session logs: one JSONL file per day, plus a reader for the UI.

const fs = require('fs');
const path = require('path');

function logDir(dataDir) {
  return path.join(dataDir, 'logs');
}

function appendEvent(dataDir, event, { now = () => new Date() } = {}) {
  const day = now().toISOString().slice(0, 10);
  const dir = logDir(dataDir);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${day}.jsonl`);
  const line = JSON.stringify({ ts: now().toISOString(), ...event });
  fs.appendFileSync(file, line + '\n');
  return file;
}

// Newest first, at most `limit` lines.
function readEvents(dataDir, { limit = 200, day } = {}) {
  const dir = logDir(dataDir);
  let files = [];
  try {
    files = fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl')).sort().reverse();
  } catch (_e) {
    return [];
  }
  if (day) files = files.filter((f) => f.startsWith(day));
  const out = [];
  for (const f of files) {
    if (out.length >= limit) break;
    let raw = '';
    try {
      raw = fs.readFileSync(path.join(dir, f), 'utf8');
    } catch (_e) {
      continue;
    }
    const lines = raw.trim().split('\n').filter(Boolean);
    for (let i = lines.length - 1; i >= 0 && out.length < limit; i--) {
      try {
        out.push(JSON.parse(lines[i]));
      } catch (_e) {
        // skip torn/corrupt lines
      }
    }
  }
  return out;
}

module.exports = { appendEvent, readEvents, logDir };
