/**
 * Dependency-free PNG generation for the pipeline check fixtures.
 *
 * The obvious choice here is sharp, but its native binary refuses to install on
 * some Windows setups — including the current dev machine — and a test fixture
 * is a bad reason to make the whole check script unrunnable. Node's built-in
 * zlib is enough to write a valid PNG, and a small bitmap font is enough to
 * produce text clean enough for Tesseract to read.
 *
 * Only used by scripts. Nothing in the application imports this.
 */
import zlib from 'zlib';

/**
 * 5x7 bitmap glyphs.
 *
 * The full A-Z, 0-9 and common punctuation. An incomplete set is worse than no
 * set at all: the fixture silently drops the missing letters, so "HAEMOGLOBIN"
 * renders as "AEMOGLO", the OCR check then reports "(unclear)", and the
 * pipeline looks broken when it is in fact correctly refusing to guess.
 */
const FONT = {
  A: ['.###.', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  B: ['####.', '#...#', '#...#', '####.', '#...#', '#...#', '####.'],
  C: ['.###.', '#...#', '#....', '#....', '#....', '#...#', '.###.'],
  D: ['####.', '#...#', '#...#', '#...#', '#...#', '#...#', '####.'],
  E: ['#####', '#....', '#....', '####.', '#....', '#....', '#####'],
  F: ['#####', '#....', '#....', '####.', '#....', '#....', '#....'],
  G: ['.###.', '#...#', '#....', '#.###', '#...#', '#...#', '.###.'],
  H: ['#...#', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  I: ['#####', '..#..', '..#..', '..#..', '..#..', '..#..', '#####'],
  J: ['..###', '...#.', '...#.', '...#.', '...#.', '#..#.', '.##..'],
  K: ['#...#', '#..#.', '#.#..', '##...', '#.#..', '#..#.', '#...#'],
  L: ['#....', '#....', '#....', '#....', '#....', '#....', '#####'],
  M: ['#...#', '##.##', '#.#.#', '#...#', '#...#', '#...#', '#...#'],
  N: ['#...#', '##..#', '#.#.#', '#..##', '#...#', '#...#', '#...#'],
  O: ['.###.', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
  P: ['####.', '#...#', '#...#', '####.', '#....', '#....', '#....'],
  Q: ['.###.', '#...#', '#...#', '#...#', '#.#.#', '#..#.', '.##.#'],
  R: ['####.', '#...#', '#...#', '####.', '#..#.', '#...#', '#...#'],
  S: ['.####', '#....', '#....', '.###.', '....#', '....#', '####.'],
  T: ['#####', '..#..', '..#..', '..#..', '..#..', '..#..', '..#..'],
  U: ['#...#', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
  V: ['#...#', '#...#', '#...#', '#...#', '#...#', '.#.#.', '..#..'],
  W: ['#...#', '#...#', '#...#', '#...#', '#.#.#', '##.##', '#...#'],
  X: ['#...#', '#...#', '.#.#.', '..#..', '.#.#.', '#...#', '#...#'],
  Y: ['#...#', '#...#', '.#.#.', '..#..', '..#..', '..#..', '..#..'],
  Z: ['#####', '....#', '...#.', '..#..', '.#...', '#....', '#####'],

  0: ['.###.', '#...#', '#..##', '#.#.#', '##..#', '#...#', '.###.'],
  1: ['..#..', '.##..', '..#..', '..#..', '..#..', '..#..', '#####'],
  2: ['.###.', '#...#', '....#', '...#.', '..#..', '.#...', '#####'],
  3: ['#####', '...#.', '..#..', '...#.', '....#', '#...#', '.###.'],
  4: ['...#.', '..##.', '.#.#.', '#..#.', '#####', '...#.', '...#.'],
  5: ['#####', '#....', '#....', '####.', '....#', '#...#', '.###.'],
  6: ['.###.', '#...#', '#....', '####.', '#...#', '#...#', '.###.'],
  7: ['#####', '....#', '...#.', '..#..', '.#...', '.#...', '.#...'],
  8: ['.###.', '#...#', '#...#', '.###.', '#...#', '#...#', '.###.'],
  9: ['.###.', '#...#', '#...#', '.####', '....#', '#...#', '.###.'],

  '.': ['.....', '.....', '.....', '.....', '.....', '.##..', '.##..'],
  ',': ['.....', '.....', '.....', '.....', '.##..', '.##..', '.#...'],
  '-': ['.....', '.....', '.....', '#####', '.....', '.....', '.....'],
  '/': ['....#', '....#', '...#.', '..#..', '.#...', '#....', '#....'],
  ':': ['.....', '.##..', '.##..', '.....', '.##..', '.##..', '.....'],
  '(': ['..##.', '.#...', '#....', '#....', '#....', '.#...', '..##.'],
  ')': ['.##..', '...#.', '....#', '....#', '....#', '...#.', '.##..'],
  '%': ['##..#', '##.#.', '..#..', '.#...', '#..##', '.#.##', '.....'],
  ' ': ['.....', '.....', '.....', '.....', '.....', '.....', '.....']
};

const GLYPH_W = 5;
const GLYPH_H = 7;

const crcTable = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

const crc32 = (buf) => {
  let c = -1;
  for (let i = 0; i < buf.length; i += 1) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
};

const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const typeAndData = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeAndData));
  return Buffer.concat([len, typeAndData, crc]);
};

/**
 * Encode an RGB pixel buffer as a PNG.
 * @param {Buffer} rgb  width*height*3 bytes
 */
const encodePng = (rgb, width, height) => {
  // Each scanline is prefixed with a filter byte of 0 (None).
  const raw = Buffer.alloc(height * (1 + width * 3));
  for (let y = 0; y < height; y += 1) {
    raw[y * (1 + width * 3)] = 0;
    rgb.copy(raw, y * (1 + width * 3) + 1, y * width * 3, (y + 1) * width * 3);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: truecolour
  ihdr[10] = 0; // deflate
  ihdr[11] = 0; // adaptive filtering
  ihdr[12] = 0; // no interlace

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
};

/** A solid-colour PNG. Used as a stand-in image for the vision wiring check. */
export const solidImage = (width, height, [r, g, b]) => {
  const rgb = Buffer.alloc(width * height * 3);
  for (let i = 0; i < width * height; i += 1) {
    rgb[i * 3] = r;
    rgb[i * 3 + 1] = g;
    rgb[i * 3 + 2] = b;
  }
  return encodePng(rgb, width, height);
};

/**
 * Render lines of text as black-on-white block letters.
 * Uppercased automatically; unsupported characters become blanks.
 *
 * @param {string[]} lines
 * @param {number} scale  pixels per font pixel — 10 gives ~70px tall glyphs,
 *                        comfortably above Tesseract's accuracy threshold.
 */
export const textImage = (lines, scale = 10) => {
  const upper = lines.map((l) => l.toUpperCase());
  const cols = Math.max(...upper.map((l) => l.length));
  const pad = scale * 2;

  const width = pad * 2 + cols * (GLYPH_W + 1) * scale;
  const height = pad * 2 + upper.length * (GLYPH_H + 2) * scale;

  const rgb = Buffer.alloc(width * height * 3, 0xff); // white ground

  upper.forEach((line, lineIndex) => {
    [...line].forEach((ch, charIndex) => {
      const glyph = FONT[ch];
      if (!glyph) return;
      for (let gy = 0; gy < GLYPH_H; gy += 1) {
        for (let gx = 0; gx < GLYPH_W; gx += 1) {
          if (glyph[gy][gx] !== '#') continue;
          const x0 = pad + charIndex * (GLYPH_W + 1) * scale + gx * scale;
          const y0 = pad + lineIndex * (GLYPH_H + 2) * scale + gy * scale;
          for (let dy = 0; dy < scale; dy += 1) {
            for (let dx = 0; dx < scale; dx += 1) {
              const i = ((y0 + dy) * width + (x0 + dx)) * 3;
              rgb[i] = 0;
              rgb[i + 1] = 0;
              rgb[i + 2] = 0;
            }
          }
        }
      }
    });
  });

  return encodePng(rgb, width, height);
};
