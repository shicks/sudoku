#!/usr/bin/env -S node -r source-map-support/register

import { countFor, seq } from './util.js';

// TODO - work with polyominos (as shadings?) - could use same N
// and just shift them around as needed? or use a different representation that
// doesn't presuppose a grid width?

const N = 9;
const Nn = BigInt(N);
//const Nm1 = N - 1;
//const Nm1n = Nn - 1n;

//const Nt2 = N * 2;

const N2 = N * N;
const N2n = BigInt(N2);
//const N2m1 = N2 - 1;
const N2m1n = N2n - 1n;

const N3 = N2 * N;
const N3n = BigInt(N3);
//const N3m1 = N3 - 1;
//const N3m1n = N3n - 1n;

const DIGIT = (1n << Nn) - 1n

// Tools for setting and solving sudokus

// Set of bits from 0..N2m1
export type Shading = bigint & {__shading__: never};

// bits 0..N3m1 - each N2-bit chunk is a different digit 1..N
export type Grid = bigint & {__grid__: never};

// bits 0..Nm1 indicating possibility of each number 1..N
export type Mask = number & {__mask__: never};

// cell address 0..N2m1
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
  export const ALL = (1n << N2n) - 1n as Shading;
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

  export const count = countFor(N2);

  interface ShowOpts {
    lines?: boolean;
    geometry?: Shading[];
    digit?: number;
  }
  // export function show(s: Shading, {lines = true, geometry, digit = 1}: ShowOpts = {}): string {
  //   if (geometry) {
  //     const regionGrid = Grid.fromShadings(geometry);
  //     const grid = (Grid.fromShading(s) << BigInt(digit - 1)) as Grid;
  //     return showRegions(regionGrid, grid);
  //   }
  //   let out = '';
  //   let bits: bigint = s;
  //   for (let i = 0; i < N2; i++) {
  //     out += (bits & 1n) ? 'x' : '.';
  //     if (i % 3 === 2) {
  //       if (i % 6 === 5) {
  //         if (i % 12 === 11) {
  //           if (i < N2m1) out += lines ? '\n---+---+---\n' : '\n';
  //         } else {
  //           out += '\n';
  //         }
  //       } else {
  //         out += lines ? '|' : '';
  //       }
  //     }
  //     bits >>= 1n;
  //   }
  //   return out;
  // }

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
  const twoN = 2 * N;

  function same(regions: Grid, a: number, b: number): boolean {
    return ((regions >> BigInt(a)) & DIGIT) === ((regions >> BigInt(b)) & DIGIT);
  }

  function getChar(regions: Grid, row: number, col: number, values: Grid = regions): string {
    // NOTE: row and col go from 0 to 12, where odds are spaces and
    // evens are edges/corners.
    const bit = N * ((row >> 1) * N + (col >> 1));
    if (row & 1) {
      // we're in the middle of a row
      // if (col & 1) return ' . '; // TODO - fill in more info on spaces?
      if (col & 1) {
        let b = (values >> BigInt(bit)) & DIGIT;
        const digit = digitMap.get(b) ?? String.fromCharCode(0x2800 | Number(b)); // '.';
        return ` ${digit} `;
      }
      if (!col || col === twoN) return verticalEdge;
      return same(regions, bit, bit - N) ? ' ' : verticalEdge;
    } else {
      // on a horizontal edge
      if (col & 1) return same(regions, bit, bit - N2) ? '   ' : horizontalEdge.repeat(3);
      // corner: figure out what we're looking at.
      const s = new Map<bigint, number>();
      let corner = '';
      for (let dr = N2; dr >= 0; dr -= N2) {
        for (let dc = N; dc >= 0; dc -= N) {
          const oob = !row && dr || row === twoN && !dr
            || !col && dc || col === twoN && !dc;
          const cell = oob ? -1n : (regions >> BigInt(bit - dr - dc)) & DIGIT;
          if (!s.has(cell)) s.set(cell, s.size);
          corner += s.get(cell);
        }
      }
      return corners[corner] ?? badCorner;
    }
  }

  export function showRegions(regions: Grid, values?: Grid): string {
    let out = '';
    for (let r = 0; r <= twoN; r ++) {
      for (let c = 0; c <= twoN; c++) {
        out += getChar(regions, r, c, values);
      }
      if (r < twoN) out += '\n';
    }
    return out;
  }

  // TODO - given a coloring, return a set of N `Shading`s

  export function makeBoxes(rows?: number, cols?: number): readonly Shading[] {
    if (!rows) {
      for (rows = Math.floor(Math.sqrt(N)); rows > 0; rows--) {
        if (rows * Math.floor(N / rows) === N) break;
      }
    }
    if (!rows) throw new Error(`could not find suitable box sizes`);
    if (!cols) cols = N / rows;
    rows = Math.floor(rows);
    cols = Math.floor(cols);
    if (rows * cols !== N) {
      throw new Error(`bad dimensions: ${rows}x${cols} != ${N}`);
    }
    const boxes: bigint[] = new Array(N).fill(0n);
    let br = 0;
    let cell = 1n;
    for (let row = 0; row < N; row++) {
      let bc = 0;
      for (let col = 0; col < N; col++) {
        boxes[br + bc] |= cell;
        cell <<= 1n;
        if (col % cols === cols - 1) bc++;
      }
      if (row % rows === rows - 1) br += cols;
    }
    return boxes as Shading[];
  }

  // export const BOXES: readonly Shading[] = [
  //   0o0000_0000_0707n,
  //   0o0000_0000_7070n,
  //   0o0000_0707_0000n,
  //   0o0000_7070_0000n,
  //   0o0707_0000_0000n,
  //   0o7070_0000_0000n,
  // ] as Shading[];
  
  // set of 9 shadings, each representing a single fully-shaded row.
  export const ROWS: readonly Shading[] =
    seq(Nn, (row) => (DIGIT << Nn * row) as Shading);

  // set of 9 shadings, each representing a single fully-shaded column.
  export const COLS: readonly Shading[] =
    seq(Nn, (col) => {
      let x = 0n;
      for (let c = 1n << (N2n - Nn + col); c; c >>= Nn) {
        x |= c;
      }
      return x as Shading;
    });

  // TODO - support tesselating smaller shapes
  // export const ANTI_KING: readonly Shading[] = tessellate`
  //   | x|x |
  //   |x | x|`;

  // export const ANTI_KNIGHT: readonly Shading[] = tessellate`
  //   |  x|x  | x|x |
  //   |x  |  x|  |  |
  //           |x | x|`;

  // export const ANTI_KING: readonly Shading[] = [
  //   0n,  1n,  2n,  3n,  4n,
  //   6n,  7n,  8n,  9n,  10n,
  //   12n, 13n, 14n, 15n, 16n,
  //   18n, 19n, 20n, 21n, 22n,
  //   24n, 25n, 26n, 27n, 28n,
  // ].flatMap(s => [0o01_02n << s, 0o02_01n << s]) as Shading[];

  // export const ANTI_KNIGHT: readonly Shading[] = [
  //   ...[
  //     0n,  1n,  2n,  3n,
  //     6n,  7n,  8n,  9n,
  //     12n, 13n, 14n, 15n,
  //     18n, 19n, 20n, 21n,
  //     24n, 25n, 26n, 27n,
  //   ].flatMap(s => [0o01_04n << s, 0o04_01n << s]),
  //   ...[
  //     0n,  1n,  2n,  3n, 4n,
  //     6n,  7n,  8n,  9n, 10n,
  //     12n, 13n, 14n, 15n, 16n,
  //     18n, 19n, 20n, 21n, 22n,
  //   ].flatMap(s => [0o01_00_02n << s, 0o02_00_01n << s]),
  // ] as Shading[];

  export const ANTI_KING: readonly Shading[] = [
    ...tessellate((1n | 1n << Nn + 1n) as Shading),
    ...tessellate((2n | 1n << Nn) as Shading),
  ];

  export const ANTI_KNIGHT: readonly Shading[] = [
    ...tessellate((1n | 1n << 2n * Nn + 1n) as Shading),
    ...tessellate((2n | 1n << 2n * Nn) as Shading),
    ...tessellate((1n | 1n << Nn + 2n) as Shading),
    ...tessellate((4n | 1n << Nn) as Shading),
  ];

  export function height(s: Shading): number {
    let x: bigint = s;
    for (let i = 0; i < N; i++) {
      x &= ~ROWS[i];
      if (!x) return i + 1;
    }
    throw new Error('impossible');
  }

  export function width(s: Shading): number {
    let x: bigint = s;
    for (let i = 0; i < N; i++) {
      x &= ~COLS[i];
      if (!x) return i + 1;
    }
    throw new Error('impossible');
  }

  export function tessellate(
    s: Shading,
    verticalCopies: number = N + 1 - height(s),
    horizontalCopies: number = N + 1 - width(s),
  ): Shading[] {
    // TODO - check that there's no wrapping

    const out: bigint[] = [];
    const maxR = N * verticalCopies;
    for (let r = 0; r < maxR; r += N) {
      for (let c = 0; c < horizontalCopies; c++) {
        out.push(s << BigInt(r + c));
      }
    }
    return out as Shading[];
  }

  export function exclusions(shadings: Shading[]): Map<bigint, Shading> {
    const out = new Map<bigint, bigint>();
    for (const shading of shadings) {
      for (let x: bigint = shading; x;) {
        const rest = x & (x - 1n); const bit = x ^ rest; x = rest;
        out.set(bit, (out.get(bit) ?? 0n) | (shading & ~bit));
      }
    }
    return out as Map<bigint, Shading>;
  }

  // All the possible 6-bit patterns that only touch one cell per row/col/box.
  export function patterns(exclusions: Map<bigint, Shading>): Shading[] {
    const out: Shading[] = [];
    function add(pattern: Shading, col: number) {
      if (col === N) {
        out.push(pattern);
        return;
      }
      // console.log(`  box ${box} ${BOXES[box]} ${available}`);
      for (let x = COLS[col] & pattern; x;) {
        const rest = x & (x - 1n); const bit = x ^ rest; x = rest;
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
    let periphery = 0n;
    for (let x: bigint = region; x;) {
      const rest = x & (x - 1n); const bit = x ^ rest; x = rest;
      if (isConnected((region & ~bit) as Shading)) periphery |= bit;
    }
    return periphery as Shading;
  }

  export function regionsFromGrid(grid: Grid): Shading[] {
    let shadings = [0n, 0n, 0n, 0n, 0n, 0n];
    for (let i = 0; i < N; i++) {
      for (let b = 0; b < N2; b++) {
        if (grid & (1n << BigInt(N * b + i))) shadings[i] |= (1n << BigInt(b));
      }
    }
    return shadings as Shading[];
  }
}

export namespace Grid {
  export function fromArray(a: number[]): Grid {
    let out = 0n;
    for (let i = 0; i < N2; i++) {
      if (a[i]) out |= (1n << (BigInt(N * i + a[i] - 1)));
    }
    return out as Grid;
  }

  // returns a 1-grid from the shading
  export function fromShading(s: Shading): Grid {
    let mask = 1n << N2m1n;
    let out = 0n;
    while (mask) {
      out <<= Nn;
      if (s & mask) out |= 1n;
      mask >>= 1n;
    }
    return out as Grid;
  }
  export function fromShadings(shadings: readonly Shading[]): Grid {
    if (shadings.length > N) throw new Error('too many shadings');
    let g = 0n;
    for (let i = 0; i < shadings.length; i++) {
      g |= (fromShading(shadings[i]) << BigInt(i));
    }
    return g as Grid;
  }
  export const ALL_ONES = fromShading(Shading.ALL);

  export const count = countFor(N3);

  export function unfilled(givens: Grid) {
    let unfilled: bigint = 0n;
    for (let m = DIGIT << (N3n - Nn); m; m >>= Nn) {
      const given = givens & m;
      unfilled |= (given || m);
    }
    return unfilled as Grid;
  }
}

// Build a random set of regions

const neighbors: ReadonlyArray<readonly number[]> = (() => {
  const out: number[][] = seq(N2, () => []);
  for (let r = 0; r < N2; r += N) {
    for (let c = 0; c < N; c++) {
      const x = r + c;
      if (c) {
        out[x].push(x - 1);
        out[x - 1].push(x);
      }
      if (r) {
        out[x].push(x - N);
        out[x - N].push(x);
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
    new Map(seq(N, (i) => [1n << BigInt(i), i + 1]));

// Returns a random singleton shading
function pickBit(shading: Shading): Shading {
  let count = 0;
  let picked!: bigint;
  for (let x: bigint = shading; x;) {
    const rest = x & (x - 1n); const bit = x ^ rest; x = rest;
    if (Math.random() * ++count < 1) picked = bit;
  }
  return picked as Shading;
}

// Returns a random singleton shading among those with the lowest
// number of available neighbors.  This is the same as pickBit
// except it keeps track of liberties and resets count whenever
// a better number is found
function pickCornerBit(available: Shading): Shading {
  let count = 0;
  let picked!: bigint;
  let liberties = 5;
  for (let x: bigint = available; x;) {
    const rest = x & (x - 1n); const bit = x ^ rest; x = rest;
    const num = Shading.count(neighborMap.get(bit) & available);
    if (num < liberties) {
      liberties = num;
      count = 0;
    }
    if (num === liberties && Math.random() * ++count < 1) picked = bit;
  }
  return picked as Shading;
}

export function makeRegions(): Shading[] {
  OUTER:
  for (let attempt = 0; attempt < 100; attempt++) {
    const regions = seq(N, 0n);
    let available = (1n << N2n) - 1n;
    function add(cell: Shading, regionNum: number) {
      available &= ~cell;
      regions[regionNum] |= cell;
    }
    for (let regionNum = 0; regionNum < N; regionNum++) {
      const start = pickCornerBit(available as Shading);
      if (start == null) throw new Error('no start?');
      let region: bigint = start;
      add(start, regionNum);
      for (let i = 1; i < N; i++) {
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


// const regions = Grid.fromArray([
//   1, 2, 2, 2, 2, 3,
//   1, 1, 2, 4, 2, 3,
//   5, 1, 1, 4, 3, 3,
//   5, 5, 1, 4, 4, 3,
//   5, 5, 4, 4, 6, 3,
//   5, 6, 6, 6, 6, 6,
// ]);
// const hints = Grid.fromArray([
//   1,,,,,,
//   ,,2,,,,
//   ,,,,,3,
//   ,,,,4,,
//   ,5,,,,,
//   ,,,6,,,
// ]);
// console.log(Shading.showRegions(regions, hints));
// const exclusions = Shading.exclusions([...Shading.ROWS, ...Shading.COLS, ...Shading.regionsFromGrid(regions)]);
// const [a, b] = solve(hints, regions, exclusions);
// if (a) console.log(Shading.showRegions(regions, a));  
// if (b) console.log(Shading.showRegions(regions, b));  
// if (!a) {
//   console.log(`No solution`);
// } else if (b) {
//   console.log(`Multiple solutions`);
// } else {
//   console.log(`Unique solution`);
//   process.exit(0);
// }



//console.log(Shading.showRegions(Grid.fromShadings(Shading.BOXES)));




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
export function checkFillomino(shadings: Shading[]): boolean {
  // note: shading may not be fully-connected, in which case
  // this is probably easier?
  const periphery = shadings.map(Shading.peripheryOf);
  const neighbors = shadings.map(Shading.neighborsOf);
  for (let i = 0; i < shadings.length; i++) {
    for (let j = 0; j < i; j++) {
      // we found a cell C from periphery[i] that we could move into j
      // look for a cell from periphery[j+C] in neighbors[i-C]
      for (let x = periphery[i] & neighbors[j]; x;) {
        const rest = x & (x - 1n); const bit = rest ^ x; x = rest;
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
export function computeGivens(geometry: Shading[], sights: Grid): Grid|undefined {
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
    const arr = seq(N + 1, (i) => i < 2 ? undefined : 0n);
    for (let i = 0n; i < N2n; i++) {
      arr[digitMap.get((sights >> (i * Nn)) & DIGIT)] |= (1n << i);
    }
    return arr.flatMap((s, i) => s != null ? [[i, s as Shading, Shading.count(s)] as Sight] : [])
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
    // console.log(`shadings ${sights.length} ${sights[0][0]}`);
    // console.log(Shading.show(shading, {geometry}));
    // console.log(`available`);
    // console.log(Shading.show(available, {geometry, digit: sights[0][0]}));
    // console.log(`intersect`);
    // console.log(Shading.show(x as Shading, {geometry}));
    for (let x = shading & available; x;) {
      const rest = x & (x - 1n); const bit = x ^ rest; x = rest;
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


export function sightGrid(grid: Grid): Grid {
  let shift = 0n;
  let sight = 0n;
  for (let r = 0n; r < N3n; r += N2n) {
    for (let c = 0n; c < N2n; c += Nn) {
      const bit = (grid >> (r + c)) & DIGIT;
      let count = 1n;
      for (let rr = r + N2n; rr < N3n; rr += N2n) {
        if (!(grid & (bit << (rr + c)))) break;
        count++;
      }
      for (let rr = r - N2n; rr >= 0n; rr -= N2n) {
        if (!(grid & (bit << (rr + c)))) break;
        count++;
      }
      for (let cc = c + Nn; cc < N2n; cc += Nn) {
        if (!(grid & (bit << (r + cc)))) break;
        count++;
      }
      for (let cc = c - Nn; cc >= 0n; cc -= Nn) {
        if (!(grid & (bit << (r + cc)))) break;
        count++;
      }
      sight |= 1n << (shift + count - 1n);
      shift += Nn;
    }
  }
  return sight as Grid;
}

// Attempts to solve the grid, should be called after normalize...?
export function* solve(g: Grid, geometry: Grid, exclusions: Map<bigint, Shading>): Generator<Grid> {
  // Look for patterns that can fit, recurse/backtrack
  // console.log(`solve:\n${Shading.showRegions(geometry, g)}`);
  const patterns = Shading.patterns(exclusions);
  const unfilled = Grid.unfilled(g);

  // Filter the set of patterns by digit
  const patsByDigit: Grid[][] = seq(N, () => []);
  for (const p of patterns) {
    for (let d = 0; d < N; d++) {
      const p1 = Grid.fromShading(p) << BigInt(d);
      if ((unfilled & p1) === p1) patsByDigit[d].push(p1 as Grid);
    }
  }

  const exclByDigit: Map<bigint, Grid> = new Map([...exclusions].flatMap(
    ([k, v]) => seq(Nn, d =>
      [(k ** Nn) << d, Grid.fromShading(v) << d] as [bigint, Grid])));
  const exclByPattern: Map<bigint, Grid> = (() => {
    const map = new Map<bigint, Grid>();
    for (const p of patsByDigit.flat()) {
      let e = 0n;
      for (let x: bigint = p; x;) {
        const rest = x & (x - 1n); const bit = x ^ rest; x = rest;
        e |= exclByDigit.get(bit);
      }
      map.set(p, e as Grid);
    }
    return map;
  })();

  const solutions = new Set<Grid>();
  yield* solveInner(unfilled);

  function* solveInner(g: Grid) {
    const n = normalize(g);
    if (!n) return; // { console.log(`failed normalize`); return; }
    g = n;
    const sizes = seq(N).map((i) => Grid.count((g & (Grid.ALL_ONES << BigInt(i))) as Grid));
    // check if we're solved and/or impossible
    if (sizes.every(s => s <= N)) {
      //console.log(`at most 6 of each digit: ${sizes.join(',')}`);
      if (sizes.every(s => s === N)) {
        if (!solutions.has(g)) yield g;
        solutions.add(g);
      }
      return;
    }
    // find the most-constrained number
    let d = -1;
    for (let i = 0; i < N; i++) {
      if (sizes[i] >= sizes[d] || sizes[i] <= N) continue;
      d = i;
    }
    //console.log(`most constrained: ${d}: ${sizes[d]} - ${patsByDigit[d].length} patterns\n${Shading.showRegions(geometry, g)}`);
    
    // look for patterns that constrain it further
    //  - TODO - this is slow, can we make a trie of the patterns?
    //         - find the most constrained _cell_ and look it up in trie?
    //         - guarantee we only look at the 1/9 or 1/81 that actually matter?
    for (const p of patsByDigit[d]) {
      if ((g & p) === p) {
        // console.log(`found allowable pattern:\n${Shading.showRegions(geometry, p)}`);
        const e = exclByPattern.get(p);
        yield* solveInner((g & ~e) as Grid);
      }
    }
  }

  // function exclusion(g: Grid): Grid {
  //   let e = 0n;
  //   for (let x: bigint = g; x;) { 
  //     const rest = x & (x - 1n); const bit = x ^ rest; x = rest;
  //     e |= exclusions.get(bit);
  //   }
  //   return e as Grid;
  // }
  // export function lookup(g: Grid, c: CellAddr): Mask {
  //   return Number((g >> BigInt(c * 9)) & 0x1ffn) as Mask;
  // }

  // Apply exclusions for all fixed numbers.  Iterates to a fixed point.
  function normalize(g: Grid): Grid|undefined {
    //console.log(`normalize\n${Shading.showRegions(geometry, g)}`);
    let out: bigint = g;
    let mask = DIGIT;
    for (let i = 0; i < N2; i++) {
      // const m = lookup(out, i);
      // if (m === 0) return undefined;
      // const v = !(m & (m - 1n)); // isSingular(m)
      // if (v == null) continue;
      // const e = EXCLUSIONS[9 * i + v - 1];
      // out = (out & ~e) as Grid;
      const b = g & mask;
      // console.log(`normalize\n${Shading.showRegions(geometry, mask as Grid)}\n${Shading.showRegions(geometry, b as Grid)}`);
      mask <<= Nn;
      if (!b) return undefined;
      if (b & (b - 1n)) continue; // not a fixed digit.
      const e = exclByDigit.get(b);
      out &= ~e;
    }
    //console.log(`${Grid.show(g)}\nto\n${Grid.show(out)}`);
    return out === g ? out as Grid : normalize(out as Grid);
  }
}
