'use strict';

/*
 * Genere l'icone "boule a grelot" doree en PNG RGBA, a n'importe quelle taille.
 * Encodage PNG manuel via zlib -> aucune dependance externe.
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

// --- Construit un PNG "boule doree" de taille `size` --------------------
function buildIconBuffer(size = 32) {
  const raw = Buffer.alloc(size * (size * 4 + 1)); // +1 octet de filtre par ligne
  const cx = size / 2 - 0.5;
  const cy = size / 2 - 0.5;
  const R = size * 0.44;
  const lightOff = size * 0.125;

  for (let y = 0; y < size; y++) {
    const rowStart = y * (size * 4 + 1);
    raw[rowStart] = 0; // filtre 0 (None)
    for (let x = 0; x < size; x++) {
      const off = rowStart + 1 + x * 4;
      const d = Math.hypot(x - cx, y - cy);
      if (d <= R) {
        const light = Math.max(0, 1 - Math.hypot(x - (cx - lightOff), y - (cy - lightOff)) / (R * 1.3));
        const t = d / R;
        const rr = Math.round(240 - t * 120 + light * 30);
        const gg = Math.round(180 - t * 110 + light * 40);
        const bb = Math.round(60 - t * 40 + light * 30);
        raw[off] = Math.min(255, Math.max(0, rr));
        raw[off + 1] = Math.min(255, Math.max(0, gg));
        raw[off + 2] = Math.min(255, Math.max(0, bb));
        raw[off + 3] = d > R - 1 ? 180 : 255;
      } else {
        raw[off] = 0; raw[off + 1] = 0; raw[off + 2] = 0; raw[off + 3] = 0;
      }
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
