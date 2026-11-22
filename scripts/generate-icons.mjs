import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ICONS_DIR = path.resolve(__dirname, '..', 'public', 'icons');
fs.mkdirSync(ICONS_DIR, { recursive: true });

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) {
    c ^= buf[i];
    for (let k = 0; k < 8; k += 1) {
      c = (c >>> 1) ^ (c & 1 ? 0xedb88320 : 0);
    }
  }
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length, 0);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
}

function encodePng(width, height, rgba) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * (stride + 1);
    raw[rowStart] = 0;
    rgba.copy(raw, rowStart + 1, y * stride, (y + 1) * stride);
  }

  const compressed = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([
    signature,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', compressed),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

function renderIcon(size) {
  const buf = Buffer.alloc(size * size * 4);
  const s = size / 512;
  const rad = 108 * s;

  function insideRoundedRect(x, y, rx, ry, rw, rh, r) {
    if (x < rx || x > rx + rw || y < ry || y > ry + rh) return false;
    const cx = x < rx + r ? rx + r : x > rx + rw - r ? rx + rw - r : x;
    const cy = y < ry + r ? ry + r : y > ry + rh - r ? ry + rh - r : y;
    const dx = x - cx;
    const dy = y - cy;
    return dx * dx + dy * dy <= r * r;
  }

  function inSegment(px, py, x1, y1, x2, y2, thickness) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const lenSq = dx * dx + dy * dy;
    let t = lenSq === 0 ? 0 : ((px - x1) * dx + (py - y1) * dy) / lenSq;
    t = Math.max(0, Math.min(1, t));
    const cx = x1 + t * dx;
    const cy = y1 + t * dy;
    const distSq = (px - cx) * (px - cx) + (py - cy) * (py - cy);
    return distSq <= (thickness * 0.5) * (thickness * 0.5);
  }

  const cos = Math.cos(32 * (Math.PI / 180));
  const sin = Math.sin(32 * (Math.PI / 180));

  for (let py = 0; py < size; py += 1) {
    for (let px = 0; px < size; px += 1) {
      const idx = (py * size + px) * 4;
      const x = px / s;
      const y = py / s;

      if (!insideRoundedRect(px, py, 0, 0, size, size, rad)) {
        buf[idx] = 0;
        buf[idx + 1] = 0;
        buf[idx + 2] = 0;
        buf[idx + 3] = 0;
        continue;
      }

      // Base dark slate gradient
      const grad = (x + y) / 1024;
      let r = Math.round(15 + grad * 15);
      let g = Math.round(23 + grad * 18);
      let b = Math.round(42 + grad * 17);

      // Reticle corners in safety amber
      const t = 18;
      const onBracket =
        inSegment(x, y, 128, 168, 128, 128, t) ||
        inSegment(x, y, 128, 128, 168, 128, t) ||
        inSegment(x, y, 344, 128, 384, 128, t) ||
        inSegment(x, y, 384, 128, 384, 168, t) ||
        inSegment(x, y, 128, 344, 128, 384, t) ||
        inSegment(x, y, 128, 384, 168, 384, t) ||
        inSegment(x, y, 344, 384, 384, 384, t) ||
        inSegment(x, y, 384, 384, 384, 344, t);

      if (onBracket) {
        r = 245;
        g = 158;
        b = 11;
      }

      // Rotate coordinates into bit space (-32 deg visual -> +32 deg inverse)
      const dx = x - 256;
      const dy = y - 256;
      const bx = dx * cos - dy * sin + 256;
      const by = dx * sin + dy * cos + 256;

      // Tip triangle (226..286, y 48..104)
      const inTip =
        by >= 48 &&
        by <= 104 &&
        Math.abs(bx - 256) <= ((by - 48) / (104 - 48)) * 30;
      const inBody = bx >= 226 && bx <= 286 && by >= 104 && by <= 330;
      const inCollar = bx >= 222 && bx <= 290 && by >= 330 && by <= 352;
      const inShank = bx >= 232 && bx <= 280 && by >= 352 && by <= 418;

      if (inTip || inBody) {
        const fluteOffset = ((bx - 226) / 60) * 32;
        const relY = by - fluteOffset;
        const isFlute =
          inBody &&
          ((relY >= 140 && relY <= 164) ||
            (relY >= 198 && relY <= 222) ||
            (relY >= 256 && relY <= 280));
        if (isFlute) {
          r = 51;
          g = 65;
          b = 85;
        } else {
          const highlight = 1 - Math.abs(bx - 252) / 45;
          r = Math.round(180 + highlight * 65);
          g = Math.round(192 + highlight * 58);
          b = Math.round(208 + highlight * 44);
        }
      } else if (inCollar) {
        r = 245;
        g = 158;
        b = 11;
      } else if (inShank) {
        r = 148;
        g = 163;
        b = 184;
      }

      buf[idx] = r;
      buf[idx + 1] = g;
      buf[idx + 2] = b;
      buf[idx + 3] = 255;
    }
  }
  return encodePng(size, size, buf);
}

for (const size of [180, 192, 512]) {
  const png = renderIcon(size);
  fs.writeFileSync(path.join(ICONS_DIR, `icon-${size}.png`), png);
}
console.log('Generated PNG icons: 180, 192, 512');
