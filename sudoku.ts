#!/usr/bin/env -S node -r source-map-support/register

import * as url from 'node:url';
import * as lz from 'lz-string';

// Tools for setting and solving sudokus

const ANTI_KNIGHT = true;

// Set of bits from 0..80
export type Shading = bigint & {__shading__: never};

// bits 0..728 - each 81-bit chunk is a different digit 1..9
export type Grid = bigint & {__grid__: never};

// bits 0..8 indicating possibility of each number 1..9
export type Mask = number & {__mask__: never};

// cell address 0..80
export type CellAddr = number;

type Bitmap = bigint;
export namespace Bitmap {
  export function and<T extends Bitmap>(a: T, b: T): T {
    return (a & b) as unknown as T;
  }
  export function or<T extends Bitmap>(a: T, b: T): T {
    return (a | b) as unknown as T;
  }
  export function xor<T extends Bitmap>(a: T, b: T): T {
    return (a ^ b) as unknown as T;
  }

  export function bit<T extends Bitmap>(n: number): T {
    return (1n << BigInt(n)) as unknown as T;
  }
  export function has(s: Bitmap, b: number): boolean {
    return Boolean(s & (1n << BigInt(b)));
  }
  export function bits(s: Bitmap): number[] {
    const out = [];
    let offset = 0;
    while (s) {
      let x = Number(s & 0xffffffffn);
      let y = offset;
      while (x) {
        const z = 32 - Math.clz32(x ^ (x - 1));
        out.push((y += z) - 1);
        if (z === 32) break;
        x >>>= z;
      }
      s = (s >> 32n) as Shading;
      offset += 32;
    }
    return out;
  }
}

export namespace Shading {
  export const {and, or, xor, bit, has, bits} = Bitmap;
  export const ALL = ((1n << 81n) - 1n) as Shading;
  export const EMPTY = 0n as Shading;

  export function cpl(s: Shading): Shading {
    return xor(ALL, s);
  }

  export function count(s: Shading): number {
    let i: bigint = s;
    i -= (i >> 1n) & 0x155555555555555555555n
    i = (i & 0x133333333333333333333n) + ((i >> 2n) & 0x133333333333333333333n);
    i = (i + (i >> 4n)) & 0x10f0f0f0f0f0f0f0f0f0fn;
    return Number(((i * 0x101010101010101010101n) >> 80n) & 0xffn);
  }

  export function show(s: Shading, {lines = true} = {}): string {
    let out = '';
    let bits: bigint = s;
    for (let i = 0; i < 81; i++) {
      out += (bits & 1n) ? 'x' : '.';
      if (i % 3 === 2) {
        if (i % 9 === 8) {
          if (i % 27 === 26) {
            if (i < 80) out += lines ? '\n---+---+---\n' : '\n';
          } else {
            out += '\n';
          }
        } else {
          out += lines ? '|' : '';
        }
      }
      bits >>= 1n;
    }
    return out;
  }

  // set of 9 shadings, each representing a single fully-shaded box.
  export const BOXES: readonly Shading[] = (() => {
    const out: bigint[] = [];
    for (let i = 0n; i < 81n; i += 27n) {
      for (let j = 0n; j < 9n; j += 3n) {
        out.push(0b111_000_000_111_000_000_111n << (i + j));
      }
    }
    return out as Shading[];
  })();

  // set of 9 shadings, each representing a single fully-shaded row.
  export const ROWS: readonly Shading[] = (() => {
    const out: bigint[] = [];
    for (let i = 0n; i < 81n; i += 9n) {
      out.push(0b111_111_111n << i);
    }
    return out as Shading[];
  })();

  // set of 9 shadings, each representing a single fully-shaded column.
  export const COLS: readonly Shading[] = (() => {
    const out: bigint[] = [];
    let mask = 0n;
    for (let j = 0; j < 9; j++) {
      mask = (mask << 9n) | 1n;
    }
    for (let i = 0n; i < 9n; i++) {
      out.push(mask << i);
    }
    return out as Shading[];
  })();

  export const ANTI_KNIGHT_PATTERN: readonly Shading[] = (() => {
    const out: bigint[] = [];
    function add(x: bigint, r: number, c: number): bigint {
      if (r < 0 || r >= 9 || c < 0 || c >= 9) return x;
      return x | (1n << BigInt(9 * r + c));
    }
    for (let r = 0; r < 9; r++) {
      for (let c = 0; c < 9; c++) {
        let x = 0n;
        x = add(x, r - 2, c - 1);
        x = add(x, r - 2, c + 1);
        x = add(x, r - 1, c - 2);
        x = add(x, r - 1, c + 2);
        x = add(x, r + 1, c - 2);
        x = add(x, r + 1, c + 2);
        x = add(x, r + 2, c - 1);
        x = add(x, r + 2, c + 1);
        out.push(x);
      }
    }
    return out as Shading[];
  })();

  export const EXCLUSIONS: readonly Shading[] = (() => {
    const out = Array.from({length: 81}, () => 0n);
    for (const s of [...Shading.ROWS, ...Shading.COLS, ...Shading.BOXES]) {
      for (const b of bits(s)) {
        // out[b] = or(out[b], s);
        out[b] |= s;
      }
    }
    if (ANTI_KNIGHT) {
      for (let b = 0; b < 81; b++) {
        out[b] |= ANTI_KNIGHT_PATTERN[b];
      }
    }
    for (let b = 0; b < 81; b++) {
      out[b] &= ~bit(b);
    }
    return out as Shading[];
  })();

  // All the possible 9-bit patterns that only touch one cell per row/col/box.
  // With normal sudoku rules, this is 46656 patterns; with anti-knight, it's 3176.
  export const SUDOKU_PATTERNS: readonly Shading[] = (() => {
    const out: Shading[] = [];
    function add(pattern: Shading, box: number) {
      if (box === 9) {
        out.push(pattern);
        return;
      }
      // console.log(`  box ${box} ${BOXES[box]} ${available}`);
      for (const c of bits(and(BOXES[box], pattern))) {
        add(and(pattern, cpl(EXCLUSIONS[c])), box + 1);
      }
    }
    add(ALL, 0);
    return out;
  })();

  export const SUDOKU_PATTERN_EXCLUSIONS: readonly bigint[] = (() => {
    const n = SUDOKU_PATTERNS.length;
    if (SUDOKU_PATTERNS.length > 4000) return [];
    // if there's few enough patterns, map each pair that intersect
    // we find that about 58%±1.5% of patterns are excluded.
    const out = Array.from(SUDOKU_PATTERNS, () => 0n);
    for (let i = 0; i < n; i++) {
      let cnt = 0;
      for (let j = i + 1; j < n; j++) {
        if (SUDOKU_PATTERNS[i] & SUDOKU_PATTERNS[j]) {
          cnt++;
          out[i] |= (1n << BigInt(j));
          out[j] |= (1n << BigInt(i));
        }
      }
    }
    return out;
  })();
}

export namespace Mask {
  export function isSingular(b: Mask): number|undefined {
    const z = 31 - Math.clz32(b);
    return b === 1 << z ? z + 1 : undefined;
  }
}

export namespace Grid {
  export const {and, or, xor, bit, has, bits} = Bitmap;
  export const ALL_ONES: Grid = (() => {
    let out = 0n;
    for (let i = 0; i < 81; i++) {
      out = (out << 9n) | 1n
    }
    return out as Grid;
  })();
  export const EMPTY: Grid = (ALL_ONES * 0b111_111_111n) as Grid;

  export const count = (() => {
    let a = 0x55555555n;
    let b = 0x33333333n;
    let c = 0x0f0f0f0fn;
    let d = 0x001f001fn;
    let e = 0x00010001n;
    for (let i = 32n; i < 1024n; i <<= 1n) {
      a |= a << i;
      b |= b << i;
      c |= c << i;
      d |= d << i;
      if (i < 128) e |= e << i;
    }
    const f384 = (1n << 384n) - 1n;
    const f128 = (1n << 128n) - 1n;

    return function count(g: Grid): number {
      let i: bigint = g;
      i -= (i >> 1n) & a;
      i = (i & b) + ((i >> 2n) & b);
      i = (i + (i >> 4n)) & c;
      i = (i + (i >> 8n)) & d; // 0..16 every 16 bits, 
      i = (i + (i >> 384n)) & f384;
      i = (i + (i >> 128n) + (i >> 256n)) & f128;
      return Number(((i * e) >> 112n) & 0xffffn);
    };
  })();

  // return sa 1-grid from the shading
  export function fromShading(s: Shading): Grid {
    let mask = 1n << 80n;
    let out = 0n;
    while (mask) {
      out <<= 9n;
      if (s & mask) out |= 1n;
      mask >>= 1n;
    }
    return out as Grid;
  }

  export function lookup(g: Grid, c: CellAddr): Mask {
    return Number((g >> BigInt(c * 9)) & 0x1ffn) as Mask;
  }

  // given a bit mask, returns a two-character string, either blank, or else a
  // dot pattern, or a digit.
  function showNum(b?: Mask): string {
    if (!b || b === 0b111_111_111) return '  ';
    const z = Mask.isSingular(b);
    if (z != null) return String.fromCharCode(0x30 + z) + ' ';
    // we have _some_ information, but not all.
    let left = 0x2800;
    let right = 0x2800;
    if (b & 1) left |= 1;
    if (b & 2) left |= 8;
    if (b & 4) right |= 1;
    if (b & 8) left |= 2;
    if (b & 16) left |= 16;
    if (b & 32) right |= 2;
    if (b & 64) left |= 4;
    if (b & 128) left |= 32;
    if (b & 256) right |= 4;
    return String.fromCharCode(left) + String.fromCharCode(right);
  }

  export function* cells(g: Grid): IterableIterator<[CellAddr, Mask]> {
    let bits: bigint = g;
    for (let i = 0; i < 81; i++) {
      yield [i, Number(bits & 0x1ffn) as Mask];
      bits >>= 9n;
    }
  }

  export function* visible(c: CellAddr): IterableIterator<CellAddr> {
    // 20 of the 80 other cells are visible
    const col = c % 9;
    const row = c - col;
    const band = 27 * Math.floor(c / 27);
    const stack = 3 * Math.floor(c % 9 / 3);
    const box = band + stack;
    for (let i = 0; i < 9; i++) {
      if (i !== col) yield row + i;
    }
    for (let i = 0; i < 81; i += 9) {
      if (i !== row) yield i + col;
    }
    for (let i = band; i < band + 27; i += 9) {
      if (i === row) continue;
      for (let j = stack; j < stack + 3; j++) {
        if (j === col) continue;
        yield i + j;
      }
    }
  }

  export function from(s: string): Grid {
    let i = 0n;
    let out = 0n;
    for (const c of s) {
      let next: number|undefined = undefined;
      if (c > '0' && c <= '9') {
        next = 1 << (c.charCodeAt(0) - 0x31);
      } else if (c === '.') {
        next = 0x1ff;
      } else if (c === 'e') {
        next = 0xaa;
      } else if (c === 'o') {
        next = 0x155;
      }
      // see if we found something
      if (next != null) {
        out |= BigInt(next) << i;
        i += 9n;
      }
    }
    if (i !== 729n) throw new Error(`bad parse: ${i} !== 729`);
    return out as Grid;
  }

  // Attempts to solve the grid, should be called after normalize...?
  export function solve(g: Grid, limit = 2): Grid[] {
    // Look for patterns that can fit, recurse/backtrack
    console.log(`solve:\n${show(g)}`);

    // Filter the set of patterns by digit
    const patsByDigit: Grid[][] = Array.from({length: 9}, (_, d) =>
      SUDOKU_PATTERNS.flatMap(p => {
        const p1 = p << BigInt(d);
        return (g & p1) === p1 ? [p1 as Grid] : [];
      }));

    const solutions = new Set<Grid>();
    solve(g);
    return [...solutions];

    function solve(g: Grid) {

      // PROBLEM - why can't we solve anti-knight?
      //   - most constrained digit doesn't seem to be the patterns we're getting??

      if (solutions.size >= limit) return;
      const n = normalize(g);
      if (!n) { console.log(`failed normalize`); return; }
      g = n;
      const sizes = Array.from({length: 9}, (_, i) => count((g & (ALL_ONES << BigInt(i))) as Grid));
      // check if we're solved and/or impossible
      if (sizes.every(s => s <= 9)) {
        console.log(`at most 9 of each digit: ${sizes.join(',')}`);
        if (sizes.every(s => s === 9)) solutions.add(g);
        return;
      }
      // find the most-constrained number
      let d = -1;
      for (let i = 0; i < 9; i++) {
        if (sizes[i] >= sizes[d] || sizes[i] <= 9) continue;
        d = i;
      }
      console.log(`most constrained: ${d}: ${sizes[d]} - ${patsByDigit[d].length} patterns\n${show(g)}`);

      // look for patterns that constrain it further
      //  - TODO - this is slow, can we make a trie of the patterns?
      //         - find the most constrained _cell_ and look it up in trie?
      //         - guarantee we only look at the 1/9 or 1/81 that actually matter?
      for (const p of patsByDigit[d]) {
        if ((g & p) === p) {
          console.log(`found allowable pattern:\n${show(p)}`);
          const e = exclusion(p as Grid);
          solve((g & ~e) as Grid);
        }
      }
    }
  }

  // Apply exclusions for all fixed numbers.  Iterates to a fixed point.
  export function normalize(g: Grid): Grid|undefined {
    console.log(`normalize`);
    let out = g;
    for (let i = 0; i < 81; i++) {
      const m = lookup(out, i);
      if (m === 0) return undefined;
      const v = Mask.isSingular(m);
      if (v == null) continue;
      const e = EXCLUSIONS[9 * i + v - 1];
      out = (out & ~e) as Grid;
    }
    console.log(`${Grid.show(g)}\nto\n${Grid.show(out)}`);
    return out === g ? out : normalize(out);
  }

  export function show(g: Grid, {lines = true, showNum: showNumFn = showNum} = {}): string {
    let out = '';
    let bits: bigint = g;
    const dashes = '---'.repeat(showNumFn().length);
    for (const [i, mask] of cells(g)) {
      out += showNumFn(mask);
      if (i % 3 === 2) {
        if (i % 9 === 8) {
          if (i % 27 === 26) {
            if (i < 80) out += lines ? `\n${dashes}+${dashes}+${dashes}\n` : '\n';
          } else {
            out += '\n';
          }
        } else {
          out += lines ? '|' : '';
        }
      }
      bits >>= 9n;
    }
    return out;
  }

  // map from the 729 info cells to a full exclusion mask
  export const EXCLUSIONS: readonly Grid[] = (() => {
    const out: Grid[] = [];
    for (let i = 0; i < 81; i++) {
      // need to blow up the shading into a 1-grid...?
      const e = fromShading(Shading.EXCLUSIONS[i]);
      for (let d = 0; d < 9; d++) {
        // for each digit, shift the pattern and exclude all other digits
        // from the main cell
        const g = e << BigInt(d) | (0x1ffn & ~BigInt(1 << d)) << BigInt(9 * i);
        out.push(g as Grid);
      }
    }
    return out;
  })();

  export function exclusion(g: Grid): Grid {
    let e = 0n;
    for (const b of bits(g)) {
      e |= EXCLUSIONS[b];
    }
    return e as Grid;
  }

  // non-shifted, just expanded from shading
  //  - still need to shift by 0..8 to actually use it
  export const SUDOKU_PATTERNS: readonly Grid[] = Shading.SUDOKU_PATTERNS.map(fromShading);

  // // TODO - make this lazy, since it's relatively expensive to compute?
  // export const SUDOKU_PATTERNS: ReadonlyArray<readonly [Grid, Grid]> = (() => {
  //   const out = []
  //   for (const p of Shading.SUDOKU_PATTERNS) {
  //     // need to blow up the shading into a 1-grid...?
  //     const s = fromShading(p);
  //     for (let d = 0; d < 9; d++) {
  //       const g = s << BigInt(d)
  //       let e = 0n;
  //       for (const b of bits(g)) {
  //         e |= EXCLUSIONS[b];
  //       }
  //       out.push([g as Grid, e as Grid]);
  //     }
  //   }
  //   return out;
  // })();
}



// How many shadings are there (independent of cave constraint)?
function fill(size: number): Shading {
  if (size > 8) throw new Error(`bad size: ${size}`);
  const pats = Shading.SUDOKU_PATTERNS;
  let cur = Shading.EMPTY;
  for (let i = 0; i < size; i++) {
    while (true) {
      const p = pats[Math.floor(Math.random() * pats.length)];
      if (Shading.and(cur, p)) continue;
      cur = Shading.or(cur, p);
      break;
    }
  }
  return cur;
}

function mutate(s: Shading): Shading {
  const pats = Shading.SUDOKU_PATTERNS;
  let must = 0;
  while (true) {
    const p = pats[Math.floor(Math.random() * pats.length)];
    const intersect = Shading.and(s, p);
    if (!intersect && must >= 0) {
      s = Shading.or(s, p);
      if (must) return s;
      must = -1;
    } else if (intersect === p && must <= 0) {
      s = Shading.and(s, Shading.cpl(p));
      if (must) return s;
      must = 1;
    }
  }
}

const CONNECTED: readonly (readonly number[])[] = (() => {
  const out: number[][] = [];
  for (let i = 0; i < 81; i += 9) {
    for (let j = 0; j < 9; j++) {
      const c: number[] = [];
      const n = i + j;
      if (i > 0) c.push(n - 9);
      if (i < 72) c.push(n + 9);
      if (j > 0) c.push(n - 1);
      if (j < 8) c.push(n + 1);
      out.push(c);
    }
  }
  return out;
})();

// Separates out orthogonally-connected components
function connectedComponents(s: Shading): Shading[] {
  //const out = [];
  const parent: number[] = [];
  function find(i: number): number|undefined {
    const p = parent[i];
    if (p == null) return undefined;
    if (p === i) return p;
    return parent[i] = find(p);
  }
  for (const b of Shading.bits(s)) {
    const left = b % 9 ? find(b - 1) : undefined;
    const up = find(b - 9);
    if (left != null && up != null) {
      // union
      parent[left] = up;
    }
    parent[b] = up ?? left ?? b;
  }
  // now find all components
  const out: Shading[] = [];
  const map: number[] = [];
  for (const b of Shading.bits(s)) {
    const p = find(b);
    let m = map[p];
    if (m == null) {
      m = map[p] = out.length;
      out.push(Shading.EMPTY);
    }
    out[m] = Shading.or(out[m], Shading.bit(b));
  }
  return out;
}

const BORDER = (() => {
  let s = 0n;
  for (let i = 0; i < 9; i++) {
    for (const b of [i, 72 + i, 9 * i, 9 * i + 8]) {
      s |= (1n << BigInt(b));
    }
  }
  return s as Shading;
})();

function score(s: Shading): number {
  const inside = connectedComponents(s);
  const outside = connectedComponents(Shading.cpl(s));
  return outside.filter(s => !Shading.and(BORDER, s)).length + inside.length - 1;
}

function toGrid(s: Shading): Grid {
  function countVisibility(i: number): number {
    const want = Shading.has(s, i);
    let count = 1;
    let j = i;
    while (++j % 9 !== 0 && Shading.has(s, j) === want) count++;
    j = i;
    while ((j--) % 9 !== 0 && Shading.has(s, j) === want) count++;
    j = i;
    while ((j += 9) < 81 && Shading.has(s, j) === want) count++;
    j = i;
    while ((j -= 9) >= 0 && Shading.has(s, j) === want) count++;
    return count;
  }
  // count orthogonal neighbors
  let grid = 0n;
  for (let i = 80; i >= 0; i--) {
    const odd = Shading.has(s, i);
    let options = Shading.has(s, i) ? 0b101010101n : 0b10101010n;
    const vis = BigInt(1 << (countVisibility(i) - 1));
    grid = grid << 9n | ((vis & options) || options);
  }
  return grid as Grid;

  // const inside = connectedComponents(s);
  // const outside = connectedComponents(Shading.cpl(s));
  // for (const component of 
}

function color(fg?: number, bg?: number): string {
  const terms: number[] = [];
  if (fg != null) terms.push(30 + fg);
  if (bg != null) terms.push(40 + bg);
  return `\x1b[${terms.join(';')}m`;
}
function showParity(b?: Mask): string {
  if (!b) return ' ';
  const z = Mask.isSingular(b);
  if (z != null) {
    const esc = z & 1 ? color(0, 2) : color(undefined, 1);
    return esc + String.fromCharCode(0x30 + z) + color();
  }
  return (b & 1 ? color(2, 2) + 'o' : color(1, 1) + 'e') + color();
}

class Constraint {
  digitMask: bigint;
  parityMask: bigint;
  allMask: bigint;
  constructor(readonly cell: CellAddr, readonly digit: number) {
    this.digitMask = 1n << BigInt(9 * cell + digit - 1);
    const parity = digit % 2 ? 0x155n : 0xaan;
    this.parityMask = parity << BigInt(9 * cell);
    this.allMask = ~(0x1ffn << BigInt(9 * cell));
  }
  toDigit(g: Grid): Grid {
    return ((g & this.allMask) | this.digitMask) as Grid;
  }
  toParity(g: Grid): Grid {
    return ((g & this.allMask) | this.parityMask) as Grid;
  }
  canFit(g: Grid): boolean {
    // NOTE: g should be normalized!
    return Boolean(g & this.digitMask);
  }
}

function explore(s: Shading) {
  let g = toGrid(s);
  let n = g;
  console.log(`${Grid.show(g, {lines: true, showNum: showParity})}\n`);

  const digit: Constraint[] = [];
  const parity: Constraint[] = [];

  const seenDigits = new Set<number>();

  for (let i = 0; i < 80; i++) {
    const d = Grid.lookup(g, i);
    const z = Mask.isSingular(d);
    if (z != null) {
      const c = new Constraint(i, z);
      parity.push(c);
      g = c.toParity(g);
      seenDigits.add(z);
    }
  }
  if (seenDigits.size < 7) return;

  // now we just have parity constraints: add digits back until we overconstrain
  // but we careful not to add one that's obviously broken...

  const limit = 100;
  for (let iter = 0; iter < 100; iter++) {
    const solutions = Grid.solve(g, limit);
    if (solutions.length === 0) {
      // overconstrained
      console.log(`overconstrained with ${digit.length} digits`);
      console.log(Grid.show(g)); //, {showNum: showParity}));
      const i = Math.floor(Math.random() * digit.length);
      const [c] = digit.splice(i, 1);
      parity.push(c);
      g = c.toParity(g);
      n = Grid.normalize(g) ?? g;
    } else if (solutions.length > 1) {
      // underconstrained
      const count = solutions.length >= limit ? `${limit}+` : solutions.length;
      console.log(`underconstrained with ${digit.length} digits: ${
                   count} solutions`);
      if (solutions.length < 20) console.log(Grid.show(g, {showNum: showParity}));
      for (let att = 0; att < 50; att++) {
        const i = Math.floor(Math.random() * parity.length);
        if (!parity[i].canFit(n)) continue;
        const [c] = parity.splice(i, 1);
        const g1 = c.toDigit(g);
        const n1 = Grid.normalize(g1);
        if (att < 49 && (!n1 || i)) {
          parity.push(c);
          continue;
        }
        digit.push(c);
        g = g1;
        if (n1) n = n1;
        break;
      }
    } else {
      console.log(`\x1b[1;33mFOUND UNIQUE SOLUTION!\x1b[m`);
      console.log(Grid.show(g));
      console.log(Grid.show(solutions[0], {showNum: showParity}));
      // TODO - write to a file instead of throwing, and just keep going...?
      //      - maybe construct the f-puzzles/sudokupad URL from json?
      //      - add exhaustive clues?
      //      - add solution to a set and keep going (but don't report it again)?
      throw '';
    }
  }
}

function main() {
  let s = fill(5);
  let e = score(s);
  for (let i = 1; i <= 1000000; i++) {
    const n = mutate(s);
    const ns = score(n);
    if (ns <= e) {
      s = n;
      e = ns;
      if (!e) {
        explore(s);
        console.log('======================');
        for (let j = 0; j < i; j += 10000) s = mutate(s);
        e = score(s);

        // TODO - add digits until overconstrained, remove digits until under...

      }
    }
  }
}

function exportUrl(g: Grid): string {
  // make json
  const json = JSON.stringify({
    size: 9,
    title: 'Parity Cave',
    author: 'steve_hacks',
    ruleset: `Normal sudoku rules apply. Digits in grey squares are even. ${''
             }Digits in grey circles are odd.${'\n\n'

             }The cells with odd digits form a "cave" - a single orthogonally-${''
             }connected region. Cells with even digits form orthogonally-${''
             }connected regions that must extend to the edge of the puzzle (they ${''
             }cannot be fully enclosed within the cave). Grey-shaded cells ${''
             }indicate the number of same-parity cells (including itself) ${''
             }immediately visible in the four orthogonal directions (opposite-${''
             }parity cells cannot be seen through).`,
    // TODO - is the "candidates" line needed at all?  can we just drop "grid"?
    grid: [
      [{}, {candidates: [2, 4, 6, 8]}, {}, {}, {}, {}, {}, {}, {}],
      // ...
    ],
    odd: [
      {cell: 'R2C2'}, // ...
    ],
    even: [
      {cell: 'R1C2'}, // ...
    ],
    solution: [
      // 81 elements...
    ],
    text: [
      // rook symbol in cell
      {cells: ["R1C1"], fontC: "#aaa", size: 1.25, value: "♜"},
    ],
  });
  // return `https://f-puzzles.com/?load=${lz.compressToBase64(json)}`;
  return `https://sudokupad.add/fpuz${lz.compressToBase64(json)}`;
}


function main3() {
  const pats = Shading.SUDOKU_PATTERNS;
  const excl = Shading.SUDOKU_PATTERN_EXCLUSIONS;
  // exhaustively enumerate all patterns
  //  - there's a lot.
  // what we need to do next is generate number-agnostic patterns and then
  // fill numbers in to ensure certain given cells work, and then see what
  // other cells can also be circled?
  //  - is it solvable????
  let count = 0;
  function search(i: number, filled: number, excluded: bigint, used: bigint) {
    if (filled === 9) {
      console.log(`found: ${[...Bitmap.bits(used)].join(',')}`);
      count++;
      return;
    }
    for (; i < pats.length; i++) {
      const mask = (1n << BigInt(i));
      if (excluded & mask) continue;
      search(i + 1, filled + 1, excluded | excl[i], used | mask);
    }
  }
  search(0, 0, 0n, 0n);
  console.log(`found ${count} anti-knight fillings`);

  // let cur = Shading.EMPTY;
  // for (let i = 0; i < size; i++) {
  //   while (true) {
  //     const p = pats[Math.floor(Math.random() * pats.length)];
  //     if (Shading.and(cur, p)) continue;
  //     cur = Shading.or(cur, p);
  //     break;
  //   }
  // }
  // return cur;
  // let s = fill(5);
  // let e = score(s);
  // for (let i = 1; i <= 1000000; i++) {
  //   const n = mutate(s);
  //   const ns = score(n);
  //   if (ns <= e) {
  //     s = n;
  //     e = ns;
  //     if (!e) {
  //       explore(s);
  //       console.log('======================');
  //       for (let j = 0; j < i; j += 10000) s = mutate(s);
  //       e = score(s);

  //       // TODO - add digits until overconstrained, remove digits until under...

  //     }
  //   }
  // }
}

// function main2() {
//   for (const g of Grid.EXCLUSIONS) {
//     console.log(Grid.show(g),'\n');
//   }
// }
 
function main2() {
  const g = Grid.from(`
    123 ... ...
    e.. 456 ..e
    ... ... ...

    ... ... ...
    2.. ... ...
    ... ... ...

    ... ... ...
    ... ... ...
... ... ...
  `);
  console.log(Grid.show(g), '\n', Grid.count(g), '\n');
  const n = Grid.normalize(g);
  if (n == null) return console.log('undefined');
  console.log(Grid.show(n), '\n', Grid.count(n));

  for (const s of Grid.solve(g)) {
    console.log(Grid.show(s), '\n', Grid.count(s));
  }
}

if (import.meta.url.startsWith('file:')) {
  const modulePath = url.fileURLToPath(import.meta.url);
  if (process.argv[1] === modulePath) main3();
}

// NEXT: given a score=0 grid, put appropriate numbers on the boxes
//       and see if it solves uniquely
// - 9-cells are rare
//   we know it won't work without at least 1, preferably 2 ???


// for (const ss of connectedComponents(s)) {
//   console.log(Shading.show(ss), '\n');
// }

// for (let i = 0; i < 20; i++) {
//   console.log(Shading.show(s), '\n');
//   s = mutate(s);
// }

// for (const r of ) {
//   console.log(Shading.show(r), '\n');
// }

// TODO - given a grid e.g.
//   4o5 34e e3o
//   43o 2e5 5o2
//   e47 o97 72e
//  
//   e64 e97 7oo
//   5eo 25e 4o3
//   9oo 79e 66e
//  
//   o3e 57o ee4
//   524 323 3eo
//   oo6 4e4 o3o
// figure out if it's solvable. If not, REMOVE CLUES (reducing givens to
// odd/even) until it _IS_ solvable - check if it's unique...

// see which clues are actually issues - add/remove and re-check solution count
