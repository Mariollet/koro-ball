'use strict';

/*
 * Koro-ball - petite tete de Koro-sensei suspendue a une corde.
 * Corde = chaine de points (integration de Verlet) avec contraintes de distance.
 * La tete oscille, s'attrape/se lance, esquive parfois les coups (et nargue),
 * s'use et casse si on joue trop, redescend du haut, et s'endort au repos.
 * Elle change d'humeur (couleur + visage) selon ce qu'on lui fait.
 * Les reglages (couleur, taille, corde, casse, ancre) viennent du process Main.
 */

const canvas = document.getElementById('stage');
const ctx = canvas.getContext('2d');

// ---- Reglages ----------------------------------------------------------
const DEFAULTS = {
  ball: { color: '#f4c430', radius: 26 },
  rope: { color: '#d2b48c', length: 340, stiffness: 18 },
  break: { enabled: true, sensitivity: 0.4, respawnMs: 2600 },
  placement: { anchorPct: 0.5 },
  autostart: false,
};
let S = (window.toy && window.toy.getSettings) ? window.toy.getSettings() : DEFAULTS;

// Parametres derives (recalcules par applySettings)
let BALL_R = 26, GRAB_R = 38, BAT_R = 74, ITER = 18;
let ANCHOR_PCT = 0.5, ROPE_LEN_SETTING = 340;
let BREAK_ENABLED = true, BREAK_SENS = 0.4, RESPAWN_MS = 2600;
let ropeRGB = { r: 210, g: 180, b: 140 };

// ---- Constantes physiques ---------------------------------------------
const N = 16;                 // nombre de points de corde
const GRAVITY = 0.55;
const FRICTION = 0.995;       // retention de vitesse (Verlet)
const STRESS_MAX = 1;         // seuil de rupture
const STRESS_BAT = 0.12;      // usure de base par coup de patte
const STRESS_PULL = 0.02;     // usure de base par frame quand on tire trop fort
const STRESS_HEAL = 0.994;    // cicatrisation par frame
const SLEEP_SPEED = 0.06;     // en dessous : la tete est consideree immobile

let anchorX = 0;
let anchorY = 8;
let segLen = 0;

// ---- Couleurs (helpers) ------------------------------------------------
function hexToRgb(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return { r: 244, g: 196, b: 48 };
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
  // calcule une vitesse enorme (fx/fy partent a -999) et la tete part en fusee.
  if (mouse.fx === -999) { mouse.fx = e.clientX; mouse.fy = e.clientY; }
  mouse.x = e.clientX;
  mouse.y = e.clientY;
  mouse.inside = true;
  mouse.lastMoveT = performance.now();
  // Bascule le click-through DANS la meme tache que le mouvement : la fenetre
  // devient cliquable avant le clic (sinon le 1er clic sur la tete traverse).
  updateInteractivity();
});
window.addEventListener('mouseout', () => { mouse.inside = false; });

window.addEventListener('mousedown', (e) => {
  if (paused || e.button !== 0 || state !== 'alive') return;
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
    // lancer violent -> tete choquee un instant
    if (fresh && Math.hypot(mouse.vx, mouse.vy) > 14) setTransientMood('shock', 1400);
  }
  dragging = false;
});

function setInteractive(on) {
  if (on === interactiveSent) return;
  interactiveSent = on;
  if (window.toy) window.toy.setInteractive(on);
}

// Recalcule le survol + l'etat cliquable de la fenetre.
// La fenetre reste aussi cliquable un court instant apres une esquive : le clic
// "dans le vide" est avale par l'overlay au lieu de partir dans l'appli dessous.
// En pause, l'overlay doit rester 100% traversant : les mousemove continuent
// d'arriver (forward) et re-armeraient la capture des clics sinon.
function updateInteractivity() {
  if (paused) {
    hovering = false;
    setInteractive(false);
    canvas.style.cursor = 'default';
    return;
  }
  const b = bob();
  hovering = state === 'alive' && mouse.inside &&
    Math.hypot(mouse.x - b.x, mouse.y - b.y) <= GRAB_R;
  setInteractive(hovering || dragging || performance.now() < interactiveGraceUntil);
  canvas.style.cursor = dragging ? 'grabbing' : (hovering ? 'grab' : 'default');
}

// ---- Tintement (grelot) ------------------------------------------------
let jingle = 0; // 0..1
function addJingle(v) { jingle = Math.min(1, jingle + v); }

// ---- Humeurs (facon Koro-sensei) ----------------------------------------
// La tete change de couleur et d'expression selon ce qu'on lui fait :
//   normal   jaune, grand sourire, les yeux suivent la souris
//   nameteru rayures vertes, mi-clos : il vient d'esquiver et il nargue
//   shock    bleu + sueur : attrape ou lance violemment
//   angry    rouge + veine manga : usure moyenne
//   anger    noir + aura : au bord de la rupture
//   mistake  violet + X rouge : la corde a casse, il tombe
//   right    orange + cercle rouge : il revient, "tout juste !"
//   sad      bleu clair + larmes : ecrase contre un bord
//   nemui    rose, yeux fermes + zzz : endormi
const MOOD_COLORS = {
  shock: '#7fb0e0',
  sad: '#a9c7e8',
  nemui: '#f2a9d4',
  angry: '#e05436',
  anger: '#2b2a31',
  mistake: '#8a63b3',
  right: '#ee8a2e',
};
let transientMood = null;
let transientUntil = 0;

function setTransientMood(m, ms) {
  transientMood = m;
  transientUntil = performance.now() + ms;
}

function currentMood(now) {
  if (state === 'broken') return 'mistake';
  if (asleep) return 'nemui';
  if (dragging) return 'shock';
  if (transientMood && now < transientUntil) return transientMood;
  if (BREAK_ENABLED && stress >= 0.72) return 'anger';
  if (BREAK_ENABLED && stress >= 0.42) return 'angry';
  return 'normal';
}

// ---- Petit cerveau : esquive ("Mach 20") --------------------------------
let dodgeReadyAt = 0;         // cooldown entre deux esquives
let dodgeGuardUntil = 0;      // fenetre pendant laquelle le coup de patte rate
let interactiveGraceUntil = 0; // garde le clic sur l'overlay juste apres l'esquive

// ---- Rupture / reapparition -------------------------------------------
function breakRope() {
  state = 'broken';
  breakAt = performance.now();
  pts[0].pinned = false; // le haut se detache du crochet -> tout tombe
  dragging = false;      // si on cassait en tirant, la tete nous echappe
  asleep = false;
  transientMood = null;
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
  setTransientMood('right', 1600); // "tout juste !" : il est de retour
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

  // Sommeil : sans sollicitation, la tete ne bouge plus du tout.
  if (asleep) {
    stress = Math.max(0, stress * STRESS_HEAL); // il se calme en dormant
    const near = Math.hypot(mouse.x - b.x, mouse.y - b.y) < BAT_R;
    const wakeUp = dragging || (mouse.inside && speed > 6 && near);
    if (!wakeUp) { jingle *= 0.92; return; }
    asleep = false;
    // Reveil embrume : pas d'esquive sur la frame du reveil ni juste apres
    // (endormi = vulnerable, le premier coup doit toujours porter).
    dodgeReadyAt = Math.max(dodgeReadyAt, performance.now() + 400);
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

  // Esquive facon Mach 20 : si la souris fonce vers la tete, elle se derobe
  // parfois d'un coup sec... puis nargue (nameteru). Plus il est a cran,
  // plus il esquive. Jamais en dormant (vulnerable) ni pendant un drag.
  if (state === 'alive' && !dragging && speed > 8) {
    const ddx = b.x - mouse.x, ddy = b.y - mouse.y;
    const d = Math.hypot(ddx, ddy);
    const closing = (ddx * mouse.vx + ddy * mouse.vy) > 0; // la souris se rapproche
    const now = performance.now();
    if (closing && d > BAT_R * 0.9 && d < BAT_R * 2.4 && now >= dodgeReadyAt) {
      if (Math.random() < 0.35 + stress * 0.4) {
        // impulsion perpendiculaire a la trajectoire de la souris, cote fuite
        let px = -mouse.vy, py = mouse.vx;
        const pl = Math.hypot(px, py) || 1;
        px /= pl; py /= pl;
        if (px * ddx + py * ddy < 0) { px = -px; py = -py; }
        const amp = 16 + Math.min(14, speed);
        b.x += px * amp + (ddx / (d || 1)) * 6;
        b.y += py * amp * 0.6;
        dodgeGuardUntil = now + 260;       // le coup qui suit passe dans le vide
        interactiveGraceUntil = now + 450; // avale le clic rate (pas l'appli dessous)
        dodgeReadyAt = now + 2600 + Math.random() * 2600;
        setTransientMood('nameteru', 1400);
      } else {
        dodgeReadyAt = now + 900; // pas d'esquive cette fois
      }
    }
  }

  // coup de patte : souris rapide pres de la tete -> impulsion (+ usure).
  // Rate si elle vient d'esquiver (fenetre dodgeGuardUntil).
  if (state === 'alive' && !dragging && speed > 6 && performance.now() > dodgeGuardUntil) {
    const d = Math.hypot(mouse.x - b.x, mouse.y - b.y);
    if (d < BAT_R) {
      const k = (1 - d / BAT_R) * 0.9;
      b.x += mouse.vx * k;
      b.y += mouse.vy * k;
      addJingle(Math.min(0.8, speed / 40));
      if (BREAK_ENABLED) stress += Math.min(STRESS_BAT, speed / 200) * BREAK_SENS;
    }
  }

  // pendant le drag : la tete suit le curseur
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

  // rebond doux sur les bords, seulement tant que la corde tient.
  // Un gros impact de la tete contre un bord la rend triste un instant.
  if (state === 'alive') {
    const impact = Math.hypot(b.x - b.ox, b.y - b.oy);
    let bobHitWall = false;
    for (let i = 1; i < N; i++) {
      const p = pts[i];
      let hit = false;
      if (p.x < BALL_R) { p.x = BALL_R; p.ox = p.x + (p.x - p.ox) * 0.4; hit = true; }
      if (p.x > W - BALL_R) { p.x = W - BALL_R; p.ox = p.x + (p.x - p.ox) * 0.4; hit = true; }
      if (p.y > H - BALL_R) { p.y = H - BALL_R; p.oy = p.y + (p.y - p.oy) * 0.4; hit = true; }
      if (hit && i === N - 1) bobHitWall = true;
    }
    if (bobHitWall && impact > 13 && !dragging) {
      setTransientMood('sad', 2200);
      addJingle(0.6);
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

// Chapeau de diplome (mortier + gland qui suit le mouvement)
function drawCap(cx, cy, R, b) {
  // calotte posee sur le crane
  ctx.fillStyle = '#2e2e34';
  ctx.beginPath();
  ctx.arc(cx, cy, R * 1.002, -Math.PI + 0.67, -0.67);
  ctx.closePath();
  ctx.fill();

  // planche (losange aplati vu de trois quarts)
  ctx.fillStyle = '#222227';
  ctx.beginPath();
  ctx.moveTo(cx - R * 0.95, cy - R * 0.78);
  ctx.lineTo(cx, cy - R * 1.06);
  ctx.lineTo(cx + R * 0.95, cy - R * 0.78);
  ctx.lineTo(cx, cy - R * 0.58);
  ctx.closePath();
  ctx.fill();
  ctx.lineWidth = Math.max(1, R * 0.03);
  ctx.strokeStyle = 'rgba(0,0,0,0.5)';
  ctx.stroke();

  // bouton central + gland dore qui se balance (inertie de la tete)
  const sway = Math.max(-R * 0.4, Math.min(R * 0.4, -(b.x - b.ox) * 2.2));
  const bx = cx, by = cy - R * 1.02;
  const tx = cx + R * 0.62 + sway;
  const ty = cy - R * 0.66;
  ctx.strokeStyle = '#caa93f';
  ctx.lineWidth = Math.max(1, R * 0.035);
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(bx, by);
  ctx.quadraticCurveTo(cx + R * 0.36 + sway * 0.5, cy - R * 0.98, tx, ty);
  ctx.stroke();
  ctx.fillStyle = '#d8b84a';
  ctx.beginPath();
  ctx.arc(tx, ty + R * 0.05, R * 0.075, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#454549';
  ctx.beginPath();
  ctx.arc(bx, by, R * 0.05, 0, Math.PI * 2);
  ctx.fill();
}

// Yeux, sourire et extras selon l'humeur
function drawFace(cx, cy, R, mood, now) {
  const dkOutline = 'rgba(40,25,12,0.85)';

  // --- le grand sourire croissant (la signature) ---
  const small = mood === 'nemui';
  const mw = R * (small ? 0.42 : 0.78);          // demi-largeur
  const myTop = cy + R * (small ? 0.30 : 0.02);  // hauteur des coins
  const sag = R * (small ? 0.16 : 0.34);         // creux du bord superieur
  const depth = R * (small ? 0.34 : 0.92);       // creux du bord inferieur

  ctx.beginPath();
  ctx.moveTo(cx - mw, myTop);
  ctx.quadraticCurveTo(cx, myTop + sag, cx + mw, myTop);
  ctx.quadraticCurveTo(cx, myTop + depth, cx - mw, myTop);
  ctx.closePath();
  ctx.fillStyle = mood === 'anger' ? '#f6f6ff' : '#fdfbf2';
  ctx.fill();
  ctx.lineWidth = Math.max(1.2, R * 0.045);
  ctx.strokeStyle = mood === 'anger' ? 'rgba(10,10,16,0.9)' : dkOutline;
  ctx.stroke();
  // fines separations de dents
  if (!small) {
    ctx.strokeStyle = 'rgba(120,95,70,0.28)';
    ctx.lineWidth = Math.max(1, R * 0.025);
    for (let i = -2; i <= 2; i++) {
      const x = cx + i * mw * 0.36;
      ctx.beginPath();
      ctx.moveTo(x, myTop + sag * 0.55);
      ctx.lineTo(x, myTop + depth * 0.40);
      ctx.stroke();
    }
  }

  // --- yeux ---
  const eyY = cy - R * 0.30;
  const eyDx = R * 0.34;
  // en humeur calme, les pupilles suivent la souris
  const track = (mood === 'normal' || mood === 'nameteru') && mouse.inside;
  let ox = 0, oy = 0;
  if (track) {
    const ddx = mouse.x - cx, ddy = mouse.y - eyY;
    const dl = Math.hypot(ddx, ddy) || 1;
    ox = (ddx / dl) * R * 0.05;
    oy = (ddy / dl) * R * 0.04;
  }

  ctx.fillStyle = '#1d1a17';
  ctx.strokeStyle = '#1d1a17';

  if (mood === 'nemui') {
    // paupieres fermees, apaisees
    ctx.lineWidth = Math.max(1.5, R * 0.05);
    ctx.lineCap = 'round';
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.arc(cx + s * eyDx, eyY - R * 0.02, R * 0.11, Math.PI * 0.15, Math.PI * 0.85);
      ctx.stroke();
    }
  } else if (mood === 'shock') {
    // yeux ecarquilles
    ctx.lineWidth = Math.max(1.5, R * 0.045);
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.arc(cx + s * eyDx, eyY, R * 0.09, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(cx + s * eyDx, eyY, R * 0.028, 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (mood === 'angry' || mood === 'anger') {
    // sourcils obliques furieux (blancs sur la face noire)
    if (mood === 'anger') { ctx.fillStyle = '#f2f2f6'; ctx.strokeStyle = '#f2f2f6'; }
    ctx.lineWidth = Math.max(2, R * 0.06);
    ctx.lineCap = 'round';
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(cx + s * (eyDx + R * 0.12), eyY - R * 0.12);
      ctx.lineTo(cx + s * (eyDx - R * 0.08), eyY + R * 0.04);
      ctx.stroke();
    }
  } else if (mood === 'nameteru') {
    // regard mi-clos moqueur : point + paupiere droite
    ctx.lineWidth = Math.max(1.5, R * 0.05);
    ctx.lineCap = 'round';
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.ellipse(cx + s * eyDx + ox, eyY + R * 0.02 + oy, R * 0.05, R * 0.06, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(cx + s * eyDx - R * 0.10, eyY - R * 0.07);
      ctx.lineTo(cx + s * eyDx + R * 0.10, eyY - R * 0.07);
      ctx.stroke();
    }
  } else {
    // petits yeux ronds (normal, right, mistake, sad)
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.ellipse(cx + s * eyDx + ox, eyY + oy, R * 0.055, R * 0.075, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // --- extras d'humeur ---
  if (mood === 'sad') {
    // larmes qui coulent des yeux
    ctx.fillStyle = 'rgba(195,228,255,0.9)';
    for (const s of [-1, 1]) {
      const x = cx + s * eyDx;
      ctx.beginPath();
      ctx.moveTo(x - R * 0.045, eyY + R * 0.06);
      ctx.lineTo(x + R * 0.045, eyY + R * 0.06);
      ctx.lineTo(x + R * 0.06, cy + R * 0.62);
      ctx.lineTo(x - R * 0.06, cy + R * 0.62);
      ctx.closePath();
      ctx.fill();
    }
  } else if (mood === 'shock') {
    // gouttes de sueur projetees autour de la tete
    ctx.fillStyle = 'rgba(180,220,255,0.95)';
    const drops = [[-1.15, -0.55], [1.2, -0.4], [1.0, -0.95], [-0.95, -0.95]];
    for (const [gx, gy] of drops) {
      const x = cx + gx * R, y = cy + gy * R;
      ctx.beginPath();
      ctx.moveTo(x, y - R * 0.09);
      ctx.quadraticCurveTo(x + R * 0.07, y + R * 0.03, x, y + R * 0.07);
      ctx.quadraticCurveTo(x - R * 0.07, y + R * 0.03, x, y - R * 0.09);
      ctx.fill();
    }
  } else if (mood === 'angry') {
    // veine de colere (marque manga) sur la tempe
    ctx.strokeStyle = 'rgba(122,18,8,0.95)';
    ctx.lineWidth = Math.max(2, R * 0.05);
    ctx.lineCap = 'round';
    const vx = cx + R * 0.52, vy = cy - R * 0.30;
    ctx.beginPath(); ctx.moveTo(vx - R * 0.11, vy - R * 0.045); ctx.lineTo(vx + R * 0.11, vy - R * 0.045); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(vx - R * 0.11, vy + R * 0.045); ctx.lineTo(vx + R * 0.11, vy + R * 0.045); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(vx - R * 0.045, vy - R * 0.11); ctx.lineTo(vx - R * 0.045, vy + R * 0.11); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(vx + R * 0.045, vy - R * 0.11); ctx.lineTo(vx + R * 0.045, vy + R * 0.11); ctx.stroke();
  } else if (mood === 'anger') {
    // aura sombre qui gronde autour de la tete
    ctx.strokeStyle = 'rgba(60,30,80,0.55)';
    ctx.lineWidth = Math.max(2, R * 0.05);
    ctx.lineCap = 'round';
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2 + Math.sin(now / 180 + i) * 0.08;
      const r1 = R * 1.1;
      const r2 = R * (1.3 + 0.06 * Math.sin(now / 120 + i * 2));
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1);
      ctx.lineTo(cx + Math.cos(a + 0.12) * r2, cy + Math.sin(a + 0.12) * r2);
      ctx.stroke();
    }
  } else if (mood === 'mistake') {
    // gros X rouge : rate !
    ctx.strokeStyle = 'rgba(205,50,40,0.95)';
    ctx.lineWidth = R * 0.16;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(cx - R * 0.52, cy - R * 0.50);
    ctx.lineTo(cx + R * 0.52, cy + R * 0.54);
    ctx.moveTo(cx + R * 0.52, cy - R * 0.50);
    ctx.lineTo(cx - R * 0.52, cy + R * 0.54);
    ctx.stroke();
  } else if (mood === 'right') {
    // grand cercle rouge : tout juste !
    ctx.strokeStyle = 'rgba(205,50,40,0.95)';
    ctx.lineWidth = R * 0.13;
    ctx.beginPath();
    ctx.arc(cx, cy + R * 0.02, R * 0.66, 0, Math.PI * 2);
    ctx.stroke();
  } else if (mood === 'nemui') {
    // petits "z" qui flottent
    const phase = now / 600;
    ctx.textAlign = 'center';
    for (let i = 0; i < 3; i++) {
      const alpha = 0.30 + 0.35 * (0.5 + 0.5 * Math.sin(phase - i * 0.9));
      const size = Math.max(9, Math.round(R * (0.26 + i * 0.09)));
      const x = cx + R * (0.85 + i * 0.28);
      const y = cy - R * (1.05 + i * 0.30) - Math.sin(phase - i) * R * 0.05;
      ctx.font = `bold ${size}px "Segoe UI", sans-serif`;
      ctx.lineWidth = Math.max(2, R * 0.05);
      ctx.strokeStyle = `rgba(40,30,50,${alpha})`;
      ctx.strokeText('z', x, y);
      ctx.fillStyle = `rgba(255,255,255,${alpha})`;
      ctx.fillText('z', x, y);
    }
    ctx.textAlign = 'start';
  }
}

function drawBall() {
  const b = bob();
  const now = performance.now();
  const mood = currentMood(now);

  // tremblement : tintement + fureur (stress eleve)
  const trembling = mood === 'anger' ? 1.6 : (mood === 'angry' ? 0.7 : 0);
  const shake = jingle * 3 + trembling;
  const cx = b.x + Math.sin(t * 90) * shake;
  const cy = b.y + Math.cos(t * 85) * shake;
  const R = BALL_R;

  // couleur du visage selon l'humeur (rayures nameteru par-dessus la base)
  const baseHex = MOOD_COLORS[mood] || S.ball.color;
  const base = hexToRgb(baseHex);

  // ombre portee
  ctx.fillStyle = 'rgba(0,0,0,0.16)';
  ctx.beginPath();
  ctx.ellipse(cx, cy + R * 0.92, R * 0.78, R * 0.24, 0, 0, Math.PI * 2);
  ctx.fill();

  // tete : aplat legerement modele (style anime, pas de gros reflet brillant)
  const grad = ctx.createRadialGradient(cx - R * 0.3, cy - R * 0.35, R * 0.3, cx, cy, R);
  grad.addColorStop(0, rgbStr(mix(base, { r: 255, g: 255, b: 255 }, 0.22)));
  grad.addColorStop(0.72, rgbStr(base));
  grad.addColorStop(1, rgbStr(mix(base, { r: 0, g: 0, b: 0 }, 0.18)));
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, Math.PI * 2);
  ctx.fill();

  // rayures moqueuses (nameteru)
  if (mood === 'nameteru') {
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, R * 0.985, 0, Math.PI * 2);
    ctx.clip();
    ctx.strokeStyle = 'rgba(110,180,95,0.9)';
    ctx.lineWidth = R * 0.17;
    for (let i = -1; i <= 1; i++) {
      const y = cy + i * R * 0.5 - R * 0.05;
      ctx.beginPath();
      ctx.moveTo(cx - R, y);
      ctx.quadraticCurveTo(cx, y + R * 0.14, cx + R, y);
      ctx.stroke();
    }
    ctx.restore();
  }

  // contour cartoon
  ctx.lineWidth = Math.max(1.5, R * 0.045);
  ctx.strokeStyle = 'rgba(45,30,15,0.55)';
  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, Math.PI * 2);
  ctx.stroke();

  drawCap(cx, cy, R, b);
  drawFace(cx, cy, R, mood, now);

  // arcs "ding" quand ca tinte
  if (jingle > 0.05) {
    ctx.strokeStyle = `rgba(255,220,120,${jingle})`;
    ctx.lineWidth = 2;
    for (let s = 0; s < 3; s++) {
      const rr = R + 8 + s * 7;
      ctx.beginPath();
      ctx.arc(cx + R + 6, cy - R, rr, -0.9, -0.2);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(cx - R - 6, cy - R, rr, Math.PI + 0.2, Math.PI + 0.9);
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
let pausedAt = 0;
if (window.toy) {
  window.toy.onSetPaused((p) => {
    const wasPaused = paused;
    paused = p;
    if (paused) {
      // Fige aussi l'entree : pas de drag fantome, pas de fenetre cliquable
      // residuelle (grace d'esquive), curseur neutre.
      dragging = false;
      interactiveGraceUntil = 0;
      dodgeGuardUntil = 0;
      pausedAt = performance.now();
      setInteractive(false);
      canvas.style.cursor = 'default';
    } else if (wasPaused) {
      // Les minuteurs sont en temps mur (performance.now) : on les decale du
      // temps passe en pause, sinon a la reprise le respawn saute d'un coup
      // et les humeurs transitoires ont expire sur une tete figee.
      const dt = performance.now() - pausedAt;
      breakAt += dt;
      transientUntil += dt;
      dodgeReadyAt += dt;
    }
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
