'use strict';

const { app, BrowserWindow, Tray, Menu, ipcMain, globalShortcut, screen, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const { buildTrayIconBuffer } = require('./scripts/gen-icon');

const overlays = new Map(); // id d'ecran -> BrowserWindow (un Koro-ball independant par ecran)
let settingsWin = null;
let tray = null;
let paused = false;

// ---- Reglages ----------------------------------------------------------
const DEFAULT_SETTINGS = {
  ball: { color: '#f4c430', radius: 26 },
  rope: { color: '#d2b48c', length: 340, stiffness: 18 },
  break: { enabled: true, sensitivity: 0.4, respawnMs: 2600 },
  placement: { anchorPct: 0.5 },
  autostart: false,
};

let settings = clone(DEFAULT_SETTINGS);

function clone(o) { return JSON.parse(JSON.stringify(o)); }

// Fusion recursive (2 niveaux) : conserve les cles manquantes depuis la base.
function deepMerge(base, patch) {
  const out = clone(base);
  for (const k of Object.keys(patch || {})) {
    const v = patch[k];
    out[k] = (v && typeof v === 'object' && !Array.isArray(v)) ? deepMerge(base[k] || {}, v) : v;
  }
  return out;
}

function settingsPath() { return path.join(app.getPath('userData'), 'settings.json'); }

function loadSettings() {
  try {
    const raw = fs.readFileSync(settingsPath(), 'utf8');
    settings = deepMerge(DEFAULT_SETTINGS, JSON.parse(raw));
  } catch (_e) {
    settings = clone(DEFAULT_SETTINGS);
  }
}

function saveSettings() {
  try {
    fs.mkdirSync(path.dirname(settingsPath()), { recursive: true });
    fs.writeFileSync(settingsPath(), JSON.stringify(settings, null, 2));
  } catch (_e) { /* non bloquant */ }
}

// Effet cote main qui ne depend pas d'un ecran : demarrage auto.
function applyMainSide() {
  app.setLoginItemSettings({ openAtLogin: !!settings.autostart });
}

function broadcastToOverlays(channel, ...args) {
  for (const w of overlays.values()) {
    if (!w.isDestroyed()) w.webContents.send(channel, ...args);
  }
}

function broadcastSettings() {
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed()) w.webContents.send('settings', settings);
  }
}

// ---- Overlays : un Koro-ball independant par ecran connecte -----------
function createOverlayForDisplay(display) {
  const { x, y, width, height } = display.workArea;

  const win = new BrowserWindow({
    x, y, width, height,
    transparent: true,
    frame: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    hasShadow: false,
    focusable: false, // ne vole jamais le focus a l'appli active
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });

  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.setIgnoreMouseEvents(true, { forward: true });

  win.once('ready-to-show', () => win.show());
  win.webContents.on('render-process-gone', () => {
    if (!win.isDestroyed()) win.reload();
  });
  win.on('closed', () => { overlays.delete(display.id); });

  overlays.set(display.id, win);
}

// Aligne le jeu d'overlays sur les ecrans reellement connectes : cree un
// Koro-ball pour tout nouvel ecran, ferme celui d'un ecran debranche, et
// repositionne les autres si leur zone de travail a change (resolution,
// DPI, barre des taches).
function syncOverlays() {
  const displays = screen.getAllDisplays();
  const liveIds = new Set(displays.map((d) => d.id));

  for (const [id, w] of overlays) {
    if (!liveIds.has(id) && !w.isDestroyed()) w.close();
  }
  for (const display of displays) {
    const existing = overlays.get(display.id);
    if (existing && !existing.isDestroyed()) {
      existing.setBounds(display.workArea);
    } else {
      createOverlayForDisplay(display);
    }
  }
}

// ---- Fenetre de reglages ----------------------------------------------
function openSettings() {
  if (settingsWin && !settingsWin.isDestroyed()) { settingsWin.focus(); return; }
  settingsWin = new BrowserWindow({
    width: 460,
    height: 680,
    resizable: false,
    fullscreenable: false,
    title: 'Koro-ball — Paramètres',
    autoHideMenuBar: true,
    backgroundColor: '#1e1f24',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  settingsWin.loadFile(path.join(__dirname, 'settings', 'index.html'));
  settingsWin.on('closed', () => { settingsWin = null; });
}

// ---- IPC ---------------------------------------------------------------
// Le click-through s'applique a l'overlay qui a envoye le message (chaque
// ecran a sa propre fenetre, donc son propre etat interactif/traversant).
ipcMain.on('set-interactive', (e, interactive) => {
  const w = BrowserWindow.fromWebContents(e.sender);
  if (w && !w.isDestroyed()) w.setIgnoreMouseEvents(!interactive, { forward: true });
});

ipcMain.on('get-settings', (e) => { e.returnValue = settings; });

ipcMain.on('settings-set', (_e, patch) => {
  settings = deepMerge(settings, patch);
  saveSettings();
  applyMainSide();
  broadcastSettings();
  rebuildTrayMenu();
});

ipcMain.on('settings-reset', () => {
  settings = clone(DEFAULT_SETTINGS);
  saveSettings();
  applyMainSide();
  broadcastSettings();
  rebuildTrayMenu();
});

// ---- Tray --------------------------------------------------------------
function trayIconImage() {
  const p = path.join(__dirname, 'assets', 'tray.png');
  try {
    if (fs.existsSync(p)) {
      const img = nativeImage.createFromPath(p);
      if (!img.isEmpty()) return img;
    }
  } catch (_e) { /* repli buffer memoire */ }
  return nativeImage.createFromBuffer(buildTrayIconBuffer());
}

function buildTray() {
  tray = new Tray(trayIconImage());
  tray.setToolTip('Koro-ball');
  tray.on('double-click', openSettings);
  rebuildTrayMenu();
}

function rebuildTrayMenu() {
  if (!tray) return;
  const menu = Menu.buildFromTemplate([
    { label: paused ? 'Reprendre' : 'Pause', click: togglePause },
    { label: 'Paramètres…', click: openSettings },
    { type: 'separator' },
    {
      label: 'La corde peut casser',
      type: 'checkbox',
      checked: settings.break.enabled,
      click: (mi) => { settings.break.enabled = mi.checked; saveSettings(); broadcastSettings(); },
    },
    {
      label: 'Démarrer avec Windows',
      type: 'checkbox',
      checked: settings.autostart,
      click: (mi) => { settings.autostart = mi.checked; saveSettings(); applyMainSide(); },
    },
    { label: 'Recentrer le jouet', click: () => broadcastToOverlays('recenter') },
    { type: 'separator' },
    { label: 'Quitter', click: () => app.quit() },
  ]);
  tray.setContextMenu(menu);
}

function togglePause() {
  paused = !paused;
  broadcastToOverlays('set-paused', paused);
  rebuildTrayMenu();
}

// ---- Raccourcis --------------------------------------------------------
function registerFirst(accelerators, handler) {
  for (const acc of accelerators) {
    if (globalShortcut.register(acc, handler)) return acc;
  }
  return null;
}

// ---- Cycle de vie ------------------------------------------------------
app.whenReady().then(() => {
  loadSettings();
  syncOverlays();
  buildTray();
  applyMainSide();

  registerFirst(['CommandOrControl+Alt+P', 'CommandOrControl+Shift+P'], togglePause);
  const quitAcc = registerFirst(['CommandOrControl+Alt+Q', 'CommandOrControl+Shift+Q'], () => app.quit());
  if (!quitAcc) console.warn('[koro-ball] Aucun raccourci Quitter dispo — utilise le menu du tray.');

  screen.on('display-metrics-changed', syncOverlays);
  screen.on('display-added', syncOverlays);
  screen.on('display-removed', syncOverlays);
});

app.on('will-quit', () => { globalShortcut.unregisterAll(); });

// Overlay de bureau : on ne quitte pas quand une fenetre se ferme (vit dans le tray).
app.on('window-all-closed', () => { /* no-op volontaire */ });
