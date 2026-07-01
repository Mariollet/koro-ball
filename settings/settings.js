'use strict';

const el = (id) => document.getElementById(id);

const CONTROLS = ['ballRadius', 'ropeColor', 'ropeLength', 'ropeStiffness',
  'breakEnabled', 'breakSens', 'respawnMs', 'anchorPct', 'autostart'];

function renderOutputs() {
  el('ballRadiusOut').textContent = el('ballRadius').value + ' px';
  el('ropeLengthOut').textContent = el('ropeLength').value + ' px';
  el('ropeStiffnessOut').textContent = el('ropeStiffness').value;
  el('breakSensOut').textContent = Number(el('breakSens').value).toFixed(1) + '×';
  el('respawnMsOut').textContent = (Number(el('respawnMs').value) / 1000).toFixed(1) + ' s';
  el('anchorPctOut').textContent = Math.round(Number(el('anchorPct').value) * 100) + ' %';
}

function fill(s) {
  el('ballRadius').value = s.ball.radius;
  el('ropeColor').value = s.rope.color;
  el('ropeLength').value = s.rope.length;
  el('ropeStiffness').value = s.rope.stiffness;
  el('breakEnabled').checked = s.break.enabled;
  el('breakSens').value = s.break.sensitivity;
  el('respawnMs').value = s.break.respawnMs;
  el('anchorPct').value = s.placement.anchorPct;
  el('autostart').checked = s.autostart;
  renderOutputs();
}

function collect() {
  return {
    ball: { radius: +el('ballRadius').value },
    rope: { color: el('ropeColor').value, length: +el('ropeLength').value, stiffness: +el('ropeStiffness').value },
    break: { enabled: el('breakEnabled').checked, sensitivity: +el('breakSens').value, respawnMs: +el('respawnMs').value },
    placement: { anchorPct: +el('anchorPct').value },
    autostart: el('autostart').checked,
  };
}

function push() {
  renderOutputs();
  window.toy.setSettings(collect());
}

CONTROLS.forEach((id) => {
  el(id).addEventListener('input', push);
  el(id).addEventListener('change', push);
});

el('reset').addEventListener('click', () => window.toy.resetSettings());

// Le main renvoie les reglages (au chargement + apres un reset)
window.toy.onSettings((s) => fill(s));

fill(window.toy.getSettings());
