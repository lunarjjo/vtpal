// VTPal web app: renders the VRM avatar (three.js + three-vrm), runs the
// chat loop, and drives lip-sync + expressions from the TTS audio stream.
import * as THREE from 'three';
import { GLTFLoader } from '/vendor/GLTFLoader.js';
import { VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm';

const $ = (sel) => document.querySelector(sel);
const state = {
  vrm: null,
  audioCtx: null,
  analyser: null,
  audioSource: null,
  speaking: false,
  mouthLevel: 0,
  blinkTimer: 0,
  blinkPhase: 0,
  time: 0,
  expressionTimer: 0,
  currentExpression: null,
  recentered: false,
  posed: false,
};

// ---------------------------------------------------------------- utilities
async function api(path, opts) {
  const res = await fetch(path, opts);
  const type = res.headers.get('content-type') || '';
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    if (type.includes('application/json')) {
      try { msg = (await res.json()).error || msg; } catch { /* keep */ }
    }
    throw new Error(msg);
  }
  return type.includes('application/json') ? res.json() : res;
}

function setDot(el, cls, label, text) {
  el.className = `dot ${cls}`;
  if (text) $(label).textContent = text;
}

// ------------------------------------------------------------------- three
const canvas = $('#avatar-canvas');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(canvas.clientWidth || 600, canvas.clientHeight || 400, false);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(20, 1, 0.1, 20);
camera.position.set(0, 1.35, 2.6);
camera.lookAt(0, 1.32, 0);

scene.add(new THREE.DirectionalLight(0xffffff, 1.6)).position.set(1, 1.6, 1);
const fill = new THREE.DirectionalLight(0x9db8ff, 0.7);
fill.position.set(-1.4, 0.8, 0.6);
scene.add(fill);
scene.add(new THREE.AmbientLight(0xffffff, 0.55));

const lookTarget = new THREE.Object3D();
scene.add(lookTarget);

function resize() {
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (w === 0 || h === 0) return;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);

async function loadAvatar() {
  try {
    const loader = new GLTFLoader();
    loader.register((parser) => new VRMLoaderPlugin(parser));
    const gltf = await loader.loadAsync('/assets/rose.vrm');
    const vrm = gltf.userData.vrm;
    VRMUtils.removeUnnecessaryVertices(gltf.scene);
    VRMUtils.combineSkeletons(gltf.scene);
    VRMUtils.rotateVRM0(vrm);
    if (vrm.lookAt) vrm.lookAt.target = lookTarget;
    scene.add(vrm.scene);
    state.vrm = vrm;
    state.recentered = false; // done after skinning evaluates (see tickAvatar)
    const name = vrm.meta?.meta?.title || vrm.meta?.title || 'your pal';
    $('#vname').textContent = name;
  } catch (err) {
    $('#vname').textContent = 'avatar failed to load (chat still works)';
    console.error('avatar load failed:', err);
  }
}

// expression preset fallbacks (VRM0 vs VRM1 naming)
const EXPR_ALIASES = {
  happy: ['happy', 'joy', 'fun'],
  sad: ['sad', 'sorrow'],
  surprised: ['surprised', 'fun'],
  angry: ['angry'],
  relaxed: ['relaxed', 'neutral'],
};

function setExpression(name, weight) {
  const vrm = state.vrm;
  if (!vrm?.expressionManager) return;
  if (state.currentExpression && state.currentExpression !== name) {
    for (const cand of EXPR_ALIASES[state.currentExpression] || []) {
      vrm.expressionManager.setValue(cand, 0);
    }
  }
  state.currentExpression = name;
  if (!name) return;
  let applied = false;
  for (const cand of EXPR_ALIASES[name] || []) {
    const expr = vrm.expressionManager.getExpression(cand);
    if (expr) {
      vrm.expressionManager.setValue(cand, weight);
      applied = true;
      break;
    }
  }
  if (!applied) state.currentExpression = null;
}

function tickAvatar(dt) {
  const vrm = state.vrm;
  if (!vrm) return;
  state.time += dt;

  // idle breathing + gentle sway
  const head = vrm.humanoid?.getNormalizedBoneNode('head');
  const spine = vrm.humanoid?.getNormalizedBoneNode('spine');
  if (spine) spine.rotation.z = Math.sin(state.time * 0.9) * 0.02;
  if (head) {
    head.rotation.y = Math.sin(state.time * 0.55) * 0.07;
    head.rotation.x = Math.sin(state.time * 0.75) * 0.02 + (state.speaking ? state.mouthLevel * 0.03 : 0);
  }
  // relax the T-pose into a natural A-pose once
  if (!state.posed && state.recentered) {
    state.posed = true;
    for (const side of ['left', 'right']) {
      const arm = vrm.humanoid?.getNormalizedBoneNode(`${side}UpperArm`);
      if (arm) arm.rotation.z = side === 'left' ? 1.15 : -1.15;
    }
  }

  // blinking every 2-6s
  state.blinkTimer -= dt;
  if (state.blinkTimer <= 0) {
    state.blinkPhase = 0.22;
    state.blinkTimer = 2 + Math.random() * 4;
  }
  if (state.blinkPhase > 0) {
    state.blinkPhase -= dt;
    const k = Math.max(0, Math.sin((state.blinkPhase / 0.22) * Math.PI));
    vrm.expressionManager?.setValue('blink', k);
  }

  // mouth from live audio RMS
  if (state.analyser) {
    const buf = new Uint8Array(state.analyser.fftSize);
    state.analyser.getByteTimeDomainData(buf);
    let sum = 0;
    for (let i = 0; i < buf.length; i++) {
      const v = (buf[i] - 128) / 128;
      sum += v * v;
    }
    state.mouthLevel = Math.sqrt(sum / buf.length) * 4;
  }
  if (!state.speaking) state.mouthLevel *= 0.8;
  const mouth = Math.min(1, state.mouthLevel);
  vrm.expressionManager?.setValue('aa', mouth);
  vrm.expressionManager?.setValue('ih', mouth * 0.35);

  // expression decays back to neutral after 4s
  if (state.expressionTimer > 0) {
    state.expressionTimer -= dt;
    if (state.expressionTimer <= 0) setExpression(null, 0);
  }

  vrm.update(dt);

  // One-shot recenter AFTER skinning evaluates: voxel-style VRMs often rest
  // far from the origin in their posed skeleton, and Box3.setFromObject only
  // reads the bind-pose geometry — so we measure the SKINNED vertices.
  if (!state.recentered && state.time > 0.5) {
    state.recentered = true;
    let box = null;
    vrm.scene.traverse((o) => {
      if (o.isSkinnedMesh && o.geometry) {
        try {
          o.computeBoundingBox(); // skinned in local space (three >= r151)
          const b = o.boundingBox.clone().applyMatrix4(o.matrixWorld);
          box = box ? box.union(b) : b;
        } catch { /* fall back below */ }
      }
    });
    if (!box) box = new THREE.Box3().setFromObject(vrm.scene);
    if (box.max.x > box.min.x && box.max.y > box.min.y) {
      const center = box.getCenter(new THREE.Vector3());
      vrm.scene.position.x -= center.x;
      vrm.scene.position.z -= center.z;
      vrm.scene.position.y -= box.min.y;
    }
  }
}

const clock = new THREE.Clock();
renderer.setAnimationLoop(() => {
  const dt = clock.getDelta();
  resize();
  tickAvatar(dt);
  renderer.render(scene, camera);
});

// ------------------------------------------------------------------- audio
function ensureAudioCtx() {
  if (!state.audioCtx) state.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  if (state.audioCtx.state === 'suspended') state.audioCtx.resume();
  return state.audioCtx;
}

async function speak(text, msgEl) {
  const wavRes = await api('/api/tts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  });
  const wavBytes = await wavRes.arrayBuffer();
  const ctx = ensureAudioCtx();
  const buffer = await ctx.decodeAudioData(wavBytes);

  stopSpeaking();
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 1024;
  src.connect(analyser);
  analyser.connect(ctx.destination);

  state.analyser = analyser;
  state.audioSource = src;
  state.speaking = true;
  if (msgEl) msgEl.classList.add('speaking');
  src.onended = () => {
    state.speaking = false;
    state.mouthLevel = 0;
    if (msgEl) msgEl.classList.remove('speaking');
  };
  src.start();
}

function stopSpeaking() {
  if (state.audioSource) {
    try { state.audioSource.stop(); } catch { /* already stopped */ }
    state.audioSource = null;
  }
}

// -------------------------------------------------------------------- chat
function addMessage(cls, text, expression) {
  const el = document.createElement('div');
  el.className = `msg ${cls}`;
  if (expression) {
    const tag = document.createElement('span');
    tag.className = 'tag';
    tag.textContent = `*${expression}*`;
    el.appendChild(tag);
  }
  el.appendChild(document.createTextNode(text));
  $('#messages').appendChild(el);
  $('#messages').scrollTop = $('#messages').scrollHeight;
  return el;
}

async function sendChat(text) {
  addMessage('user', text);
  const pending = addMessage('pal', '…');
  try {
    const out = await api('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });
    pending.remove();
    const el = addMessage('pal', out.reply, out.expression);
    if (out.expression) {
      setExpression(out.expression, 0.9);
      state.expressionTimer = 4;
      $('#expression').textContent = out.expression;
      $('#expression').classList.remove('hidden');
      setTimeout(() => $('#expression').classList.add('hidden'), 3500);
    }
    speak(out.reply, el).catch((err) => {
      console.warn('tts failed:', err.message);
      addMessage('sys', `(voice unavailable: ${err.message})`);
    });
  } catch (err) {
    pending.remove();
    addMessage('sys', err.message);
  }
}

$('#chat-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const input = $('#chat-input');
  const text = input.value.trim();
  if (!text) return;
  input.value = '';
  sendChat(text);
});

// ------------------------------------------------------------------ memory
async function refreshMemory() {
  try {
    const mem = await api('/api/memory');
    $('#mem-stats').textContent = `${mem.facts.length} facts · ${mem.chatCount} chats · mood ${mem.mood}`;
    const list = $('#fact-list');
    list.innerHTML = '';
    for (const f of mem.facts) {
      const li = document.createElement('li');
      const span = document.createElement('span');
      span.textContent = f.text;
      const del = document.createElement('button');
      del.className = 'del';
      del.title = 'Forget this';
      del.textContent = '×';
      del.addEventListener('click', async () => {
        await api('/api/memory/facts', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: f.text }),
        });
        refreshMemory();
      });
      li.append(span, del);
      list.appendChild(li);
    }
  } catch (err) {
    $('#mem-stats').textContent = err.message;
  }
}

$('#fact-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const input = $('#fact-input');
  const text = input.value.trim();
  if (!text) return;
  input.value = '';
  await api('/api/memory/facts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  });
  refreshMemory();
  addMessage('sys', `remembered: ${text}`);
});

$('#forget-all').addEventListener('click', async () => {
  const mem = await api('/api/memory');
  for (const f of mem.facts) {
    await api('/api/memory/facts', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: f.text }),
    });
  }
  refreshMemory();
  addMessage('sys', 'memory wiped.');
});

// -------------------------------------------------------------------- logs
async function refreshLogs() {
  try {
    const { events } = await api('/api/logs?limit=120');
    const box = $('#log-list');
    box.innerHTML = '';
    for (const ev of events.reverse()) {
      const line = document.createElement('div');
      line.className = 'log-line';
      const ts = document.createElement('span');
      ts.className = 'ts';
      ts.textContent = (ev.ts || '').slice(11, 19) + ' ';
      const xpr = document.createElement('span');
      xpr.className = 'xpr';
      xpr.textContent = ev.expression ? `[${ev.expression}] ` : '';
      line.append(ts, xpr, document.createTextNode(`${ev.user} → ${ev.reply}`));
      box.appendChild(line);
    }
    if (events.length === 0) box.textContent = 'no conversations yet — say hi!';
  } catch (err) {
    $('#log-list').textContent = err.message;
  }
}
$('#logs-refresh').addEventListener('click', refreshLogs);

// -------------------------------------------------------------------- tabs
document.querySelectorAll('.tab').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((b) => b.classList.toggle('active', b === btn));
    document.querySelectorAll('.tab-page').forEach((p) => p.classList.remove('active'));
    $(`#tab-${btn.dataset.tab}`).classList.add('active');
    if (btn.dataset.tab === 'memory') refreshMemory();
    if (btn.dataset.tab === 'logs') refreshLogs();
  });
});

// ------------------------------------------------------------------ health
async function pollHealth() {
  try {
    const h = await api('/api/health');
    setDot($('#st-llm'), h.llm.ready ? 'dot-ok' : 'dot-bad', '#st-llm-label',
      `brain: ${h.llm.mode}${h.llm.ready ? '' : ' — ' + (h.llm.error || 'not ready')}`);
    setDot($('#st-tts'), h.tts.found ? 'dot-ok' : 'dot-warn', '#st-tts-label',
      `voice: ${h.tts.name || 'none'}${h.tts.language ? ` (${h.tts.language})` : ''}`);
  } catch {
    setDot($('#st-llm'), 'dot-bad', '#st-llm-label', 'brain: unreachable');
    setDot($('#st-tts'), 'dot-bad', '#st-tts-label', 'voice: unreachable');
  }
}
setInterval(pollHealth, 3000);

// ------------------------------------------------------------------- boot
resize();
loadAvatar();
pollHealth();
addMessage('sys', 'connected — say hi to your pal!');

// debug/testing hooks (harmless in production)
window.__vtpal = { state, scene, camera, renderer, THREE };
