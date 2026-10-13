/**
 * Encodeur de QR code, sans dépendance : texte (UTF-8) vers matrice de modules.
 *
 * Mode octets seulement, niveau de correction L (le code s'affiche sur un écran,
 * il n'est ni froissé ni rayé : des modules plus gros se scannent mieux que des
 * modules plus nombreux). Versions 1 à 40. L'algorithme est celui de la norme
 * ISO/IEC 18004 : remplissage des octets, codes de Reed-Solomon par bloc,
 * entrelacement, motifs de fonction, huit masques et choix du moins pénalisé.
 *
 * Module pur, testé par tests/ux/connexion-qr.test.mjs (décodage de la matrice
 * produite par un lecteur indépendant).
 */

/** Matrice carrée : `true` = module sombre. */
export type QrMatrix = boolean[][];

const MIN_VERSION = 1;
const MAX_VERSION = 40;

// Niveau L. Index 0 inutilisé : les tables sont indexées par la version.
const ECC_CODEWORDS_PER_BLOCK = [
  -1, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30,
];
const NUM_ERROR_CORRECTION_BLOCKS = [
  -1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25,
];

// Mots de format : niveau L (01) + masque, déjà protégés par le code BCH.
const FORMAT_ECC_BITS_L = 1;

/** Texte en octets UTF-8. */
function utf8Bytes(text: string): number[] {
  return Array.from(new TextEncoder().encode(text));
}

/** Nombre de modules de données (hors motifs de fonction) d'une version. */
function numRawDataModules(version: number): number {
  let result = (16 * version + 128) * version + 64;
  if (version >= 2) {
    const numAlign = Math.floor(version / 7) + 2;
    result -= (25 * numAlign - 10) * numAlign - 55;
    if (version >= 7) result -= 36;
  }
  return result;
}

function numDataCodewords(version: number): number {
  return Math.floor(numRawDataModules(version) / 8) - ECC_CODEWORDS_PER_BLOCK[version] * NUM_ERROR_CORRECTION_BLOCKS[version];
}

/** Octets utiles d'une version au niveau L. */
export function byteCapacity(version: number): number {
  const charCountBits = version <= 9 ? 8 : 16;
  const bits = numDataCodewords(version) * 8 - 4 - charCountBits;
  return Math.floor(bits / 8);
}

// ---------------------------------------------------------------------------
// Reed-Solomon sur GF(256), polynôme 0x11D
// ---------------------------------------------------------------------------

function gfMultiply(x: number, y: number): number {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z;
}

function reedSolomonDivisor(degree: number): number[] {
  const result: number[] = new Array(degree).fill(0);
  result[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < result.length; j++) {
      result[j] = gfMultiply(result[j], root);
      if (j + 1 < result.length) result[j] ^= result[j + 1];
    }
    root = gfMultiply(root, 0x02);
  }
  return result;
}

function reedSolomonRemainder(data: readonly number[], divisor: readonly number[]): number[] {
  const result: number[] = divisor.map(() => 0);
  for (const b of data) {
    const factor = b ^ (result.shift() as number);
    result.push(0);
    divisor.forEach((coef, i) => { result[i] ^= gfMultiply(coef, factor); });
  }
  return result;
}

// ---------------------------------------------------------------------------
// Octets de données et de correction
// ---------------------------------------------------------------------------

function pushBits(bits: number[], value: number, length: number): void {
  for (let i = length - 1; i >= 0; i--) bits.push((value >>> i) & 1);
}

function dataCodewords(bytes: readonly number[], version: number): number[] {
  const bits: number[] = [];
  pushBits(bits, 0x4, 4); // mode octets
  pushBits(bits, bytes.length, version <= 9 ? 8 : 16);
  for (const b of bytes) pushBits(bits, b, 8);
  const capacityBits = numDataCodewords(version) * 8;
  pushBits(bits, 0, Math.min(4, capacityBits - bits.length));
  pushBits(bits, 0, (8 - (bits.length % 8)) % 8);
  for (let pad = 0xec; bits.length < capacityBits; pad ^= 0xec ^ 0x11) pushBits(bits, pad, 8);
  const out: number[] = new Array(bits.length / 8).fill(0);
  bits.forEach((bit, i) => { out[i >>> 3] |= bit << (7 - (i & 7)); });
  return out;
}

/** Octets de données entrelacés avec leurs octets de correction, bloc par bloc. */
function interleavedCodewords(data: readonly number[], version: number): number[] {
  const numBlocks = NUM_ERROR_CORRECTION_BLOCKS[version];
  const blockEccLen = ECC_CODEWORDS_PER_BLOCK[version];
  const rawCodewords = Math.floor(numRawDataModules(version) / 8);
  const numShortBlocks = numBlocks - (rawCodewords % numBlocks);
  const shortBlockLen = Math.floor(rawCodewords / numBlocks);
  const blocks: number[][] = [];
  const divisor = reedSolomonDivisor(blockEccLen);
  for (let i = 0, k = 0; i < numBlocks; i++) {
    const dat = data.slice(k, k + shortBlockLen - blockEccLen + (i < numShortBlocks ? 0 : 1));
    k += dat.length;
    const ecc = reedSolomonRemainder(dat, divisor);
    if (i < numShortBlocks) dat.push(0);
    blocks.push(dat.concat(ecc));
  }
  const result: number[] = [];
  for (let i = 0; i < blocks[0].length; i++) {
    blocks.forEach((block, j) => {
      // Les blocs courts ont un octet de moins : la case de remplissage est sautée.
      if (i !== shortBlockLen - blockEccLen || j >= numShortBlocks) result.push(block[i]);
    });
  }
  return result;
}

// ---------------------------------------------------------------------------
// Matrice
// ---------------------------------------------------------------------------

function alignmentPositions(version: number): number[] {
  if (version === 1) return [];
  const numAlign = Math.floor(version / 7) + 2;
  const step = version === 32 ? 26 : Math.ceil((version * 4 + 4) / (numAlign * 2 - 2)) * 2;
  const result = [6];
  for (let pos = version * 4 + 10; result.length < numAlign; pos -= step) result.splice(1, 0, pos);
  return result;
}

class Grid {
  readonly size: number;
  readonly modules: boolean[][];
  readonly isFunction: boolean[][];

  constructor(readonly version: number) {
    this.size = version * 4 + 17;
    this.modules = Array.from({ length: this.size }, () => new Array(this.size).fill(false));
    this.isFunction = Array.from({ length: this.size }, () => new Array(this.size).fill(false));
    this.drawFunctionPatterns();
  }

  private set(x: number, y: number, dark: boolean): void {
    this.modules[y][x] = dark;
    this.isFunction[y][x] = true;
  }

  private drawFunctionPatterns(): void {
    for (let i = 0; i < this.size; i++) {
      this.set(6, i, i % 2 === 0);
      this.set(i, 6, i % 2 === 0);
    }
    this.drawFinder(3, 3);
    this.drawFinder(this.size - 4, 3);
    this.drawFinder(3, this.size - 4);
    const align = alignmentPositions(this.version);
    const last = align.length - 1;
    for (let i = 0; i < align.length; i++) {
      for (let j = 0; j < align.length; j++) {
        if ((i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0)) continue;
        this.drawAlignment(align[i], align[j]);
      }
    }
    this.drawFormat(0);
    this.drawVersion();
  }

  private drawFinder(cx: number, cy: number): void {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const dist = Math.max(Math.abs(dx), Math.abs(dy));
        const x = cx + dx;
        const y = cy + dy;
        if (x >= 0 && x < this.size && y >= 0 && y < this.size) this.set(x, y, dist !== 2 && dist !== 4);
      }
    }
  }

  private drawAlignment(cx: number, cy: number): void {
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) this.set(cx + dx, cy + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    }
  }

  /** Mots de format (niveau L et masque), posés deux fois. */
  drawFormat(mask: number): void {
    const data = (FORMAT_ECC_BITS_L << 3) | mask;
    let rem = data;
    for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    const bits = ((data << 10) | rem) ^ 0x5412;
    const bit = (i: number) => ((bits >>> i) & 1) !== 0;
    for (let i = 0; i <= 5; i++) this.set(8, i, bit(i));
    this.set(8, 7, bit(6));
    this.set(8, 8, bit(7));
    this.set(7, 8, bit(8));
    for (let i = 9; i < 15; i++) this.set(14 - i, 8, bit(i));
    for (let i = 0; i < 8; i++) this.set(this.size - 1 - i, 8, bit(i));
    for (let i = 8; i < 15; i++) this.set(8, this.size - 15 + i, bit(i));
    this.set(8, this.size - 8, true);
  }

  private drawVersion(): void {
    if (this.version < 7) return;
    let rem = this.version;
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
    const bits = (this.version << 12) | rem;
    for (let i = 0; i < 18; i++) {
      const dark = ((bits >>> i) & 1) !== 0;
      const a = this.size - 11 + (i % 3);
      const b = Math.floor(i / 3);
      this.set(a, b, dark);
      this.set(b, a, dark);
    }
  }

  drawCodewords(data: readonly number[]): void {
    let i = 0;
    for (let right = this.size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (let vert = 0; vert < this.size; vert++) {
        for (let j = 0; j < 2; j++) {
          const x = right - j;
          const upward = ((right + 1) & 2) === 0;
          const y = upward ? this.size - 1 - vert : vert;
          if (!this.isFunction[y][x] && i < data.length * 8) {
            this.modules[y][x] = ((data[i >>> 3] >>> (7 - (i & 7))) & 1) !== 0;
            i++;
          }
        }
      }
    }
  }

  applyMask(mask: number): void {
    for (let y = 0; y < this.size; y++) {
      for (let x = 0; x < this.size; x++) {
        let invert: boolean;
        switch (mask) {
          case 0: invert = (x + y) % 2 === 0; break;
          case 1: invert = y % 2 === 0; break;
          case 2: invert = x % 3 === 0; break;
          case 3: invert = (x + y) % 3 === 0; break;
          case 4: invert = (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0; break;
          case 5: invert = ((x * y) % 2) + ((x * y) % 3) === 0; break;
          case 6: invert = (((x * y) % 2) + ((x * y) % 3)) % 2 === 0; break;
          default: invert = (((x + y) % 2) + ((x * y) % 3)) % 2 === 0; break;
        }
        if (!this.isFunction[y][x] && invert) this.modules[y][x] = !this.modules[y][x];
      }
    }
  }

  penalty(): number {
    let result = 0;
    const n = this.size;
    const runPenalty = (line: (i: number) => boolean): number => {
      let score = 0;
      let runColor = false;
      let runLength = 0;
      const history = [0, 0, 0, 0, 0, 0, 0];
      const addHistory = (len: number) => {
        if (history[0] === 0) len += n;
        history.pop();
        history.unshift(len);
      };
      const countPatterns = (): number => {
        const k = history[1];
        const core = k > 0 && history[2] === k && history[3] === k * 3 && history[4] === k && history[5] === k;
        return (core && history[0] >= k * 4 && history[6] >= k ? 1 : 0) + (core && history[6] >= k * 4 && history[0] >= k ? 1 : 0);
      };
      for (let i = 0; i < n; i++) {
        if (line(i) === runColor) {
          runLength++;
          if (runLength === 5) score += 3;
          else if (runLength > 5) score++;
        } else {
          addHistory(runLength);
          if (!runColor) score += countPatterns() * 40;
          runColor = line(i);
          runLength = 1;
        }
      }
      // Fin de ligne : le dernier segment est fermé avec une bordure claire.
      if (runColor) {
        addHistory(runLength);
        runLength = 0;
      }
      runLength += n;
      addHistory(runLength);
      score += countPatterns() * 40;
      return score;
    };
    for (let y = 0; y < n; y++) result += runPenalty((x) => this.modules[y][x]);
    for (let x = 0; x < n; x++) result += runPenalty((y) => this.modules[y][x]);
    for (let y = 0; y < n - 1; y++) {
      for (let x = 0; x < n - 1; x++) {
        const c = this.modules[y][x];
        if (c === this.modules[y][x + 1] && c === this.modules[y + 1][x] && c === this.modules[y + 1][x + 1]) result += 3;
      }
    }
    let dark = 0;
    for (const row of this.modules) for (const m of row) if (m) dark++;
    const total = n * n;
    const k = Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1;
    return result + k * 10;
  }
}

/** Vrai quand le texte tient dans un QR code de niveau L (version 40 au plus). */
export function fitsInQr(text: string): boolean {
  return utf8Bytes(text).length <= byteCapacity(MAX_VERSION);
}

/**
 * Matrice du QR code d'un texte. Lève une erreur si le texte est trop long
 * (plus de 2 953 octets) : l'appelant affiche alors l'erreur de connexion.
 */
export function encodeQr(text: string): QrMatrix {
  const bytes = utf8Bytes(text);
  let version = MIN_VERSION;
  while (version <= MAX_VERSION && bytes.length > byteCapacity(version)) version++;
  if (version > MAX_VERSION) throw new RangeError('qr: texte trop long');

  const codewords = interleavedCodewords(dataCodewords(bytes, version), version);
  let best: Grid | null = null;
  let bestPenalty = Infinity;
  for (let mask = 0; mask < 8; mask++) {
    const grid = new Grid(version);
    grid.drawCodewords(codewords);
    grid.applyMask(mask);
    grid.drawFormat(mask);
    const penalty = grid.penalty();
    if (penalty < bestPenalty) {
      best = grid;
      bestPenalty = penalty;
    }
  }
  return (best as Grid).modules;
}
