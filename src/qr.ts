/**
 * QR code encoder — just enough for the codes Hata shows (a 2FA setup link, later an address for the
 * phone): byte mode, error correction level M, versions 1–10 (up to 213 bytes).
 *
 * Follows ISO/IEC 18004. Returns the matrix; drawing it is the UI's job.
 */

/** Per version at level M: error correction codewords per block, and the data codewords of each block */
const BLOCKS: Record<number, { ec: number; data: number[] }> = {
  1: { ec: 10, data: [16] },
  2: { ec: 16, data: [28] },
  3: { ec: 26, data: [44] },
  4: { ec: 18, data: [32, 32] },
  5: { ec: 24, data: [43, 43] },
  6: { ec: 16, data: [27, 27, 27, 27] },
  7: { ec: 18, data: [31, 31, 31, 31] },
  8: { ec: 22, data: [38, 38, 39, 39] },
  9: { ec: 22, data: [36, 36, 36, 37, 37] },
  10: { ec: 26, data: [43, 43, 43, 43, 44] },
};

/** Centres of the alignment patterns, per version */
const ALIGNMENT: Record<number, number[]> = {
  1: [],
  2: [6, 18],
  3: [6, 22],
  4: [6, 26],
  5: [6, 30],
  6: [6, 34],
  7: [6, 22, 38],
  8: [6, 24, 42],
  9: [6, 26, 46],
  10: [6, 28, 50],
};

// --- Reed–Solomon over GF(256), polynomial x^8 + x^4 + x^3 + x^2 + 1 -------------------------------

const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
for (let i = 0, x = 1; i < 255; i++) {
  EXP[i] = x;
  LOG[x] = i;
  x <<= 1;
  if (x & 0x100) x ^= 0x11d;
}
for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255]!;

const mul = (a: number, b: number): number => (a === 0 || b === 0 ? 0 : EXP[LOG[a]! + LOG[b]!]!);

/** The error correction codewords of one block */
function errorCorrection(data: number[], count: number): number[] {
  // generator polynomial (x - 2^0)(x - 2^1)…(x - 2^(count-1)), highest power first
  let generator = [1];
  for (let i = 0; i < count; i++) {
    const next = new Array<number>(generator.length + 1).fill(0);
    for (let j = 0; j < generator.length; j++) {
      next[j] = next[j]! ^ generator[j]!;
      next[j + 1] = next[j + 1]! ^ mul(generator[j]!, EXP[i]!);
    }
    generator = next;
  }
  const remainder = new Array<number>(count).fill(0);
  for (const byte of data) {
    const factor = byte ^ remainder.shift()!;
    remainder.push(0);
    for (let i = 0; i < count; i++) remainder[i] = remainder[i]! ^ mul(generator[i + 1]!, factor);
  }
  return remainder;
}

// --- Data ------------------------------------------------------------------------------------------

/** The smallest version whose data fits, or null */
export function versionFor(bytes: number): number | null {
  for (let version = 1; version <= 10; version++) {
    const capacity = BLOCKS[version]!.data.reduce((a, b) => a + b, 0);
    // 4 bits of mode + the length field (8 bits up to version 9, 16 from 10)
    const header = version <= 9 ? 12 : 20;
    if (bytes * 8 + header <= capacity * 8) return version;
  }
  return null;
}

/** All codewords of the symbol, data and error correction interleaved as they are placed */
function codewords(bytes: Uint8Array, version: number): number[] {
  const { ec, data: sizes } = BLOCKS[version]!;
  const capacity = sizes.reduce((a, b) => a + b, 0);
  const bits: number[] = [];
  const put = (value: number, length: number) => {
    for (let i = length - 1; i >= 0; i--) bits.push((value >> i) & 1);
  };
  put(0b0100, 4);
  put(bytes.length, version <= 9 ? 8 : 16);
  for (const byte of bytes) put(byte, 8);
  put(0, Math.min(4, capacity * 8 - bits.length));
  while (bits.length % 8) bits.push(0);
  const data: number[] = [];
  for (let i = 0; i < bits.length; i += 8) data.push(Number.parseInt(bits.slice(i, i + 8).join(""), 2));
  for (let pad = 0xec; data.length < capacity; pad ^= 0xec ^ 0x11) data.push(pad);

  const blocks: number[][] = [];
  let offset = 0;
  for (const size of sizes) {
    blocks.push(data.slice(offset, offset + size));
    offset += size;
  }
  const corrections = blocks.map((block) => errorCorrection(block, ec));
  const out: number[] = [];
  const longest = Math.max(...sizes);
  for (let i = 0; i < longest; i++) for (const block of blocks) if (i < block.length) out.push(block[i]!);
  for (let i = 0; i < ec; i++) for (const block of corrections) out.push(block[i]!);
  return out;
}

// --- Matrix ----------------------------------------------------------------------------------------

/** BCH remainder: `value` shifted left by the degree of `poly`, divided by `poly` */
function bch(value: number, poly: number): number {
  const degree = 31 - Math.clz32(poly);
  let rest = value << degree;
  for (let bit = 31 - Math.clz32(rest); bit >= degree; bit = 31 - Math.clz32(rest)) rest ^= poly << (bit - degree);
  return rest;
}

const MASKS: ((row: number, col: number) => boolean)[] = [
  (r, c) => (r + c) % 2 === 0,
  (r) => r % 2 === 0,
  (_, c) => c % 3 === 0,
  (r, c) => (r + c) % 3 === 0,
  (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
  (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
  (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0,
  (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0,
];

/** How bad a matrix is for a scanner, by the standard's four rules — the mask with the least wins */
function penalty(m: boolean[][]): number {
  const size = m.length;
  let score = 0;
  const line = (get: (i: number) => boolean) => {
    let run = 1;
    for (let i = 1; i <= size; i++) {
      if (i < size && get(i) === get(i - 1)) run++;
      else {
        if (run >= 5) score += run - 2;
        run = 1;
      }
    }
    // finder-like 1:1:3:1:1 with four light modules on either side
    for (let i = 0; i + 10 < size; i++) {
      const p = (k: number) => get(i + k);
      const dark = (a: number, b: number, c: number, d: number, e: number) => p(a) && p(b) && p(c) && p(d) && p(e);
      if (!p(0) && !p(1) && !p(2) && !p(3) && dark(4, 6, 7, 8, 10) && !p(5) && !p(9)) score += 40;
      if (dark(0, 2, 3, 4, 6) && !p(1) && !p(5) && !p(7) && !p(8) && !p(9) && !p(10)) score += 40;
    }
  };
  for (let i = 0; i < size; i++) {
    line((k) => m[i]![k]!);
    line((k) => m[k]![i]!);
  }
  let dark = 0;
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (m[r]![c]) dark++;
      if (r + 1 < size && c + 1 < size && m[r]![c] === m[r]![c + 1] && m[r]![c] === m[r + 1]![c] && m[r]![c] === m[r + 1]![c + 1]) score += 3;
    }
  }
  return score + Math.floor(Math.abs((dark * 100) / (size * size) - 50) / 5) * 10;
}

/** The QR code of `text`: rows of modules, true — dark. Throws if the text is too long. */
export function qrMatrix(text: string): boolean[][] {
  const bytes = new TextEncoder().encode(text);
  const version = versionFor(bytes.length);
  if (version === null) throw new Error("Too long for a QR code");
  const size = 17 + 4 * version;
  const modules: boolean[][] = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
  // function patterns: finders, timing, alignment, format and version areas — never masked, never data
  const reserved: boolean[][] = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
  const set = (row: number, col: number, dark: boolean) => {
    if (row < 0 || col < 0 || row >= size || col >= size) return;
    modules[row]![col] = dark;
    reserved[row]![col] = true;
  };

  for (const [top, left] of [[0, 0], [0, size - 7], [size - 7, 0]] as const) {
    for (let r = -1; r <= 7; r++) {
      for (let c = -1; c <= 7; c++) {
        const ring = Math.max(Math.abs(r - 3), Math.abs(c - 3));
        set(top + r, left + c, ring <= 1 || ring === 3);
      }
    }
  }
  for (let i = 8; i < size - 8; i++) {
    set(6, i, i % 2 === 0);
    set(i, 6, i % 2 === 0);
  }
  const centres = ALIGNMENT[version]!;
  for (const row of centres) {
    for (const col of centres) {
      // the three corners that hold finder patterns have no alignment pattern
      if ((row === 6 && col === 6) || (row === 6 && col === size - 7) || (row === size - 7 && col === 6)) continue;
      for (let r = -2; r <= 2; r++) for (let c = -2; c <= 2; c++) set(row + r, col + c, Math.max(Math.abs(r), Math.abs(c)) !== 1);
    }
  }
  set(size - 8, 8, true);
  // format information: filled in per mask below, reserved now
  for (let i = 0; i < 9; i++) {
    if (!reserved[8]![i]) set(8, i, false);
    if (!reserved[i]![8]) set(i, 8, false);
  }
  for (let i = 0; i < 8; i++) {
    set(8, size - 1 - i, false);
    if (i < 7) set(size - 1 - i, 8, modules[size - 1 - i]![8]!);
  }
  if (version >= 7) {
    const info = (version << 12) | bch(version, 0x1f25);
    for (let i = 0; i < 18; i++) {
      const dark = ((info >> i) & 1) === 1;
      set(Math.floor(i / 3), size - 11 + (i % 3), dark);
      set(size - 11 + (i % 3), Math.floor(i / 3), dark);
    }
  }

  // data: two-module columns from the right edge, going up and down in turns, skipping the timing column
  const stream = codewords(bytes, version);
  let bit = 0;
  let upward = true;
  for (let right = size - 1; right > 0; right -= 2) {
    if (right === 6) right--;
    for (let step = 0; step < size; step++) {
      const row = upward ? size - 1 - step : step;
      for (const col of [right, right - 1]) {
        if (reserved[row]![col]) continue;
        modules[row]![col] = bit < stream.length * 8 && ((stream[bit >> 3]! >> (7 - (bit & 7))) & 1) === 1;
        bit++;
      }
    }
    upward = !upward;
  }

  let best: boolean[][] | null = null;
  let bestScore = Infinity;
  for (let mask = 0; mask < 8; mask++) {
    const candidate = modules.map((row, r) => row.map((dark, c) => (reserved[r]![c] ? dark : dark !== MASKS[mask]!(r, c))));
    // level M is 00; the 15 bits go around the top-left finder and, split, beside the other two
    const format = (((0b00 << 3) | mask) << 10 | bch((0b00 << 3) | mask, 0x537)) ^ 0x5412;
    for (let i = 0; i < 15; i++) {
      const dark = ((format >> i) & 1) === 1;
      // first copy: bits 0–7 down the column next to the top-left finder, 8–14 along its row
      if (i < 6) candidate[i]![8] = dark;
      else if (i < 8) candidate[i + 1]![8] = dark;
      else if (i === 8) candidate[8]![7] = dark;
      else candidate[8]![14 - i] = dark;
      // second copy: bits 0–7 along the row under the top-right finder, 8–14 up the bottom-left column
      if (i < 8) candidate[8]![size - 1 - i] = dark;
      else candidate[size - 15 + i]![8] = dark;
    }
    const score = penalty(candidate);
    if (score < bestScore) {
      bestScore = score;
      best = candidate;
    }
  }
  return best!;
}
