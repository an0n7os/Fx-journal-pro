// Builds every favicon and app icon from public/Icon.svg, so the mark is
// drawn once and the browser, the iOS home screen and the PWA manifest all
// show the same logo.
//
//   npm run icons
//
// Why a rasteriser lives here rather than a dependency: the mark is three
// filled polygons and nothing else — no curves, no strokes, no gradients — so
// scan-converting it is about sixty lines, and that is cheaper than adding an
// image toolchain to a project that otherwise has none. If the artwork ever
// gains a curve, this stops being the right call and `sharp` becomes it.
//
// Re-run after changing public/Icon.svg. The outputs are committed, because a
// deploy must not depend on this having been run.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const ROOT = path.resolve(import.meta.dirname, '..');
const PUBLIC = path.join(ROOT, 'public');
const SOURCE = path.join(PUBLIC, 'Icon.svg');

/** Page background, so an opaque icon sits on the product's own black. */
const GROUND = [6, 9, 19]; // #060913

/**
 * How much of the canvas the mark occupies.
 *
 * The artwork is cropped to its ink, so drawn at full bleed it touches all
 * four edges — in a tab strip that reads as larger and heavier than every
 * padded icon beside it. 0.78 lines it up with them.
 */
const INK_SCALE = 0.78;

/** Supersampling factor. 4 means 16 samples per pixel, which is enough for
 *  straight edges at 16px and costs nothing at these sizes. */
const SS = 4;

// ── Read the artwork ──────────────────────────────────────────────────────

const svg = fs.readFileSync(SOURCE, 'utf-8');

const viewBox = /viewBox="([-\d.\s]+)"/.exec(svg);
if (!viewBox) throw new Error('Icon.svg has no viewBox');
const [vbX, vbY, vbW, vbH] = viewBox[1].trim().split(/\s+/).map(Number);

const fillMatch = /fill:\s*(#[0-9a-f]{3,8})/i.exec(svg);
const FILL = fillMatch ? hexToRgb(fillMatch[1]) : [125, 51, 255];

const polygons = [...svg.matchAll(/<polygon[^>]*points="([^"]+)"/g)].map((m) => {
  const nums = m[1].trim().split(/[\s,]+/).map(Number);
  const pts = [];
  for (let i = 0; i < nums.length; i += 2) pts.push([nums[i], nums[i + 1]]);
  return pts;
});
if (!polygons.length) throw new Error('Icon.svg has no <polygon> to draw');

function hexToRgb(hex) {
  let h = hex.slice(1);
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
}

// ── Rasteriser ────────────────────────────────────────────────────────────

/**
 * Coverage of the mark over a size x size grid, 0..1 per pixel.
 *
 * The artwork is fitted into a square centred on the canvas: the mark is
 * 707 x 726, so fitting by the LONGER side keeps it from being stretched.
 */
function renderCoverage(size) {
  const target = size * INK_SCALE;
  const scale = target / Math.max(vbW, vbH);
  const offsetX = (size - vbW * scale) / 2;
  const offsetY = (size - vbH * scale) / 2;

  // Project once, so the inner loop is plain arithmetic on numbers.
  const shapes = polygons.map((pts) =>
    pts.map(([x, y]) => [(x - vbX) * scale + offsetX, (y - vbY) * scale + offsetY])
  );
  const boxes = shapes.map((pts) => {
    const xs = pts.map((p) => p[0]);
    const ys = pts.map((p) => p[1]);
    return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
  });

  const cov = new Float32Array(size * size);
  const step = 1 / SS;
  const half = step / 2;

  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let hits = 0;
      for (let sy = 0; sy < SS; sy++) {
        const y = py + sy * step + half;
        for (let sx = 0; sx < SS; sx++) {
          const x = px + sx * step + half;
          for (let s = 0; s < shapes.length; s++) {
            const b = boxes[s];
            if (x < b[0] || x > b[2] || y < b[1] || y > b[3]) continue;
            if (pointInPolygon(x, y, shapes[s])) { hits++; break; }
          }
        }
      }
      cov[py * size + px] = hits / (SS * SS);
    }
  }
  return cov;
}

/** Even-odd crossing count. The shapes are simple and disjoint, so this and
 *  the nonzero rule agree. */
function pointInPolygon(x, y, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i];
    const [xj, yj] = pts[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/**
 * RGBA pixels for one icon.
 *
 * `opaque` decides whether the mark sits on the product's black or on
 * nothing. iOS composites a transparent apple-touch-icon onto BLACK and
 * Android maskable icons are cropped, so those have to be opaque; a browser
 * tab is the opposite case, where transparency is what lets the icon sit on
 * whichever chrome the user has.
 */
function renderRgba(size, opaque) {
  const cov = renderCoverage(size);
  const out = Buffer.alloc(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    const a = cov[i];
    const o = i * 4;
    if (opaque) {
      // Composite the mark over the ground, so edges blend into the
      // background rather than into whatever is behind the icon.
      out[o] = Math.round(FILL[0] * a + GROUND[0] * (1 - a));
      out[o + 1] = Math.round(FILL[1] * a + GROUND[1] * (1 - a));
      out[o + 2] = Math.round(FILL[2] * a + GROUND[2] * (1 - a));
      out[o + 3] = 255;
    } else {
      out[o] = FILL[0];
      out[o + 1] = FILL[1];
      out[o + 2] = FILL[2];
      out[o + 3] = Math.round(a * 255);
    }
  }
  return out;
}

// ── PNG ───────────────────────────────────────────────────────────────────

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
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePng(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // colour type: RGBA
  // 10..12 are compression, filter and interlace, all 0.

  // Filter type 0 on every scanline. The images are tiny and the shapes are
  // flat colour, so a filter search would buy nothing.
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ── ICO ───────────────────────────────────────────────────────────────────

/** An .ico may embed PNGs directly, which every browser that still asks for
 *  /favicon.ico supports, and which avoids hand-rolling a BMP with its
 *  upside-down rows and separate AND mask. */
function encodeIco(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(images.length, 4);

  const entries = [];
  let offset = 6 + images.length * 16;
  for (const { size, png } of images) {
    const e = Buffer.alloc(16);
    e[0] = size >= 256 ? 0 : size; // 0 means 256
    e[1] = size >= 256 ? 0 : size;
    e[2] = 0; // palette size
    e[3] = 0; // reserved
    e.writeUInt16LE(1, 4);   // colour planes
    e.writeUInt16LE(32, 6);  // bits per pixel
    e.writeUInt32LE(png.length, 8);
    e.writeUInt32LE(offset, 12);
    entries.push(e);
    offset += png.length;
  }

  return Buffer.concat([header, ...entries, ...images.map((i) => i.png)]);
}

// ── Outputs ───────────────────────────────────────────────────────────────

const write = (name, buf) => {
  fs.writeFileSync(path.join(PUBLIC, name), buf);
  console.log(`  ${name.padEnd(24)} ${String(buf.length).padStart(7)} bytes`);
};

console.log('\nIcons from public/Icon.svg\n');

// A padded square SVG, so the tab icon is the vector wherever SVG favicons
// are supported and the PNGs are only a fallback.
const scale = (1024 * INK_SCALE) / Math.max(vbW, vbH);
const tx = (1024 - vbW * scale) / 2 - vbX * scale;
const ty = (1024 - vbH * scale) / 2 - vbY * scale;
const bodyShapes = polygons
  .map((pts) => `    <polygon points="${pts.map((p) => p.join(' ')).join(' ')}"/>`)
  .join('\n');
write(
  'favicon.svg',
  Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024">
  <!-- Generated by scripts/generate-icons.mjs from Icon.svg. Do not edit. -->
  <g fill="${fillMatch ? fillMatch[1] : '#7d33ff'}" transform="translate(${tx.toFixed(2)} ${ty.toFixed(2)}) scale(${scale.toFixed(5)})">
${bodyShapes}
  </g>
</svg>
`,
    'utf-8'
  )
);

// Transparent, for browser tabs and bookmarks.
for (const size of [16, 32, 48, 96]) {
  write(`favicon-${size}.png`, encodePng(size, renderRgba(size, false)));
}

write(
  'favicon.ico',
  encodeIco([16, 32, 48].map((size) => ({ size, png: encodePng(size, renderRgba(size, false)) })))
);

// Opaque, for the places that composite onto black or crop the corners.
write('apple-touch-icon.png', encodePng(180, renderRgba(180, true)));
write('icon-192.png', encodePng(192, renderRgba(192, true)));
write('icon-512.png', encodePng(512, renderRgba(512, true)));

console.log('');
