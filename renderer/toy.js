'use strict';

/*
 * Cat Toy - jouet a chat suspendu.
 * Corde = chaine de points (integration de Verlet) avec contraintes de distance.
 * Boule a grelot au bout : oscille, s'attrape/se lance, reagit au coup de patte,
 * s'use et casse si on joue trop, redescend du haut, et s'endort au repos.
 * Les reglages (couleur, taille, corde, casse, ancre) viennent du process Main.
 */

const canvas = document.getElementById('stage');
const ctx = canvas.getContext('2d');

// ---- Reglages ----------------------------------------------------------
const DEFAULTS = {
  ball: { color: '#f0b23c', radius: 26 },
  rope: { color: '#d2b48c', length: 340, stiffness: 18 },
  break: { enabled: true, sensitivity: 1, respawnMs: 2600 },
  placement: { display: 0, anchorPct: 0.5 },
  autostart: false,
};
let S = (window.toy && window.toy.getSettings) ? window.toy.getSettings() : DEFAULTS;

// Parametres derives (recalcules par applySettings)
let BALL_R = 26, GRAB_R = 38, BAT_R = 74, ITER = 18;
let ANCHOR_PCT = 0.5, ROPE_LEN_SETTING = 340;
let BREAK_ENABLED = true, BREAK_SENS = 1, RESPAWN_MS = 2600;
let ballShades = { lite: '#ffe08a', base: '#f0b23c', dark: '#c4801f' };
let ropeRGB = { r: 210, g: 180, b: 140 };

// ---- Constantes physiques ---------------------------------------------
const N = 16;                 // nombre de points de corde
const GRAVITY = 0.55;
const FRICTION = 0.995;       // retention de vitesse (Verlet)
const STRESS_MAX = 1;         // seuil de rupture
const STRESS_BAT = 0.12;      // usure de base par coup de patte
const STRESS_PULL = 0.02;     // usure de base par frame quand on tire trop fort
const STRESS_HEAL = 0.994;    // cicatrisation par frame
const SLEEP_SPEED = 0.06;     // en dessous : la balle est consideree immobile

let anchorX = 0;
let anchorY = 8;
let segLen = 0;

// ---- Couleurs (helpers) ------------------------------------------------
function hexToRgb(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return { r: 240, g: 178, b: 60 };
  const n = parseInt(m[1], 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}
function mix(a, b, k) {
  return {
    r: Math.round(a.r + (b.r - a.r) * k),
    g: Math.round(a.g + (b.g - a.g) * k),
    b: Math.round(a.b + (b.b - a.b) * k),
  };
}
const rgbStr = (c) => `rgb(${c.r},${c.g},${c.b})`;

function applySettings() {
  BALL_R = S.ball.radius;
  GRAB_R = BALL_R + 12;
  BAT_R = BALL_R + 48;
  ITER = S.rope.stiffness;
  ROPE_LEN_SETTING = S.rope.length;
  ANCHOR_PCT = S.placement.anchorPct;
  BREAK_ENABLED = S.break.enabled;
  BREAK_SENS = S.break.sensitivity;
  RESPAWN_MS = S.break.respawnMs;

  const base = hexToRgb(S.ball.color);
  ballShades = {
    lite: rgbStr(mix(base, { r: 255, g: 255, b: 255 }, 0.5)),
    base: rgbStr(base),
    dark: rgbStr(mix(base, { r: 0, g: 0, b: 0 }, 0.35)),
  };
  ropeRGB = hexToRgb(S.rope.color);

  asleep = false;    // laisse la physique reagir au changement
  layoutRope();
}

// ---- Dimensions / DPI --------------------------------------------------
let W = 0;
let H = 0;

function resize() {
  const dpr = window.devicePixelRatio || 1;
  W = window.innerWidth;
  H = window.innerHeight;
  canvas.width = Math.floor(W * dpr);
  canvas.height = Math.floor(H * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  layoutRope();
  asleep = false;
}
window.addEventListener('resize', resize);

// points : {x, y, ox, oy, pinned}
const pts = [];

function layoutRope() {
  anchorX = W * ANCHOR_PCT;
  const ropeLen = Math.max(80, Math.min(H - 40, ROPE_LEN_SETTING));
  segLen = ropeLen / (N - 1);
  if (pts.length === 0) {
    for (let i = 0; i < N; i++) {
      pts.push({ x: anchorX, y: anchorY + i * segLen, ox: anchorX, oy: anchorY + i * segLen, pinned: i === 0 });
    }
  }
  pts[0].x = anchorX;
  pts[0].y = anchorY;
}

function recenter() {
  state = 'alive';
  stress = 0;
  asleep = false;
  pts[0].pinned = true;
  for (let i = 0; i < N; i++) {
    pts[i].x = anchorX;
    pts[i].y = anchorY + i * segLen;
    pts[i].ox = pts[i].x;
    pts[i].oy = pts[i].y;
  }
}

// ---- Souris ------------------------------------------------------------
const mouse = {
  x: -999, y: -999,
  fx: -999, fy: -999, // position au frame precedent
  vx: 0, vy: 0,       // vitesse lissee
  lastMoveT: 0,       // horodatage du dernier mouvement reel (pour le lancer)
  inside: false,
};

let dragging = false;
let hovering = false;
let interactiveSent = false; // dernier etat envoye au main (evite le spam IPC)

let stress = 0;              // usure 0..STRESS_MAX
let state = 'alive';         // 'alive' | 'broken'
let breakAt = 0;             // performance.now() de la rupture
let asleep = false;          // au repos total : plus aucune anim tant qu'on n'interagit pas

function bob() { return pts[N - 1]; }

window.addEventListener('mousemove', (e) => {
  // 1er mouvement : on initialise l'ancienne position, sinon le 1er frame
  // calcule une vitesse enorme (fx/fy partent a -999) et la boule part en fusee.
  if (mouse.fx === -999) { mouse.fx = e.clientX; mouse.fy = e.clientY; }
  mouse.x = e.clientX;
  mouse.y = e.clientY;
  mouse.inside = true;
  mouse.lastMoveT = performance.now();
  // Bascule le click-through DANS la meme tache que le mouvement : la fenetre
  // devient cliquable avant le clic (sinon le 1er clic sur la boule traverse).
  updateInteractivity();
});
window.addEventListener('mouseout', () => { mouse.inside = false; });

window.addEventListener('mousedown', (e) => {
  if (e.button !== 0 || state !== 'alive') return;
  const b = bob();
  if (Math.hypot(mouse.x - b.x, mouse.y - b.y) <= GRAB_R) {
    dragging = true;
    canvas.style.cursor = 'grabbing';
  }
});
window.addEventListener('mouseup', () => {
  if (dragging) {
    // relache -> transmet la velocite de la souris = lancer.
    // Si la souris etait immobile juste avant, on lache proprement.
    const b = bob();
    const fresh = (performance.now() - mouse.lastMoveT) < 60;
    b.ox = b.x - (fresh ? mouse.vx : 0);
    b.oy = b.y - (fresh ? mouse.vy : 0);
  }
  dragging = false;
});

function setInteractive(on) {
  if (on === interactiveSent) return;
  interactiveSent = on;
  if (window.toy) window.toy.setInteractive(on);
}

// Recalcule le survol + l'etat cliquable de la fenetre.
function updateInteractivity() {
  const b = bob();
  hovering = state === 'alive' && mouse.inside &&
    Math.hypot(mouse.x - b.x, mouse.y - b.y) <= GRAB_R;
  setInteractive(hovering || dragging);
  canvas.style.cursor = dragging ? 'grabbing' : (hovering ? 'grab' : 'default');
}

// ---- Tintement (grelot) ------------------------------------------------
let jingle = 0; // 0..1
function addJingle(v) { jingle = Math.min(1, jingle + v); }

// ---- Rupture / reapparition -------------------------------------------
function breakRope() {
  state = 'broken';
  breakAt = performance.now();
  pts[0].pinned = false; // le haut se detache du crochet -> tout tombe
  dragging = false;      // si on cassait en tirant, la balle nous echappe
  asleep = false;
  addJingle(1);          // dernier tintement en cassant
}

function respawn() {
  // Nouvelle corde DEJA TENDUE, etendue a l'horizontale depuis le crochet :
  // la gravite la fait pivoter vers le bas (pendule) et elle se re-suspend.
  // (Une corde spawnee compressee resterait affaissee -> effet "slinky".)
  state = 'alive';
  stress = 0;
  asleep = false;
  pts[0].pinned = true;
  const dir = anchorX > W * 0.5 ? -1 : 1; // pivote vers l'interieur de l'ecran
  for (let i = 0; i < N; i++) {
    pts[i].x = anchorX + dir * i * segLen;
    pts[i].y = anchorY;
    pts[i].ox = pts[i].x;
    pts[i].oy = pts[i].y;
  }
}

// ---- Horloge d'animation ----------------------------------------------
let t = 0;

// ---- Physique ----------------------------------------------------------
function simulate() {
  const rawvx = mouse.x - mouse.fx;
  const rawvy = mouse.y - mouse.fy;
  mouse.vx = mouse.vx * 0.6 + rawvx * 0.4;
  mouse.vy = mouse.vy * 0.6 + rawvy * 0.4;
  mouse.fx = mouse.x;
  mouse.fy = mouse.y;
  const speed = Math.hypot(mouse.vx, mouse.vy);

  const b = bob();

  updateInteractivity();

  // reapparition apres une rupture
  if (state === 'broken' && performance.now() - breakAt > RESPAWN_MS) respawn();

  // Sommeil : sans sollicitation, la balle ne bouge plus du tout.
  if (asleep) {
    const near = Math.hypot(mouse.x - b.x, mouse.y - b.y) < BAT_R;
    const wakeUp = dragging || (mouse.inside && speed > 6 && near);
    if (!wakeUp) { jingle *= 0.92; return; }
    asleep = false;
  }

  t += 0.016;

  // integration Verlet (aucun vent : rien ne bouge sans interaction)
  for (let i = 0; i < N; i++) {
    if (pts[i].pinned) continue;
    const p = pts[i];
    const vx = (p.x - p.ox) * FRICTION;
    const vy = (p.y - p.oy) * FRICTION;
    p.ox = p.x;
    p.oy = p.y;
    p.x += vx;
    p.y += vy + GRAVITY;
  }

  // coup de patte : souris rapide pres de la boule -> impulsion (+ usure)
  if (state === 'alive' && !dragging && speed > 6) {
    const d = Math.hypot(mouse.x - b.x, mouse.y - b.y);
    if (d < BAT_R) {
      const k = (1 - d / BAT_R) * 0.9;
      b.x += mouse.vx * k;
      b.y += mouse.vy * k;
      addJingle(Math.min(0.8, speed / 40));
      if (BREAK_ENABLED) stress += Math.min(STRESS_BAT, speed / 200) * BREAK_SENS;
    }
  }

  // pendant le drag : la boule suit le curseur
  if (dragging) { b.x = mouse.x; b.y = mouse.y; }

  // contraintes de distance (corde rigide). L'ancre n'est fixe que tant que la
  // corde tient : une fois cassee, tout tombe librement.
  for (let k = 0; k < ITER; k++) {
    if (state === 'alive') { pts[0].x = anchorX; pts[0].y = anchorY; }
    for (let i = 0; i < N - 1; i++) {
      const a = pts[i];
      const c = pts[i + 1];
      const dx = c.x - a.x;
      const dy = c.y - a.y;
      const dist = Math.hypot(dx, dy) || 0.0001;
      const diff = (segLen - dist) / dist;
      const ox = dx * 0.5 * diff;
      const oy = dy * 0.5 * diff;
      if (!a.pinned) { a.x -= ox; a.y -= oy; }
      if (!(dragging && i + 1 === N - 1)) { c.x += ox; c.y += oy; }
    }
    if (dragging) { b.x = mouse.x; b.y = mouse.y; }
  }

  // usure : tirer au-dela de la longueur de corde la fatigue ; sinon cicatrise
  if (state === 'alive' && BREAK_ENABLED) {
    if (dragging) {
      const ropeLen = segLen * (N - 1);
      const ad = Math.hypot(b.x - anchorX, b.y - anchorY);
      if (ad > ropeLen) stress += Math.min(STRESS_PULL, (ad - ropeLen) / ropeLen * 0.08) * BREAK_SENS;
    }
    stress = Math.max(0, stress * STRESS_HEAL);
    if (stress >= STRESS_MAX) breakRope();
  } else {
    stress = 0; // casse desactivee -> corde toujours saine
  }

  // rebond doux sur les bords, seulement tant que la corde tient
  if (state === 'alive') {
    for (let i = 1; i < N; i++) {
      const p = pts[i];
      if (p.x < BALL_R) { p.x = BALL_R; p.ox = p.x + (p.x - p.ox) * 0.4; }
      if (p.x > W - BALL_R) { p.x = W - BALL_R; p.ox = p.x + (p.x - p.ox) * 0.4; }
      if (p.y > H - BALL_R) { p.y = H - BALL_R; p.oy = p.y + (p.y - p.oy) * 0.4; }
    }
  }

  jingle *= 0.92;

  // endormissement : posee ET corde tendue -> on fige (vitesse a zero).
  if (state === 'alive' && !dragging) {
    let maxv = 0;
    for (let i = 1; i < N; i++) {
      const p = pts[i];
      const v = Math.hypot(p.x - p.ox, p.y - p.oy);
      if (v > maxv) maxv = v;
    }
    const taut = Math.hypot(b.x - anchorX, b.y - anchorY) > segLen * (N - 1) * 0.9;
    if (maxv < SLEEP_SPEED && taut) {
      asleep = true;
      for (let i = 0; i < N; i++) { pts[i].ox = pts[i].x; pts[i].oy = pts[i].y; }
    }
  }
}

// ---- Rendu -------------------------------------------------------------
function drawRope() {
  // crochet (reste meme si la corde a lache)
  ctx.fillStyle = 'rgba(60,60,70,0.9)';
  ctx.beginPath();
  ctx.arc(anchorX, anchorY, 4, 0, Math.PI * 2);
  ctx.fill();

  // couleur : vire au rouge et s'amincit a mesure de l'usure
  const s = Math.min(1, stress / STRESS_MAX);
  const c = mix(ropeRGB, { r: 200, g: 60, b: 50 }, s);
  ctx.lineWidth = 3 - s;
  ctx.strokeStyle = `rgba(${c.r},${c.g},${c.b},0.95)`;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < N - 1; i++) {
    const mx = (pts[i].x + pts[i + 1].x) / 2;
    const my = (pts[i].y + pts[i + 1].y) / 2;
    ctx.quadraticCurveTo(pts[i].x, pts[i].y, mx, my);
  }
  ctx.lineTo(pts[N - 1].x, pts[N - 1].y);
  ctx.stroke();
}

function drawBall() {
  const b = bob();
  const shake = jingle * 3;
  const cx = b.x + (Math.sin(t * 90) * shake);
  const cy = b.y + (Math.cos(t * 85) * shake);

  // ombre portee
  ctx.fillStyle = 'rgba(0,0,0,0.18)';
  ctx.beginPath();
  ctx.ellipse(cx, cy + BALL_R * 0.9, BALL_R * 0.8, BALL_R * 0.28, 0, 0, Math.PI * 2);
  ctx.fill();

  // corps du grelot (degrade derive de la couleur choisie)
  const grad = ctx.createRadialGradient(cx - BALL_R * 0.35, cy - BALL_R * 0.4, BALL_R * 0.2, cx, cy, BALL_R);
  grad.addColorStop(0, ballShades.lite);
  grad.addColorStop(0.5, ballShades.base);
  grad.addColorStop(1, ballShades.dark);
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(cx, cy, BALL_R, 0, Math.PI * 2);
  ctx.fill();

  // contour
  ctx.lineWidth = 2;
  ctx.strokeStyle = 'rgba(60,35,5,0.5)';
  ctx.stroke();

  // fente du grelot
  ctx.strokeStyle = 'rgba(50,30,5,0.6)';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(cx - BALL_R * 0.6, cy + BALL_R * 0.25);
  ctx.quadraticCurveTo(cx, cy + BALL_R * 0.55, cx + BALL_R * 0.6, cy + BALL_R * 0.25);
  ctx.stroke();
  ctx.fillStyle = 'rgba(50,30,5,0.7)';
  ctx.beginPath();
  ctx.arc(cx, cy + BALL_R * 0.3, 2.4, 0, Math.PI * 2);
  ctx.fill();

  // reflet
  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  ctx.beginPath();
  ctx.ellipse(cx - BALL_R * 0.32, cy - BALL_R * 0.38, BALL_R * 0.22, BALL_R * 0.14, -0.5, 0, Math.PI * 2);
  ctx.fill();

  // arcs "ding" quand ca tinte
  if (jingle > 0.05) {
    ctx.strokeStyle = `rgba(255,220,120,${jingle})`;
    ctx.lineWidth = 2;
    for (let s = 0; s < 3; s++) {
      const rr = BALL_R + 8 + s * 7;
      ctx.beginPath();
      ctx.arc(cx + BALL_R + 6, cy - BALL_R, rr, -0.9, -0.2);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(cx - BALL_R - 6, cy - BALL_R, rr, Math.PI + 0.2, Math.PI + 0.9);
      ctx.stroke();
    }
  }
}

function render() {
  ctx.clearRect(0, 0, W, H);
  drawRope();
  drawBall();
}

// ---- Pause + reglages live --------------------------------------------
let paused = false;
if (window.toy) {
  window.toy.onSetPaused((p) => {
    paused = p;
    if (paused) { setInteractive(false); canvas.style.cursor = 'default'; }
  });
  window.toy.onRecenter(() => recenter());
  if (window.toy.onSettings) {
    window.toy.onSettings((s) => { S = s; applySettings(); });
  }
}

// ---- Boucle ------------------------------------------------------------
function loop() {
  if (!paused) simulate();
  render();
  requestAnimationFrame(loop);
}

resize();          // fixe W/H et cree les points (defauts)
applySettings();   // applique les reglages puis re-layout
recenter();
loop();
