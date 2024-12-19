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

  interface ShowOpts {
    lines?: boolean;
    geometry?: Shading[];
    digit?: number;
  }
  export function show(s: Shading, {lines = true, geometry, digit = 1}: ShowOpts = {}): string {
    if (geometry) {
      const regionGrid = Grid.fromShadings(geometry);
      const grid = (Grid.fromShading(s) << BigInt(digit - 1)) as Grid;
      return showRegions(regionGrid, grid);
    }
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
        const digit = digitMap.get(b) ?? String.fromCharCode(0x2800 | Number(b)); // '.';
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

  export const ANTI_KING: readonly Shading[] = [
    0n,  1n,  2n,  3n,  4n,
    6n,  7n,  8n,  9n,  10n,
    12n, 13n, 14n, 15n, 16n,
    18n, 19n, 20n, 21n, 22n,
    24n, 25n, 26n, 27n, 28n,
  ].flatMap(s => [0o01_02n << s, 0o02_01n << s]) as Shading[];

  export const ANTI_KNIGHT: readonly Shading[] = [
    ...[
      0n,  1n,  2n,  3n,
      6n,  7n,  8n,  9n,
      12n, 13n, 14n, 15n,
      18n, 19n, 20n, 21n,
      24n, 25n, 26n, 27n,
    ].flatMap(s => [0o01_04n << s, 0o04_01n << s]),
    ...[
      0n,  1n,  2n,  3n, 4n,
      6n,  7n,  8n,  9n, 10n,
      12n, 13n, 14n, 15n, 16n,
      18n, 19n, 20n, 21n, 22n,
    ].flatMap(s => [0o01_00_02n << s, 0o02_00_01n << s]),
  ] as Shading[];

  export function exclusions(shadings: Shading[]): Map<bigint, Shading> {
    const out = new Map<bigint, bigint>();
    for (const shading of shadings) {
      let x: bigint = shading;
      while (x) {
        const rest = x & (x - 1n);
        const bit = x ^ rest;
        x = rest;
        out.set(bit, (out.get(bit) ?? 0n) | (shading & ~bit));
      }
    }
    return out as Map<bigint, Shading>;
  }

  // All the possible 6-bit patterns that only touch one cell per row/col/box.
  export function patterns(exclusions: Map<bigint, Shading>): Shading[] {
    const out: Shading[] = [];
    function add(pattern: Shading, col: number) {
      if (col === 6) {
        out.push(pattern);
        return;
      }
      // console.log(`  box ${box} ${BOXES[box]} ${available}`);
      let x = COLS[col] & pattern;
      while (x) {
        const rest = x & (x - 1n);
        const bit = x ^ rest;
        x = rest;
        add((bit | (pattern & ~exclusions.get(bit))) as Shading, col + 1);
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
    let curr: bigint;
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

  export function regionsFromGrid(grid: Grid): Shading[] {
    let shadings = [0n, 0n, 0n, 0n, 0n, 0n];
    for (let i = 0; i < 6; i++) {
      for (let b = 0; b < 36; b++) {
        if (grid & (1n << BigInt(6 * b + i))) shadings[i] |= (1n << BigInt(b));
      }
    }
    return shadings as Shading[];
  }
}

export namespace Grid {
  export function fromArray(a: number[]): Grid {
    let out = 0n;
    for (let i = 0; i < 36; i++) {
      if (a[i]) out |= (1n << (BigInt(6 * i + a[i] - 1)));
    }
    return out as Grid;
  }

  // returns a 1-grid from the shading
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
  export const ALL_ONES = fromShading(Shading.ALL);

  export const count = (() => {
    let a = 0x55555555n;
    let b = 0x33333333n;
    let c = 0x0f0f0f0fn;
    let d = 0x001f001fn;
    let e = 0x00010001n;
    for (let i = 32n; i < 256n; i <<= 1n) {
      a |= a << i;
      b |= b << i;
      c |= c << i;
      d |= d << i;
      if (i < 128) e |= e << i;
    }
    const f128 = (1n << 128n) - 1n;

    return function count(g: Grid): number {
      let i: bigint = g;
      i -= (i >> 1n) & a;
      i = (i & b) + ((i >> 2n) & b);
      i = (i + (i >> 4n)) & c;
      i = (i + (i >> 8n)) & d; // 0..16 every 16 bits, 
      i = (i + (i >> 128n)) & f128;
      return Number(((i * e) >> 112n) & 0xffffn);
    };
  })();
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


const regions = Grid.fromArray([
  1, 2, 2, 2, 2, 3,
  1, 1, 2, 4, 2, 3,
  5, 1, 1, 4, 3, 3,
  5, 5, 1, 4, 4, 3,
  5, 5, 4, 4, 6, 3,
  5, 6, 6, 6, 6, 6,
]);
const hints = Grid.fromArray([
  1,,,,,,
  ,,2,,,,
  ,,,,,3,
  ,,,,4,,
  ,5,,,,,
  ,,,6,,,
]);
console.log(Shading.showRegions(regions, hints));
const exclusions = Shading.exclusions([...Shading.ROWS, ...Shading.COLS, ...Shading.regionsFromGrid(regions)]);
const [a, b] = solve(hints, regions, exclusions);
if (a) console.log(Shading.showRegions(regions, a));  
if (b) console.log(Shading.showRegions(regions, b));  
if (!a) {
  console.log(`No solution`);
} else if (b) {
  console.log(`Multiple solutions`);
} else {
  console.log(`Unique solution`);
}



//console.log(Shading.showRegions(Grid.fromShadings(Shading.BOXES)));
for (let i = 0; i < 200000; i++) {
  const regions = makeRegions();
  // look for fillominos - only need one splitting
  const fillominos: number[][] = [];

  for (let part = 0; part < 64; part++) {
    const inside = checkFillomino(regions.filter((_, i) => part & (1 << i)));
    const outside = checkFillomino(regions.filter((_, i) => !(part & (1 << i))));
    let insideShading = 0n;
    for (const i of Bitmap.bits(BigInt(part))) {
      insideShading |= regions[i];
    }
    if (inside && outside && Shading.isConnected(insideShading as Shading)) {
      fillominos.push(Bitmap.bits(BigInt(part)).map(x => x + 1));
      // TODO - convert this to a bipartite grid
    }
  }
  if (!fillominos.length) continue; // log?

  // look for a star battle solution
  const regionGrid = Grid.fromShadings(regions);
  const givens = computeGivens(regions, sightGrid(regionGrid));
  if (!givens) continue;

  // console.log(Shading.showRegions(regionGrid, givens));
  // console.log(Shading.showRegions(regionGrid));
  for (const f of fillominos) {
    // reduce regionGrid to fillominos
    let fillominoGrid = 0n;
    for (let i = 0; i < 6; i++) {
      fillominoGrid |= (Grid.fromShading(regions[i]) << (f.includes(i + 1) ? 1n : 0n));
    }
    //console.log(`Fillomino ${f.join(', ')}`);
    console.log(Shading.showRegions(fillominoGrid as Grid, givens));
  }

  const exclusions = Shading.exclusions([
    ...regions,
    ...Shading.ROWS,
    ...Shading.COLS,
  ]);
  const [a, b] = solve((givens & ~((1n << 72n) - 1n)) as Grid, regionGrid, exclusions);
  //const [a, b] = solve(givens, regionGrid, exclusions);
  if (a) console.log(Shading.showRegions(regionGrid, a));  
  if (b) console.log(Shading.showRegions(regionGrid, b));  
  if (!a) {
    console.log(`No solution`);
  } else if (b) {
    console.log(`Multiple solutions`);
  } else {
    console.log(`Unique solution`);
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
function computeGivens(geometry: Shading[], sights: Grid): Grid|undefined {
  // TODO - maybe just pass the precomputed exclusions instead of geometry grid?
  // NOTE: these exclusions include anti-king rules as well

  const exclusions = Shading.exclusions([
    ...geometry,
    ...Shading.ROWS,
    ...Shading.COLS,
    ...Shading.ANTI_KING,
  ]);

  // Map of sight# -> shading of cells that have that sight#.  Sort by count.
  type Sight = [sightNum: number, cells: Shading, count: number];
  const bySight: Sight[] = (() => {
    const arr = [undefined, undefined, 0n, 0n, 0n, 0n, 0n]; // shadings
    for (let i = 0n; i < 36n; i++) {
      arr[digitMap.get((sights >> (i * 6n)) & 63n)] |= (1n << i);
    }
    return arr.flatMap((s, i) => s != null ? [[i, s as Shading, count64(s)] as Sight] : [])
        .sort((a, b) => a[2] - b[2]);
  })();
  // Make sure there's at least one of each sight#
  function fail(msg: string) {
    const regionGrid = Grid.fromShadings(geometry);
    console.log(Shading.showRegions(regionGrid, sights));
    console.log(msg);
  }
  if (!bySight[0][2]) {
    // fail(`no cells with sight# ${bySight[0][0]}`);
    return undefined;
  }

  // Recursive approach
  const found = new Set();
  function* fill(clues: Shading, sights: Sight[], available: Shading): Generator<Shading> {
    if (!sights.length) {
      if (!found.has(clues)) {
        found.add(clues);
        yield clues;
      }
      return;
    }
    const shading = sights[0][1];
    // iterate over bits of the next-queued shading
    let x = shading & available;
    // console.log(`shadings ${sights.length} ${sights[0][0]}`);
    // console.log(Shading.show(shading, {geometry}));
    // console.log(`available`);
    // console.log(Shading.show(available, {geometry, digit: sights[0][0]}));
    // console.log(`intersect`);
    // console.log(Shading.show(x as Shading, {geometry}));
    while (x) {
      const rest = x & (x - 1n);
      const bit = x ^ rest;
      x = rest;
      // console.log(`bit ${sights.map(a=>a[0]).join(' ')}`);
      // console.log(Shading.show(bit as Shading, {geometry, digit: sights[0][0]}));
      yield* fill(
        (clues | bit) as Shading,
        sights.slice(1),
        (available & ~exclusions.get(bit) & ~bit) as Shading,
      );
    }
  }
  const [a, b] = fill(Shading.EMPTY, [...bySight, [1, Shading.ALL, 0]], Shading.ALL);
  if (a == null) {
    // fail(`no star battle solution`);
    return undefined;
  }
  if (b != null) {
    //fail(`non-unique star battle solution`);
    //console.log(Shading.show(a, {geometry}));
    //console.log(Shading.show(b, {geometry}));
    //process.exit(1);
    return undefined;
  }
  // process shading into a grid
  return ((Grid.fromShading(a) * 0o77n) & sights) as Grid;
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

// Attempts to solve the grid, should be called after normalize...?
function* solve(g: Grid, geometry: Grid, exclusions: Map<bigint, Shading>): Generator<Grid> {
  // Look for patterns that can fit, recurse/backtrack
  console.log(`solve:\n${Shading.showRegions(geometry, g)}`);
  const patterns = Shading.patterns(exclusions);


  // TODO - solve of known-good sudoku is not working

  // NOTE: the patterns look correct.
  // console.log(`patterns: ${patterns.length}`);
  // for (const p of patterns) {
  //   console.log(Shading.showRegions(geometry, Grid.fromShading(p)));
  // }

  // What about the exclusions, as well as the bucketed ones?


  // Filter the set of patterns by digit
  const patsByDigit: Grid[][] = [0, 1, 2, 3, 4, 5].map((d) =>
    patterns.flatMap(p => {
      const p1 = p << BigInt(d);
      return (g & p1) === p1 ? [p1 as Grid] : [];
    }));
  const exclByDigit: Map<bigint, Grid> = new Map([...exclusions].flatMap(
    ([k, v]) => [0n, 1n, 2n, 3n, 4n, 5n].map(
      d => [(k ** 6n) << d, Grid.fromShading(v) << d] as [bigint, Grid])));
  const exclByPattern: Map<bigint, Grid> = (() => {
    const map = new Map<bigint, Grid>();
    for (const p of patsByDigit.flat()) {
      let e = 0n;
      let x: bigint = p;
      while (x) {
        const rest = x & (x - 1n);
        const bit = x ^ rest;
        x = rest;
        e |= exclByDigit.get(bit);
      }
      map.set(p, e as Grid);
    }
    return map;
  })();
  
  const solutions = new Set<Grid>();
  let unfilled: bigint = g;
  for (let m = 63n << 210n; m; m >>= 6n) {
    if (!(g & m)) unfilled |= m;
  }
  yield* solveInner(unfilled as Grid);

  function* solveInner(g: Grid) {
    const n = normalize(g);
    if (!n) { console.log(`failed normalize`); return; }
    g = n;
    const sizes = [0, 1, 2, 3, 4, 5].map((i) => Grid.count((g & (Grid.ALL_ONES << BigInt(i))) as Grid));
    // check if we're solved and/or impossible
    if (sizes.every(s => s <= 6)) {
      console.log(`at most 6 of each digit: ${sizes.join(',')}`);
      if (sizes.every(s => s === 6)) {
        if (!solutions.has(g)) yield g;
        solutions.add(g);
      }
      return;
    }
    // find the most-constrained number
    let d = -1;
    for (let i = 0; i < 6; i++) {
      if (sizes[i] >= sizes[d] || sizes[i] <= 6) continue;
      d = i;
    }
    console.log(`most constrained: ${d}: ${sizes[d]} - ${patsByDigit[d].length} patterns\n${Shading.showRegions(geometry, g)}`);
    
    // look for patterns that constrain it further
    //  - TODO - this is slow, can we make a trie of the patterns?
    //         - find the most constrained _cell_ and look it up in trie?
    //         - guarantee we only look at the 1/9 or 1/81 that actually matter?
    for (const p of patsByDigit[d]) {
      if ((g & p) === p) {
        console.log(`found allowable pattern:\n${Shading.showRegions(geometry, p)}`);
        const e = exclByPattern.get(p);
        yield* solveInner((g & ~e) as Grid);
      }
    }
  }

  // function exclusion(g: Grid): Grid {
  //   let e = 0n;
  //   let x: bigint = g;
  //   while (x) {
  //     const rest = x & (x - 1n);
  //     const bit = x ^ rest;
  //     x = rest;
  //     e |= exclusions.get(bit);
  //   }
  //   return e as Grid;
  // }
  // export function lookup(g: Grid, c: CellAddr): Mask {
  //   return Number((g >> BigInt(c * 9)) & 0x1ffn) as Mask;
  // }

  // Apply exclusions for all fixed numbers.  Iterates to a fixed point.
  function normalize(g: Grid): Grid|undefined {
    console.log(`normalize`);
    let out: bigint = g;
    let mask = 63n;
    for (let i = 0; i < 36; i++) {
      // const m = lookup(out, i);
      // if (m === 0) return undefined;
      // const v = !(m & (m - 1n)); // isSingular(m)
      // if (v == null) continue;
      // const e = EXCLUSIONS[9 * i + v - 1];
      // out = (out & ~e) as Grid;
      const b = g & mask;
      mask <<= 6n;
      if (!b) return undefined;
      if (b & (b - 1n)) continue; // not a fixed digit.
      const e = exclByDigit.get(b);
      out &= ~e;
    }
    //console.log(`${Grid.show(g)}\nto\n${Grid.show(out)}`);
    return out === g ? out as Grid : normalize(out as Grid);
  }
}
