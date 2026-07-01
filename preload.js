'use strict';

const { contextBridge, ipcRenderer } = require('electron');

// API exposee aux deux fenetres (overlay + fenetre Parametres).
contextBridge.exposeInMainWorld('toy', {
  // --- Overlay : click-through ---
  setInteractive: (interactive) => ipcRenderer.send('set-interactive', !!interactive),
  onRecenter: (cb) => ipcRenderer.on('recenter', () => cb()),
  onSetPaused: (cb) => ipcRenderer.on('set-paused', (_e, paused) => cb(!!paused)),

  // --- Reglages (partages) ---
  getSettings: () => ipcRenderer.sendSync('get-settings'),
  setSettings: (patch) => ipcRenderer.send('settings-set', patch),
  resetSettings: () => ipcRenderer.send('settings-reset'),
  onSettings: (cb) => ipcRenderer.on('settings', (_e, s) => cb(s)),
});
