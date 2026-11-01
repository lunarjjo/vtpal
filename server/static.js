'use strict';
// Static file serving with a strict traversal guard and a small type map.

const fs = require('fs');
const path = require('path');

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.vrm': 'model/gltf-binary',
  '.glb': 'model/gltf-binary',
  '.wav': 'audio/wav',
  '.woff2': 'font/woff2',
};

// Resolve `urlPath` inside `root`; return absolute path or null when the
// request escapes the root or does not exist.
function resolveFile(root, urlPath) {
  let decoded;
  try {
    decoded = decodeURIComponent(urlPath.split('?')[0]);
  } catch (_e) {
    return null;
  }
  if (decoded.includes('\0')) return null;
  const target = path.normalize(path.join(root, decoded));
  const rootNorm = path.normalize(root + path.sep);
  if (target !== path.normalize(root) && !target.startsWith(rootNorm)) return null;
  return target;
}

function serveStatic(root, urlPath, res) {
  let target = resolveFile(root, urlPath);
  if (!target) {
    res.writeHead(403, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'forbidden' }));
    return 403;
  }
  let stat = fs.existsSync(target) ? fs.statSync(target) : null;
  if (stat && stat.isDirectory()) {
    target = path.join(target, 'index.html');
    stat = fs.existsSync(target) ? fs.statSync(target) : null;
  }
  if (!stat) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'not found' }));
    return 404;
  }
  const type = TYPES[path.extname(target).toLowerCase()] || 'application/octet-stream';
  res.writeHead(200, {
    'Content-Type': type,
    'Content-Length': stat.size,
    'Cache-Control': 'no-cache',
  });
  fs.createReadStream(target).pipe(res);
  return 200;
}

module.exports = { serveStatic, resolveFile, TYPES };
