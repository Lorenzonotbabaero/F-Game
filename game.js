/* Space Shooter - drag to fly, ship fires automatically.
   Plain HTML + JavaScript, no libraries. */
(() => {
'use strict';

const W = 360, H = 640;           // logical game size (scaled to fit any screen)
const INK = '#0a0a1a';

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');

function resize() {
  const s = Math.min(window.innerWidth / W, window.innerHeight / H);
  canvas.style.width = Math.floor(W * s) + 'px';
  canvas.style.height = Math.floor(H * s) + 'px';
  const px = Math.min(window.devicePixelRatio || 1, 3) * s;
  canvas.width = Math.round(W * px);
  canvas.height = Math.round(H * px);
  ctx.setTransform(canvas.width / W, 0, 0, canvas.height / H, 0, 0);
}
window.addEventListener('resize', resize);
resize();

const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/* ---------- state ---------- */
let state = 'menu';               // menu | play | over
let score = 0, best = 0, level = 1, lives = 3;
let shake = 0, bannerT = 0, overT = 0, hintT = 0, spawnT = 0, clock = 0;
try { best = +localStorage.getItem('spaceShooterBest') || 0; } catch (e) {}

const ship = { x: W / 2, y: H - 130, tx: W / 2, ty: H - 130, inv: 0, fire: 0 };
let bullets = [], rocks = [], parts = [], picks = [];
const stars = Array.from({ length: 90 }, () => ({ x: rand(0, W), y: rand(0, H), z: rand(0.2, 1) }));

/* ---------- audio (tiny, optional) ---------- */
let ac = null;
function initAudio() {
  if (!ac) { try { ac = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) {} }
  if (ac && ac.state === 'suspended') ac.resume();
}
function tone(freq, dur, type, vol, slideTo) {
  if (!ac) return;
  const t = ac.currentTime;
  const o = ac.createOscillator(), g = ac.createGain();
  o.type = type; o.frequency.setValueAtTime(freq, t);
  if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g); g.connect(ac.destination);
  o.start(t); o.stop(t + dur);
}
function sfx(kind) {
  if (!ac) return;
  if (kind === 'boom') {
    const len = Math.floor(ac.sampleRate * 0.22);
    const buf = ac.createBuffer(1, len, ac.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = ac.createBufferSource(), g = ac.createGain();
    src.buffer = buf; g.gain.value = 0.08;
    src.connect(g); g.connect(ac.destination); src.start();
  } else if (kind === 'hit') tone(220, 0.3, 'sawtooth', 0.12, 55);
  else if (kind === 'pick') tone(520, 0.18, 'triangle', 0.12, 980);
  else if (kind === 'level') { tone(440, 0.16, 'square', 0.07, 660); setTimeout(() => tone(660, 0.22, 'square', 0.07, 990), 120); }
}

/* ---------- helpers: drawing ---------- */
function rr(x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
function ctext(s, a, b, size, col, align, alpha) {
  ctx.globalAlpha = alpha == null ? 1 : alpha;
  ctx.textAlign = align || 'center';
  ctx.textBaseline = 'middle';
  ctx.font = '900 ' + size + 'px system-ui, sans-serif';
  ctx.lineJoin = 'round';
  ctx.lineWidth = size * 0.2;
  ctx.strokeStyle = INK;
  ctx.strokeText(s, a, b);
  ctx.fillStyle = col;
  ctx.fillText(s, a, b);
  ctx.globalAlpha = 1;
}
function heart(cx, cy, s, col) {
  ctx.beginPath();
  ctx.moveTo(cx, cy + s * 0.35);
  ctx.bezierCurveTo(cx - s * 0.9, cy - s * 0.2, cx - s * 0.45, cy - s * 0.85, cx, cy - s * 0.3);
  ctx.bezierCurveTo(cx + s * 0.45, cy - s * 0.85, cx + s * 0.9, cy - s * 0.2, cx, cy + s * 0.35);
  ctx.closePath();
  ctx.fillStyle = col; ctx.fill();
  ctx.lineWidth = 1.5; ctx.strokeStyle = INK; ctx.stroke();
}

/* ---------- world ---------- */
function makeRock(r, x, y, vx, vy) {
  const pts = [];
  for (let i = 0; i < 10; i++) {
    const a = i / 10 * Math.PI * 2, k = 0.8 + Math.random() * 0.25;
    pts.push([Math.cos(a) * k, Math.sin(a) * k]);
  }
  const craters = [];
  for (let i = 0; i < 3; i++) craters.push({ a: rand(0, 6.28), d: rand(0, 0.5), s: rand(0.15, 0.3) });
  const hp = r >= 28 ? 4 + Math.floor(level / 4) : r >= 18 ? 2 : 1;
  return { x, y, vx, vy, r, hp, rot: rand(0, 6.28), vr: rand(-1.2, 1.2), pts, craters, flash: 0 };
}
function spawnRock() {
  const roll = Math.random();
  const r = roll < 0.4 ? 30 : roll < 0.75 ? 20 : 12;
  const speed = clamp(70 + level * 9, 70, 250) * rand(0.8, 1.25) * (r === 12 ? 1.25 : 1);
  rocks.push(makeRock(r, rand(r, W - r), -r - 4, rand(-30, 30), speed));
}
function boom(x, y, n, big) {
  const cols = ['#ffd166', '#ff7b54', '#ffffff', '#9fb4ff'];
  for (let i = 0; i < n; i++) {
    const a = rand(0, 6.28), v = rand(30, big ? 220 : 150);
    parts.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 0, max: rand(0.3, 0.7),
                 col: cols[(Math.random() * cols.length) | 0], size: rand(1.5, big ? 4.5 : 3) });
  }
}
function shoot() {
  const y = ship.y - 20;
  if (level < 3) bullets.push({ x: ship.x, y, vx: 0 });
  else if (level < 6) bullets.push({ x: ship.x - 7, y, vx: 0 }, { x: ship.x + 7, y, vx: 0 });
  else bullets.push({ x: ship.x, y, vx: 0 }, { x: ship.x - 9, y, vx: -60 }, { x: ship.x + 9, y, vx: 60 });
}
function killRock(rk, scored) {
  boom(rk.x, rk.y, rk.r >= 28 ? 22 : 12, rk.r >= 28);
  sfx('boom');
  if (scored) {
    score += rk.r >= 28 ? 30 : rk.r >= 18 ? 20 : 10;
    if (Math.random() < 0.06) picks.push({ x: rk.x, y: rk.y, vy: 70 });
  }
  if (rk.r >= 18) {
    const nr = rk.r >= 28 ? 20 : 12;
    for (const dir of [-1, 1]) rocks.push(makeRock(nr, rk.x + dir * nr * 0.6, rk.y, dir * rand(40, 90), Math.max(rk.vy, 60) * rand(0.9, 1.2)));
  }
}
function start() {
  score = 0; level = 1; lives = 3; bannerT = 0; hintT = 6; spawnT = 0.5; shake = 0;
  bullets = []; rocks = []; parts = []; picks = [];
  ship.x = ship.tx = W / 2; ship.y = ship.ty = H - 130; ship.inv = 1; ship.fire = 0;
  state = 'play';
}
function gameOver() {
  state = 'over'; overT = 0;
  if (score > best) {
    best = score;
    try { localStorage.setItem('spaceShooterBest', String(best)); } catch (e) {}
  }
}
function hurt() {
  lives--; ship.inv = 1.8; shake = 10;
  boom(ship.x, ship.y, 26, true); sfx('hit');
  if (lives <= 0) gameOver();
}

/* ---------- input: drag anywhere to fly ---------- */
let dragging = false, lx = 0, ly = 0;
const keys = {};
function onTap() {
  if (state === 'menu') start();
  else if (state === 'over' && overT > 0.6) start();
}
canvas.addEventListener('pointerdown', e => {
  e.preventDefault(); initAudio();
  dragging = true; lx = e.clientX; ly = e.clientY;
  try { canvas.setPointerCapture(e.pointerId); } catch (err) {}
  onTap();
});
canvas.addEventListener('pointermove', e => {
  if (!dragging) return;
  const s = canvas.clientWidth / W;
  ship.tx += (e.clientX - lx) / s * 1.15;
  ship.ty += (e.clientY - ly) / s * 1.15;
  lx = e.clientX; ly = e.clientY;
  hintT = Math.min(hintT, 1.2);
});
const endDrag = () => { dragging = false; };
canvas.addEventListener('pointerup', endDrag);
canvas.addEventListener('pointercancel', endDrag);
window.addEventListener('keydown', e => {
  keys[e.key.toLowerCase()] = true;
  if (e.key === ' ' || e.key === 'Enter') { initAudio(); onTap(); }
  if (e.key.startsWith('Arrow')) e.preventDefault();
});
window.addEventListener('keyup', e => { keys[e.key.toLowerCase()] = false; });

/* ---------- update ---------- */
function update(dt) {
  clock += dt;
  const fall = state === 'play' ? 28 + level * 3 : 28;
  for (const s of stars) {
    s.y += fall * s.z * dt;
    if (s.y > H) { s.y = -2; s.x = rand(0, W); }
  }

  // rocks drift in the menu too, for atmosphere
  spawnT -= dt;
  if (spawnT <= 0 && (state === 'play' || (state === 'menu' && rocks.length < 4))) {
    spawnRock();
    spawnT = state === 'play' ? Math.max(0.32, 1.1 - level * 0.07) : 1.6;
  }
  for (const rk of rocks) {
    rk.x += rk.vx * dt; rk.y += rk.vy * dt; rk.rot += rk.vr * dt;
    if (rk.flash > 0) rk.flash -= dt;
    if (rk.x < rk.r) { rk.x = rk.r; rk.vx = Math.abs(rk.vx); }
    if (rk.x > W - rk.r) { rk.x = W - rk.r; rk.vx = -Math.abs(rk.vx); }
  }
  rocks = rocks.filter(rk => rk.y < H + rk.r + 20);

  for (const p of parts) { p.life += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= 0.97; p.vy *= 0.97; }
  parts = parts.filter(p => p.life < p.max);
  shake = Math.max(0, shake - dt * 30);
  if (bannerT > 0) bannerT -= dt;

  if (state === 'over') { overT += dt; return; }
  if (state !== 'play') return;

  // keyboard flying (desktop)
  const sp = 320 * dt;
  if (keys['arrowleft'] || keys['a']) ship.tx -= sp;
  if (keys['arrowright'] || keys['d']) ship.tx += sp;
  if (keys['arrowup'] || keys['w']) ship.ty -= sp;
  if (keys['arrowdown'] || keys['s']) ship.ty += sp;
  ship.tx = clamp(ship.tx, 20, W - 20);
  ship.ty = clamp(ship.ty, H * 0.3, H - 44);
  const k = Math.min(1, dt * 14);
  ship.x += (ship.tx - ship.x) * k;
  ship.y += (ship.ty - ship.y) * k;
  if (ship.inv > 0) ship.inv -= dt;
  if (hintT > 0) hintT -= dt;

  // autofire
  ship.fire -= dt;
  if (ship.fire <= 0) { ship.fire = 0.16; shoot(); }
  for (const b of bullets) { b.y -= 540 * dt; b.x += b.vx * dt; }
  bullets = bullets.filter(b => b.y > -20);

  // bullets vs rocks
  for (const b of bullets) {
    for (const rk of rocks) {
      if (rk.hp <= 0) continue;
      const dx = b.x - rk.x, dy = b.y - rk.y, rr2 = rk.r + 2;
      if (dx * dx + dy * dy < rr2 * rr2) {
        b.y = -100; rk.hp--; rk.flash = 0.08;
        if (rk.hp <= 0) killRock(rk, true);
        else boom(b.x, b.y + 100, 2, false);
        break;
      }
    }
  }
  rocks = rocks.filter(rk => rk.hp > 0);
  bullets = bullets.filter(b => b.y > -50);

  // ship vs rocks
  if (ship.inv <= 0) {
    for (const rk of rocks) {
      const dx = ship.x - rk.x, dy = ship.y - rk.y, d = rk.r * 0.85 + 11;
      if (dx * dx + dy * dy < d * d) { rk.hp = 0; killRock(rk, false); hurt(); break; }
    }
    rocks = rocks.filter(rk => rk.hp > 0);
  }

  // pickups
  for (const p of picks) {
    p.y += p.vy * dt;
    const dx = ship.x - p.x, dy = ship.y - p.y;
    if (dx * dx + dy * dy < 26 * 26) { p.y = H + 99; if (lives < 5) lives++; score += 25; sfx('pick'); }
  }
  picks = picks.filter(p => p.y < H + 30);

  // level up
  const lv = 1 + Math.floor(score / 400);
  if (lv > level) { level = lv; bannerT = 1.8; sfx('level'); }
}

/* ---------- draw ---------- */
function drawBackground() {
  const g = ctx.createLinearGradient(0, 0, W * 0.6, H);
  g.addColorStop(0, '#3a1566'); g.addColorStop(0.5, '#1b1b5e'); g.addColorStop(1, '#0a4f78');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  const glow = ctx.createRadialGradient(W * 0.9, H * 0.55, 10, W * 0.9, H * 0.55, 260);
  glow.addColorStop(0, 'rgba(40,160,200,0.30)'); glow.addColorStop(1, 'rgba(40,160,200,0)');
  ctx.fillStyle = glow; ctx.fillRect(0, 0, W, H);

  for (const s of stars) {
    ctx.fillStyle = 'rgba(255,255,255,' + (0.25 + s.z * 0.6) + ')';
    const r = 0.6 + s.z * 1.1;
    ctx.fillRect(s.x, s.y, r, r);
  }

  // ringed planet
  const px = 268, py = 112 + Math.sin(clock * 0.3) * 3, pr = 46;
  ctx.save();
  ctx.translate(px, py); ctx.rotate(-0.35);
  ctx.lineWidth = 5; ctx.strokeStyle = 'rgba(235,190,230,0.75)';
  ctx.beginPath(); ctx.ellipse(0, 0, pr * 1.75, pr * 0.45, 0, Math.PI, Math.PI * 2); ctx.stroke();
  ctx.restore();
  const pg = ctx.createRadialGradient(px - 14, py - 16, 6, px, py, pr);
  pg.addColorStop(0, '#ffd9a0'); pg.addColorStop(0.55, '#f08a7a'); pg.addColorStop(1, '#a8479a');
  ctx.fillStyle = pg; ctx.beginPath(); ctx.arc(px, py, pr, 0, 6.2832); ctx.fill();
  ctx.save();
  ctx.translate(px, py); ctx.rotate(-0.35);
  ctx.lineWidth = 5; ctx.strokeStyle = 'rgba(245,205,240,0.9)';
  ctx.beginPath(); ctx.ellipse(0, 0, pr * 1.75, pr * 0.45, 0, 0, Math.PI); ctx.stroke();
  ctx.restore();
}
function drawRock(rk) {
  ctx.save();
  ctx.translate(rk.x, rk.y); ctx.rotate(rk.rot);
  ctx.beginPath();
  rk.pts.forEach((p, i) => { const x = p[0] * rk.r, y = p[1] * rk.r; i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
  ctx.closePath();
  const g = ctx.createRadialGradient(-rk.r * 0.3, -rk.r * 0.3, 2, 0, 0, rk.r);
  g.addColorStop(0, rk.flash > 0 ? '#ffffff' : '#b9b3d4'); g.addColorStop(1, rk.flash > 0 ? '#d8d4ee' : '#5d567c');
  ctx.fillStyle = g; ctx.fill();
  ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(20,16,40,0.7)'; ctx.stroke();
  ctx.fillStyle = 'rgba(60,52,90,0.55)';
  for (const c of rk.craters) {
    ctx.beginPath();
    ctx.arc(Math.cos(c.a) * c.d * rk.r, Math.sin(c.a) * c.d * rk.r, c.s * rk.r, 0, 6.2832);
    ctx.fill();
  }
  ctx.restore();
}
function drawShip(x, y, alpha) {
  ctx.save();
  ctx.translate(x, y); ctx.globalAlpha = alpha;
  const fl = 9 + Math.random() * 7;
  const fg = ctx.createLinearGradient(0, 10, 0, 10 + fl);
  fg.addColorStop(0, '#fff3b0'); fg.addColorStop(1, 'rgba(255,120,40,0)');
  ctx.fillStyle = fg;
  ctx.beginPath(); ctx.moveTo(-4, 11); ctx.lineTo(0, 11 + fl); ctx.lineTo(4, 11); ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#e8434f';
  ctx.beginPath(); ctx.moveTo(-6, 0); ctx.lineTo(-17, 15); ctx.lineTo(-5, 11); ctx.closePath(); ctx.fill();
  ctx.beginPath(); ctx.moveTo(6, 0); ctx.lineTo(17, 15); ctx.lineTo(5, 11); ctx.closePath(); ctx.fill();
  const bg = ctx.createLinearGradient(-9, 0, 9, 0);
  bg.addColorStop(0, '#9cc3ff'); bg.addColorStop(0.5, '#ffffff'); bg.addColorStop(1, '#9cc3ff');
  ctx.fillStyle = bg;
  ctx.beginPath(); ctx.moveTo(0, -23); ctx.quadraticCurveTo(11, -6, 8, 12); ctx.lineTo(-8, 12); ctx.quadraticCurveTo(-11, -6, 0, -23); ctx.closePath();
  ctx.fill(); ctx.lineWidth = 1.5; ctx.strokeStyle = 'rgba(20,30,80,0.8)'; ctx.stroke();
  ctx.fillStyle = '#3a6df0';
  ctx.beginPath(); ctx.ellipse(0, -4, 3.5, 6.5, 0, 0, 6.2832); ctx.fill();
  ctx.restore();
}
function drawHUD() {
  ctext('SCORE ' + score, 10, 22, 17, '#ffffff', 'left');

  const pulse = bannerT > 0 ? 1 + Math.sin(bannerT * 12) * 0.06 : 1;
  ctx.save();
  ctx.translate(W / 2, 22); ctx.scale(pulse, pulse);
  rr(-46, -14, 92, 28, 14);
  ctx.fillStyle = '#ffd95a'; ctx.fill();
  ctx.lineWidth = 3; ctx.strokeStyle = '#7a4a00'; ctx.stroke();
  ctx.fillStyle = '#5a3400'; ctx.font = '900 15px system-ui, sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('LEVEL ' + level, 0, 1);
  ctx.restore();

  for (let i = 0; i < lives; i++) heart(W - 16 - i * 20, 22, 11, '#ff4d6d');

  if (hintT > 0 && state === 'play') {
    ctext('AUTOFIRE ON  •  DRAG TO FLY', W / 2, H - 22, 12, '#b9b3e6', 'center', Math.min(1, hintT));
  }
  if (bannerT > 0 && state === 'play') {
    const a = Math.min(1, bannerT);
    ctext('LEVEL ' + level, W / 2, H * 0.36, 40, '#ffd95a', 'center', a);
    if (level === 3 || level === 6) ctext('NEW WEAPON!', W / 2, H * 0.36 + 38, 20, '#9fffe0', 'center', a);
  }
}
function draw() {
  ctx.save();
  if (shake > 0) ctx.translate(rand(-shake, shake) * 0.4, rand(-shake, shake) * 0.4);
  drawBackground();

  for (const p of picks) heart(p.x, p.y, 16, '#ff4d6d');
  for (const rk of rocks) drawRock(rk);

  for (const b of bullets) {
    ctx.fillStyle = 'rgba(120,255,220,0.35)'; ctx.fillRect(b.x - 3, b.y - 9, 6, 18);
    ctx.fillStyle = '#d6fff2'; ctx.fillRect(b.x - 1.5, b.y - 8, 3, 14);
  }
  for (const p of parts) {
    ctx.globalAlpha = 1 - p.life / p.max;
    ctx.fillStyle = p.col; ctx.fillRect(p.x, p.y, p.size, p.size);
  }
  ctx.globalAlpha = 1;

  if (state === 'play') {
    const blink = ship.inv > 0 && Math.floor(ship.inv * 12) % 2 === 0;
    drawShip(ship.x, ship.y, blink ? 0.35 : 1);
    drawHUD();
  } else if (state === 'menu') {
    drawShip(W / 2, H - 150 + Math.sin(clock * 2) * 6, 1);
    ctext('SPACE', W / 2, H * 0.34, 54, '#ffffff');
    ctext('SHOOTER', W / 2, H * 0.34 + 54, 54, '#7fe9ff');
    ctext('TAP TO START', W / 2, H * 0.62, 22, '#ffd95a', 'center', 0.6 + Math.sin(clock * 4) * 0.4);
    ctext('Drag to fly. Your ship fires by itself.', W / 2, H * 0.62 + 34, 13, '#c9c4ee');
    if (best > 0) ctext('BEST ' + best, W / 2, H * 0.62 + 64, 15, '#ffffff');
  } else {
    ctx.fillStyle = 'rgba(5,3,20,0.6)'; ctx.fillRect(0, 0, W, H);
    ctext('GAME OVER', W / 2, H * 0.33, 44, '#ff6b81');
    ctext('SCORE ' + score, W / 2, H * 0.33 + 56, 26, '#ffffff');
    ctext('LEVEL ' + level + '   BEST ' + best, W / 2, H * 0.33 + 90, 16, '#ffd95a');
    if (overT > 0.6) ctext('TAP TO PLAY AGAIN', W / 2, H * 0.66, 20, '#7fe9ff', 'center', 0.6 + Math.sin(clock * 4) * 0.4);
  }
  ctx.restore();
}

/* ---------- main loop ---------- */
let last = 0;
function frame(t) {
  const dt = Math.min(0.033, (t - last) / 1000 || 0);
  last = t;
  update(dt);
  draw();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
})();
