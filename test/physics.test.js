'use strict';

/*
 * Suite de regression sur la physique de renderer/toy.js.
 * Charge le vrai fichier source avec un DOM/canvas stubbe (aucune dependance),
 * pilote simulate() image par image, et verifie les invariants critiques :
 * immobilite au repos, casse/reapparition, reveil, absence de NaN.
 * Execute par `npm test` et par la CI (voir .github/workflows/ci.yml).
 */

const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', 'renderer', 'toy.js');
const code = fs.readFileSync(SRC, 'utf8');

let clock = 1000; // performance.now() simule (ms)

function makeStage() {
  const ctx = {};
  for (const m of ['setTransform', 'clearRect', 'beginPath', 'arc', 'fill', 'moveTo',
    'quadraticCurveTo', 'lineTo', 'stroke', 'ellipse', 'closePath', 'save', 'restore',
    'clip', 'fillText', 'strokeText']) {
    ctx[m] = () => {};
  }
  ctx.createRadialGradient = () => ({ addColorStop() {} });
  return { getContext: () => ctx, width: 0, height: 0, style: {} };
}

function loadToy() {
  const canvas = makeStage();
  const documentStub = { getElementById: () => canvas };
  const windowStub = { innerWidth: 1920, innerHeight: 1040, devicePixelRatio: 1, addEventListener() {} };
  const performanceStub = { now: () => clock };
  const raf = () => {};

  const suffix = `
;globalThis.__api = {
  inspect: () => ({
    state, stress: +stress.toFixed(3), asleep, N,
    bobx: +pts[N-1].x.toFixed(1), boby: +pts[N-1].y.toFixed(1),
    top0y: +pts[0].y.toFixed(1), segLen: +segLen.toFixed(2),
    anyNaN: pts.some(p => !Number.isFinite(p.x) || !Number.isFinite(p.y)),
  }),
  step: (n) => { for (let i = 0; i < n; i++) simulate(); },
  renderOnce: () => render(),
  setMouse: (x, y) => { if (mouse.fx === -999) { mouse.fx = x; mouse.fy = y; } mouse.x = x; mouse.y = y; mouse.inside = true; mouse.lastMoveT = performance.now(); },
  setDragging: (v) => { dragging = v; },
  setSens: (v) => { S.break.sensitivity = v; applySettings(); },
  setStress: (v) => { stress = v; },
  setDodgeReady: (ms) => { dodgeReadyAt = performance.now() + ms; }, // neutralise l'esquive (deterministe)
  armSplit: () => { splitReadyAt = 0; },
  splitActive: () => performance.now() < splitUntil,
  cloneCount: () => clones.length,
  clonesNaN: () => clones.some((cl) => cl.pts.some((p) => !Number.isFinite(p.x) || !Number.isFinite(p.y))),
  reset: () => recenter(),
  ropeLen: () => segLen * (N - 1),
  anchor: () => ({ x: anchorX, y: anchorY }),
};
`;

  const fn = new Function('document', 'window', 'performance', 'requestAnimationFrame', 'globalThis', code + suffix);
  fn(documentStub, windowStub, performanceStub, raf, globalThis);
  return globalThis.__api;
}

const api = loadToy();
let failures = 0;

function check(label, cond, extra = '') {
  if (cond) {
    console.log(`  OK   ${label}`);
  } else {
    failures++;
    console.log(`  FAIL ${label}${extra ? ' -> ' + extra : ''}`);
  }
}

function swipe() {
  const b = api.inspect();
  const bx = b.bobx, by = b.boby;
  for (let f = 0; f <= 6; f++) {
    api.setMouse(bx - 80 + f * (160 / 6), by);
    clock += 16; api.step(1);
  }
  api.setMouse(bx + 500, by - 300);
  for (let g = 0; g < 12; g++) { clock += 16; api.step(1); }
}

console.log('== Repos : aucun mouvement de souris ==');
api.reset();
api.step(120);
const a1 = api.inspect();
api.step(120);
const a2 = api.inspect();
check('pas de NaN', !a2.anyNaN);
check('s\'endort', a2.asleep === true);
check('parfaitement immobile', Math.abs(a2.boby - a1.boby) < 0.5, `dy=${(a2.boby - a1.boby).toFixed(3)}`);

console.log('== Casse : tirage fort a sensibilite max (1.0) ==');
api.reset();
api.setSens(1);
api.setDragging(true);
let framesToBreak = -1;
for (let i = 0; i < 800; i++) {
  api.setMouse(1900, 1000);
  clock += 16;
  api.step(1);
  if (api.inspect().state === 'broken') { framesToBreak = i + 1; break; }
}
check('la corde casse', api.inspect().state === 'broken');
check('rupture dans un delai jouable (< 5s)', framesToBreak > 0 && framesToBreak < 300);

console.log('== Chute libre puis reapparition ==');
let fellOff = false;
for (let i = 0; i < 120; i++) { clock += 16; api.step(1); if (api.inspect().boby > 1040) { fellOff = true; break; } }
check('sort de l\'ecran par le bas', fellOff);
check('pas de NaN pendant la chute', !api.inspect().anyNaN);
clock += 2700; // > RESPAWN_MS (2600 par defaut)
api.step(1);
const c0 = api.inspect();
check('revenue a l\'etat alive', c0.state === 'alive');
check('usure remise a zero', c0.stress === 0);
check('repart d\'en haut', c0.boby < api.ropeLen() * 0.75, `boby=${c0.boby}`);
for (let k = 0; k < 600; k++) api.step(1);
const c1 = api.inspect();
check('se re-suspend (~ancre+corde)', Math.abs(c1.boby - (api.anchor().y + api.ropeLen())) < 10, `boby=${c1.boby}`);
check('pas de NaN au total', !c1.anyNaN);

console.log('== Reveil par coup de patte ==');
const wasAsleep = api.inspect().asleep;
const bx = api.anchor().x;
api.setMouse(bx - 60, api.inspect().boby);
clock += 16; api.step(1);
api.setMouse(bx + 60, api.inspect().boby);
clock += 16; api.step(1);
check('etait bien endormie avant', wasAsleep === true);
check('le coup de patte reveille', api.inspect().asleep === false);

console.log('== Fragilite par defaut (0.4) : un coup ne casse jamais ==');
api.reset();
api.setSens(0.4);
swipe();
check('un seul coup ne casse pas', api.inspect().state !== 'broken');

// Coup de patte franc a travers la tete (souris rapide, dans BAT_R).
function batThroughBob() {
  const b = api.inspect();
  api.setMouse(b.bobx - 60, b.boby); clock += 16; api.step(1);
  api.setMouse(b.bobx + 20, b.boby); clock += 16; api.step(1);
}

console.log('== Dedoublement : vrais clones disperses ==');
api.reset();
api.setStress(0);
check('pas de dedoublement au repos', !api.splitActive() && api.cloneCount() === 0);

// stade noir + on insiste (esquive neutralisee) -> dedoublement
api.reset();
api.setStress(0.8);
api.setDodgeReady(1e9);
api.armSplit();
batThroughBob();
check('se dedouble au stade noir', api.splitActive());
check('1 a 5 copies (2-6 tetes au total)', api.cloneCount() >= 1 && api.cloneCount() <= 5, `n=${api.cloneCount()}`);

// les mini-cordes se balancent sans NaN, et le rendu ne plante pas
let cloneNaN = false;
for (let i = 0; i < 120 && api.splitActive(); i++) {
  clock += 16; api.step(1); api.renderOnce();
  if (api.clonesNaN() || api.inspect().anyNaN) cloneNaN = true;
}
check('pas de NaN pendant le dedoublement', !cloneNaN);

// refusion : au-dela de la fenetre, plus de clones, la vraie tete revient
clock += 2400; api.step(1);
check('refusionne (plus de clones)', !api.splitActive() && api.cloneCount() === 0);
check('la vraie tete est de retour', api.inspect().state === 'alive' && !api.inspect().anyNaN);

// apres refusion, la tete se re-suspend proprement
for (let k = 0; k < 400; k++) { clock += 16; api.step(1); }
check('pas de NaN au total', !api.inspect().anyNaN);

console.log(failures === 0 ? '\n=== TOUS LES TESTS PASSENT ===' : `\n=== ${failures} TEST(S) EN ECHEC ===`);
process.exit(failures === 0 ? 0 : 1);
