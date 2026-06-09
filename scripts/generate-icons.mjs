/**
 * Generate the PWA icon set (public/icons/*.png) with zero dependencies —
 * a hand-rolled PNG encoder over node:zlib. The artwork is the app's ember
 * orb: molten gold core falling off to ember orange on a near-black warm
 * ground, matching the Catching Fire palette in styles.css.
 *
 * Run with: node scripts/generate-icons.mjs
 * The generated PNGs are committed; this script only needs re-running when
 * the artwork changes.
 */
import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

// ---------------------------------------------------------------------------
// Minimal PNG encoder (8-bit RGBA, no filtering)
// ---------------------------------------------------------------------------

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return ~c >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePng(size, pixelAt) {
  const raw = Buffer.alloc(size * (1 + size * 4));
  let o = 0;
  for (let y = 0; y < size; y++) {
    raw[o++] = 0; // filter: none
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = pixelAt(x, y);
      raw[o++] = r;
      raw[o++] = g;
      raw[o++] = b;
      raw[o++] = a;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type: RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// ---------------------------------------------------------------------------
// Ember orb artwork
// ---------------------------------------------------------------------------

const BG = [23, 19, 16]; // near-black warm ground
const GOLD = [246, 196, 84]; // molten gold core
const EMBER = [226, 115, 58]; // ember orange
const DEEP = [140, 52, 28]; // charred rim

const mix = (a, b, t) => [
  Math.round(a[0] + (b[0] - a[0]) * t),
  Math.round(a[1] + (b[1] - a[1]) * t),
  Math.round(a[2] + (b[2] - a[2]) * t),
];

/**
 * @param size   icon edge in px
 * @param orbFrac orb radius as a fraction of the edge (smaller = more padding,
 *                used for the maskable variant's safe zone)
 */
function emberOrb(size, orbFrac) {
  const c = size / 2;
  const R = size * orbFrac;
  const glowAt = (d) => {
    const g = Math.exp(-(((d - R) / (R * 0.55)) ** 1.4)) * 0.35;
    return mix(BG, EMBER, Math.max(0, g));
  };
  return (x, y) => {
    const dx = x + 0.5 - c;
    const dy = y + 0.5 - c;
    const d = Math.hypot(dx, dy);
    if (d <= R) {
      const t = d / R;
      // Slightly off-center hot spot so the orb reads as lit from above.
      const lift = Math.max(0, -dy / R) * 0.12;
      const tt = Math.max(0, Math.min(1, t - lift));
      const core = tt < 0.55 ? mix(GOLD, EMBER, tt / 0.55) : mix(EMBER, DEEP, (tt - 0.55) / 0.45);
      const edge = Math.max(0, Math.min(1, R - d)); // 1px anti-alias rim
      const px = edge >= 1 ? core : mix(glowAt(d), core, edge);
      return [...px, 255];
    }
    return [...glowAt(d), 255];
  };
}

mkdirSync(join(root, "public", "icons"), { recursive: true });
const targets = [
  ["icon-192.png", 192, 0.36],
  ["icon-512.png", 512, 0.36],
  ["icon-maskable-512.png", 512, 0.3], // orb inside the 40% safe-zone circle
];
for (const [name, size, orbFrac] of targets) {
  const file = join(root, "public", "icons", name);
  writeFileSync(file, encodePng(size, emberOrb(size, orbFrac)));
  console.log(`wrote ${file}`);
}
