'use strict';

const { app, BrowserWindow, Tray, Menu, ipcMain, globalShortcut, screen, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const { buildTrayIconBuffer } = require('./scripts/gen-icon');

let win = null;          // overlay unique, etendu sur tous les ecrans
let settingsWin = null;
let tray = null;
let paused = false;

// ---- Reglages ----------------------------------------------------------
const DEFAULT_SETTINGS = {
  ball: { color: '#f4c430', radius: 26 },
  rope: { color: '#d2b48c', length: 340, stiffness: 15 },
  break: { sensitivity: 0.3, respawnMs: 3000 },
  placement: { anchorPct: 0.38 },
  dodge: { machSpeed: 20 },
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

function broadcastSettings() {
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed()) w.webContents.send('settings', settings);
  }
}

// Rectangle englobant tous les ecrans connectes : Koro-ball peut ainsi se
// balancer, se faire lancer et traverser d'un ecran a l'autre. Base sur
// workArea (pas bounds) pour ne jamais recouvrir la barre des taches.
function virtualDesktopBounds() {
  const areas = screen.getAllDisplays().map((d) => d.workArea);
  const left = Math.min(...areas.map((a) => a.x));
  const top = Math.min(...areas.map((a) => a.y));
  const right = Math.max(...areas.map((a) => a.x + a.width));
  const bottom = Math.max(...areas.map((a) => a.y + a.height));
  return { x: left, y: top, width: right - left, height: bottom - top };
}

// ---- Overlay -------------------------------------------------------------
function createWindow() {
  // Chromium restreint silencieusement la taille demandee AU CONSTRUCTEUR a un
  // seul ecran (meme avec resizable:false) : sur Windows, une fenetre plus
  // large que le moniteur qui la contient est clampee des la creation. On
  // cree donc une fenetre minimale, puis on l'etend via setBounds() ensuite —
  // ce chemin-la n'est pas soumis a la meme restriction.
  win = new BrowserWindow({
    x: 0, y: 0, width: 1, height: 1,
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
  win.setBounds(virtualDesktopBounds());

  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.setIgnoreMouseEvents(true, { forward: true });

  win.once('ready-to-show', () => win.show());
  win.webContents.on('render-process-gone', () => {
    if (win && !win.isDestroyed()) win.reload();
  });
  win.on('closed', () => { win = null; });
}

// Reajuste la fenetre sur l'union des ecrans quand la configuration change
// (branchement/debranchement d'un moniteur, resolution, barre des taches).
function fitToVirtualDesktop() {
  if (win && !win.isDestroyed()) win.setBounds(virtualDesktopBounds());
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
ipcMain.on('set-interactive', (_e, interactive) => {
  if (win && !win.isDestroyed()) win.setIgnoreMouseEvents(!interactive, { forward: true });
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
      label: 'Démarrer avec Windows',
      type: 'checkbox',
      checked: settings.autostart,
      click: (mi) => { settings.autostart = mi.checked; saveSettings(); applyMainSide(); },
    },
    { label: 'Recentrer le jouet', click: () => win && win.webContents.send('recenter') },
    { type: 'separator' },
    { label: 'Quitter', click: () => app.quit() },
  ]);
  tray.setContextMenu(menu);
}

function togglePause() {
  paused = !paused;
  if (win) win.webContents.send('set-paused', paused);
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
  createWindow();
  buildTray();
  applyMainSide();

  registerFirst(['CommandOrControl+Alt+P', 'CommandOrControl+Shift+P'], togglePause);
  const quitAcc = registerFirst(['CommandOrControl+Alt+Q', 'CommandOrControl+Shift+Q'], () => app.quit());
  if (!quitAcc) console.warn('[koro-ball] Aucun raccourci Quitter dispo — utilise le menu du tray.');

  screen.on('display-metrics-changed', fitToVirtualDesktop);
  screen.on('display-added', fitToVirtualDesktop);
  screen.on('display-removed', fitToVirtualDesktop);
});

app.on('will-quit', () => { globalShortcut.unregisterAll(); });

// Overlay de bureau : on ne quitte pas quand une fenetre se ferme (vit dans le tray).
app.on('window-all-closed', () => { /* no-op volontaire */ });
