'use strict';

/*
 * Genere l'icone "tete de Koro-sensei" (chapeau de diplome + grand sourire)
 * en PNG RGBA, a n'importe quelle taille. Dessin pixel par pixel, encodage
 * PNG manuel via zlib -> aucune dependance externe.
 *
 * CLI (`node scripts/gen-icon.js`) : ecrit assets/tray.png (32) + build/icon.png (256).
 * Importable : main.js appelle buildTrayIconBuffer() en repli du tray.
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

// --- CRC32 (spec PNG) ---------------------------------------------------
const crcTable = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

// --- Couleur d'un pixel en coordonnees normalisees (unites de rayon) ----
// (0,0) = centre de la tete ; le chapeau depasse vers le haut (dy negatif).
function koroPixel(dx, dy) {
  const d = Math.hypot(dx, dy);

  // gland dore du chapeau (au bout, cote droit)
  if (Math.hypot(dx - 0.66, dy + 0.60) < 0.11) return [216, 184, 74, 255];

  // planche du chapeau (losange aplati, depasse du crane)
  const ax = Math.abs(dx);
  if (ax <= 0.95) {
    const k = 1 - ax / 0.95;
    const yTop = -0.78 - 0.28 * k;
    const yBot = -0.78 + 0.20 * k;
    if (dy >= yTop && dy <= yBot) return [34, 34, 39, 255];
  }

  if (d > 1) return [0, 0, 0, 0];

  // bord adouci de la tete
  const edgeAlpha = d > 0.955 ? 175 : 255;

  // calotte sombre posee sur le crane
  if (dy < -0.62) return [46, 46, 52, edgeAlpha];

  // yeux (petits ovales sombres)
  const ex = (ax - 0.34) / 0.10;
  const ey = (dy + 0.30) / 0.12;
  if (ex * ex + ey * ey < 1) return [36, 31, 28, 255];

  // grand sourire croissant (entre deux paraboles), avec contour sombre
  const u = dx / 0.80;
  if (Math.abs(u) <= 1) {
    const bump = 1 - u * u;
    const yT = 0.02 + 0.17 * bump; // bord superieur (dents en haut)
    const yB = 0.02 + 0.47 * bump; // bord inferieur (creux du sourire)
    if (dy >= yT && dy <= yB) {
      const border = 0.055;
      if (dy - yT < border || yB - dy < border) return [58, 36, 24, 255];
      return [253, 251, 242, 255];
    }
  }

  // visage jaune, aplat legerement modele (lumiere en haut a gauche)
  const light = Math.max(0, 1 - Math.hypot(dx + 0.30, dy + 0.35) / 1.3);
  let r = 244, g = 196, b = 48;
  r = Math.min(255, r + light * 16);
  g = Math.min(255, g + light * 22);
  b = Math.min(255, b + light * 26);
  if (d > 0.82) {
    const k = (d - 0.82) / 0.18 * 0.22;
    r *= 1 - k; g *= 1 - k; b *= 1 - k;
  }
  return [Math.round(r), Math.round(g), Math.round(b), edgeAlpha];
}

// --- Construit le PNG en memoire ----------------------------------------
function buildIconBuffer(size = 32) {
  const raw = Buffer.alloc(size * (size * 4 + 1)); // +1 octet de filtre par ligne
  const cx = size * 0.5;
  const cy = size * 0.54;
  const R = size * 0.42;

  for (let y = 0; y < size; y++) {
    const rowStart = y * (size * 4 + 1);
    raw[rowStart] = 0; // filtre 0 (None)
    for (let x = 0; x < size; x++) {
      const off = rowStart + 1 + x * 4;
      const [r, g, b, a] = koroPixel((x + 0.5 - cx) / R, (y + 0.5 - cy) / R);
      raw[off] = r; raw[off + 1] = g; raw[off + 2] = b; raw[off + 3] = a;
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // color type RGBA
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// Icone du tray (32px) — utilisee par main.js en repli
function buildTrayIconBuffer() { return buildIconBuffer(32); }

function writeIcon(outPath, size) {
  const png = buildIconBuffer(size);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, png);
  return { path: outPath, size: png.length };
}

module.exports = { buildIconBuffer, buildTrayIconBuffer, writeIcon };

// Execution directe en CLI
if (require.main === module) {
  const tray = writeIcon(path.join(__dirname, '..', 'assets', 'tray.png'), 32);
  const app = writeIcon(path.join(__dirname, '..', 'build', 'icon.png'), 256);
  console.log('Icones generees :');
  console.log('  tray :', tray.path, `(${tray.size} o)`);
  console.log('  app  :', app.path, `(${app.size} o)`);
}
