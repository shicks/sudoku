#!/usr/bin/env -S node -r source-map-support/register

import * as url from 'node:url';
import * as lz from 'lz-string';

// Tools for setting and solving sudokus

// Set of bits from 0..35
export type Shading = bigint & {__shading__: never};

// bits 0..215 - each 36-bit chunk is a different digit 1..6
export type Grid = bigint & {__grid__: never};

// bits 0..5 indicating possibility of each number 1..6
export type Mask = number & {__mask__: never};

// cell address 0..35
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
      s >>= 32n;
      offset += 32;
    }
    return out;
  }
}

export namespace Shading {
  export const ALL = 0o777777_777777n as Shading;
  export const EMPTY = 0n as Shading;

  export function cpl(s: Shading): Shading {
    return (ALL ^ s) as Shading;
  }

  export function bit(b: number): bigint {
    return 1n << BigInt(b);
  }

  export function has(s: bigint, b: number): boolean {
    return Boolean(s & (1n << BigInt(b)));
  }

  export function bits(s: bigint): number[] {
    const out = [];
    let offset = 0;
    while (s) {
      // TODO - do 30 bits at a time instead of 32
      let x = Number(s & 0xffffffffn);
      let y = offset;
      while (x) {
        const z = 32 - Math.clz32(x ^ (x - 1));
        out.push((y += z) - 1);
        if (z === 32) break;
        x >>>= z;
      }
      s >>= 32n;
      offset += 32;
    }
    return out;
  }

  // Counts bits up to 64
  export function count(i: bigint): number {
    i -= (i >> 1n) & 0x5555555555555555n;
    i = (i & 0x3333333333333333n) +
        ((i >> 2n) & 0x3333333333333333n);
    i = (i + (i >> 4n)) & 0x0f0f0f0f0f0f0f0fn;
    return Number(((i * 0x0101010101010101n) >> 56n) & 0xffn);
  }

  export function show(s: Shading, {lines = true} = {}): string {
    let out = '';
    let bits: bigint = s;
    for (let i = 0; i < 36; i++) {
      out += (bits & 1n) ? 'x' : '.';
      if (i % 3 === 2) {
        if (i % 6 === 5) {
          if (i % 12 === 11) {
            if (i < 35) out += lines ? '\n---+---+---\n' : '\n';
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

  const verticalEdge = '│';
  const horizontalEdge = '─';
  const topLeftCorner = '┌';
  const topRightCorner = '┐';
  const bottomLeftCorner = '└';
  const bottomRightCorner = '┘';
  const corners = {
    '0000': ' ',
    '0001': '┌',
    '0010': '┐',
    '0011': '─',
    '0012': '┬',
    '0100': '└',
    '0101': '│',
    '0102': '├',
    '0111': '┘',
    '0121': '┤',
    '0122': '┴',
    '0123': '┼',
  };
  const badCorner = '╳';

  function same(regions: Grid, a: number, b: number): boolean {
    return ((regions >> BigInt(a)) & 63n) === ((regions >> BigInt(b)) & 63n);
  }

  function getChar(regions: Grid, row: number, col: number, values: Grid = regions): string {
    // NOTE: row and col go from 0 to 12, where odds are spaces and
    // evens are edges/corners.
    const bit = 6 * ((row >> 1) * 6 + (col >> 1));
    if (row & 1) {
      // we're in the middle of a row
      // if (col & 1) return ' . '; // TODO - fill in more info on spaces?
      if (col & 1) {
        let b = (values >> BigInt(bit)) & 63n;
        const digit = digitMap.get(b) || '.';
        return ` ${digit} `;
      }
      if (!col || col === 12) return verticalEdge;
      return same(regions, bit, bit - 6) ? ' ' : verticalEdge;
    } else {
      // on a horizontal edge
      if (col & 1) return same(regions, bit, bit - 36) ? '   ' : horizontalEdge.repeat(3);
      // corner: figure out what we're looking at.
      const s = new Map<bigint, number>();
      let corner = '';
      for (let dr = 36; dr >= 0; dr -= 36) {
        for (let dc = 6; dc >= 0; dc -= 6) {
          const oob = !row && dr || row === 12 && !dr || !col && dc || col === 12 && !dc;
          const cell = oob ? -1n : (regions >> BigInt(bit - dr - dc)) & 63n;
          if (!s.has(cell)) s.set(cell, s.size);
          corner += s.get(cell);
        }
      }
      return corners[corner] ?? badCorner;
    }
  }

  export function showRegions(regions: Grid, values?: Grid): string {
    let out = '';
    for (let r = 0; r <= 12; r ++) {
      for (let c = 0; c <= 12; c++) {
        out += getChar(regions, r, c, values);
      }
      if (r < 12) out += '\n';
    }
    return out;
  }

  // given a coloring, return a set of 6 shadings.

  export const BOXES: readonly Shading[] = [
    0o0000_0000_0707n,
    0o0000_0000_7070n,
    0o0000_0707_0000n,
    0o0000_7070_0000n,
    0o0707_0000_0000n,
    0o7070_0000_0000n,
  ] as Shading[];
  
  // set of 9 shadings, each representing a single fully-shaded row.
  export const ROWS: readonly Shading[] = [
    0o000000_000077n,
    0o000000_007700n,
    0o000000_770000n,
    0o000077_000000n,
    0o007700_000000n,
    0o770000_000000n,
  ] as Shading[];

  // set of 9 shadings, each representing a single fully-shaded column.
  export const COLS: readonly Shading[] = [
    0o010101_010101n,
    0o020202_020202n,
    0o040404_040404n,
    0o101010_101010n,
    0o202020_202020n,
    0o404040_404040n,
  ] as Shading[];

  export function exclusions(shadings: Shading[]): Shading[] {
    const out = Array.from({length: 81}, () => 0n);
    for (const s of shadings) {
      for (const b of bits(s)) {
        // out[b] = or(out[b], s);
        out[b] |= s;
      }
    }
    for (let b = 0; b < 36; b++) {
      out[b] &= ~bit(b);
    }
    return out as Shading[];
  }

  // All the possible 9-bit patterns that only touch one cell per row/col/box.
  export function patterns(exclusions: Shading[]): Shading[] {
    const out: Shading[] = [];
    function add(pattern: Shading, col: number) {
      if (col === 6) {
        out.push(pattern);
        return;
      }
      // console.log(`  box ${box} ${BOXES[box]} ${available}`);
      for (const c of bits(COLS[col] & pattern)) {
        add((pattern & ~cpl(exclusions[c])) as Shading, col + 1);
      }
    }
    add(ALL, 0);
    return out;
  }

  export function neighborsOf(region: Shading): Shading {
    let x: bigint = region;
    let neighbors = 0n;
    while (x) {
      const rest = x & (x - 1n);
      const bit = x ^ rest;
      x = rest;
      neighbors |= neighborMap.get(bit); // NOTE: should be defined
    }
    return (neighbors & ~region) as Shading;
  }

  export function isConnected(s: Shading): boolean {
    const rest = s & (s - 1n);
    let next = s ^ rest;
    let curr;
    while (true) {
      curr = next;
      next = (neighborsOf(curr as Shading) | curr) & s;
      if (next === s) return true;
      if (curr === next) return false;
    }
  }

  export function peripheryOf(region: Shading): Shading {
    let x: bigint = region;
    let periphery = 0n;
    while (x) {
      const rest = x & (x - 1n);
      const bit = x ^ rest;
      if (isConnected((region & ~bit) as Shading)) periphery |= bit;
      x = rest;
    }
    return periphery as Shading;
  }
}

export namespace Grid {
  // return sa 1-grid from the shading
  export function fromShading(s: Shading): Grid {
    let mask = 1n << 35n;
    let out = 0n;
    while (mask) {
      out <<= 6n;
      if (s & mask) out |= 1n;
      mask >>= 1n;
    }
    return out as Grid;
  }
  export function fromShadings(shadings: readonly Shading[]): Grid {
    if (shadings.length > 6) throw new Error('too many shadings');
    let g = 0n;
    for (let i = 0; i < shadings.length; i++) {
      g |= (fromShading(shadings[i]) << BigInt(i));
    }
    return g as Grid;
  }
}

// Build a random set of regions

const neighbors: ReadonlyArray<readonly number[]> = (() => {
  const out: number[][] = Array.from({length: 36}, () => []);
  for (let r = 0; r < 36; r += 6) {
    for (let c = 0; c < 6; c++) {
      const x = r + c;
      if (c) {
        out[x].push(x - 1);
        out[x - 1].push(x);
      }
      if (r) {
        out[x].push(x - 6);
        out[x - 6].push(x);
      }
    }
  }
  return out;
})();
const neighborMap: ReadonlyMap<bigint, bigint> = new Map(
  neighbors.map((ns, c) => {
    let shading = 0n;
    for (const n of ns) {
      shading |= (1n << BigInt(n));
    }
    return [1n << BigInt(c), shading];
  }));
const digitMap: ReadonlyMap<bigint, number> =
    new Map([[1n, 1], [2n, 2], [4n, 3], [8n, 4], [16n, 5], [32n, 6]]);

// Returns a random singleton shading
function pickBit(shading: Shading): Shading {
  let x: bigint = shading;
  let count = 0;
  let bit!: bigint;
  while (x) {
    const rest = x & (x - 1n);
    const b = x ^ rest;
    x = rest;
    if (Math.random() * ++count < 1) bit = b;
  }
  return bit as Shading;
}

function count64(i: bigint): number {
  i -= (i >> 1n) & 0x5555555555555555n;
  i = (i & 0x3333333333333333n) +
      ((i >> 2n) & 0x3333333333333333n);
  i = (i + (i >> 4n)) & 0x0f0f0f0f0f0f0f0fn;
  return Number(((i * 0x0101010101010101n) >> 56n) & 0xffn);
}

// Returns a random singleton shading among those with the lowest
// number of available neighbors.  This is the same as pickBit
// except it keeps track of liberties and resets count whenever
// a better number is found
function pickCornerBit(available: Shading): Shading {
  let x: bigint = available;
  let count = 0;
  let bit!: bigint;
  let liberties = 5;
  while (x) {
    const rest = x & (x - 1n);
    const b = x ^ rest;
    x = rest;
    const num = count64(neighborMap.get(b) & available);
    if (num < liberties) {
      liberties = num;
      count = 0;
    }
    if (num === liberties && Math.random() * ++count < 1) bit = b;
  }
  return bit as Shading;
}

function makeRegions(): Shading[] {
  OUTER:
  for (let attempt = 0; attempt < 100; attempt++) {
    const regions = [0n, 0n, 0n, 0n, 0n, 0n];
    let available = (1n << 36n) - 1n;
    function add(cell: Shading, regionNum: number) {
      available &= ~cell;
      regions[regionNum] |= cell;
    }
    for (let regionNum = 0; regionNum < 6; regionNum++) {
      const start = pickCornerBit(available as Shading);
      if (start == null) throw new Error('no start?');
      let region: bigint = start;
      add(start, regionNum);
      for (let i = 1; i < 6; i++) {
        const eligible = Shading.neighborsOf(region as Shading) & available;
        if (!eligible) {
          //console.error(`painted into a corner: retry ${attempt + 1}`);
          continue OUTER;
        }
        const next = pickBit(eligible as Shading);
        region |= next;
        add(next, regionNum);
      }
    }
    return regions as Shading[];
  }
  throw new Error('failed to make regions');
}

//console.log(Shading.showRegions(Grid.fromShadings(Shading.BOXES)));
for (let i = 0; i < 2000; i++) {
  const regions = makeRegions();
  // look for fillominos - only need one splitting
  let shown = false;
  for (let part = 0; part < 64; part++) {
    const inside = checkFillomino(regions.filter((_, i) => part & (1 << i)));
    const outside = checkFillomino(regions.filter((_, i) => !(part & (1 << i))));
    let insideShading = 0n;
    for (const i of Bitmap.bits(BigInt(part))) {
      insideShading |= regions[i];
    }
    if (inside && outside && Shading.isConnected(insideShading as Shading)) {
      if (!shown) {
        const regionGrid = Grid.fromShadings(regions);
        console.log(Shading.showRegions(regionGrid));
        console.log(Shading.showRegions(regionGrid, sightGrid(regionGrid)));
        shown = true;
      }
      console.log(`Fillomino ${Bitmap.bits(BigInt(part)).map(x => x + 1).join(', ')}`);
    }
  }
}

// Given regions, figure out if they fillomino uniquely:
//  - given half the grid, start with cells w/ a single
//    neighbor and attach them.
//  - continue list-monadic branched union-find until we
//    see multiple successful partitionings, or conclude
//    that there's only one???


// NOTE: This is not completely accurate. e.g. it won't recognize cases like
//
//   oooooo         oooxxx
//     xx     ==>     ox
//     xx             ox
//     xx             ox
//
// We still need some manual review here
function checkFillomino(shadings: Shading[]): boolean {
  // note: shading may not be fully-connected, in which case
  // this is probably easier?
  const periphery = shadings.map(Shading.peripheryOf);
  const neighbors = shadings.map(Shading.neighborsOf);
  for (let i = 0; i < shadings.length; i++) {
    for (let j = 0; j < i; j++) {
      let x = periphery[i] & neighbors[j];
      // we found a cell C from periphery[i] that we could move into j
      // look for a cell from periphery[j+C] in neighbors[i-C]
      while (x) {
        const rest = x & (x - 1n);
        const bit = rest ^ x;
        x = rest;
        const n = Shading.neighborsOf((shadings[i] & ~bit) as Shading);
        const p = Shading.peripheryOf((shadings[j] | bit) as Shading);
        if (n & p) return false;
      }
    }
  }
  return true;
}


// Given a sightGrid, find a star-battle solution with 2..6
//  1. map sight -> cells
//  2. for sight numbers w/ fewest cells (2 and 6 typically),
//     exhaustively pick all the possibilities and then
//     block out all the exclusions
//      a. then place the remainder however we can - exhaustive will still work
function computeGivens(geometry: Grid, sights: Grid): Grid {
  // TODO - maybe just pass the precomputed exclusions instead of geometry grid?
  // NOTE: these exclusions include anti-king rules as well
}


function* partition(shading: Shading): Generator<Shading[]> {
  throw '';
}

function sightGrid(grid: Grid): Grid {
  let shift = 0n;
  let sight = 0n;
  for (let r = 0n; r < 216n; r += 36n) {
    for (let c = 0n; c < 36n; c += 6n) {
      const bit = (grid >> (r + c)) & 63n;
      let count = 1n;
      for (let rr = r + 36n; rr < 216n; rr += 36n) {
        if (!(grid & (bit << (rr + c)))) break;
        count++;
      }
      for (let rr = r - 36n; rr >= 0n; rr -= 36n) {
        if (!(grid & (bit << (rr + c)))) break;
        count++;
      }
      for (let cc = c + 6n; cc < 36n; cc += 6n) {
        if (!(grid & (bit << (r + cc)))) break;
        count++;
      }
      for (let cc = c - 6n; cc >= 0n; cc -= 6n) {
        if (!(grid & (bit << (r + cc)))) break;
        count++;
      }
      sight |= 1n << (shift + count - 1n);
      shift += 6n;
    }
  }
  return sight as Grid;
}


// TODO - work from here
// There are irregular 6s w/ 5-6 clues, we just need to find one
// where the clues fit the requirements and the shape is fillomino

const singles = new Set([1n, 2n, 4n, 8n, 16n, 32n, 64n]);
  

function cost(grid: Grid): number {
  let cost = 0;
  const cellSets = Array.from({length: 6}, () => new Set<number>());
  // 1. each cell has exactly one digit
  let g: bigint = grid;
  for (let i = 0; i < 36; i++) {
    let bits = 0;
    for (let j = 0; j < 6; j++) {
      if (g & 1n) {
        bits++;
        cellSets[j].add(i);
      }
      g >>= 1n;
    }
    cost += Math.abs(bits - 1);
  }
  // 2. each group is connected
  for (const cells of cellSets) {
    // should be a small set of cells - do a depth-first search.
    const seen = new Set();
    let components = 0;
    for (let c of cells) {
      if (seen.has(c)) continue;
      components++;
      const queue = new Set([c]);
      for (const x of queue) {
        for (const y of neighbors[x]) {
          if (!cells.has(y)) continue;
          queue.add(y);
          cells.delete(y);
        }
      }
    }
    cost += Math.abs(components - 1);
  }
  return cost;
}
