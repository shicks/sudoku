// Tooling for Permudoku

type Grid = Digit[] & {_grid_: never};
type Mask = number[] & {_mask_: never};
type Digit = number & {_digit_: never};

const digits: Digit[] = [];
for (let i = 0; i < 16; i++) {
  digits.push((1 << (i & 3) | 0x10 << (i >> 2)) as Digit);
}

const masks = [
  [ 0,  1,  2,  3], // row 1
  [ 4,  5,  6,  7], // row 2
  [ 8,  9, 10, 11], // row 3
  [12, 13, 14, 15], // row 4

  [ 0,  4,  8, 12], // col 1
  [ 1,  5,  9, 13], // col 2
  [ 2,  6, 10, 14], // col 3
  [ 3,  7, 11, 15], // col 4

  [ 0,  1,  4,  5], // box 1
  [ 2,  3,  6,  7], // box 2
  [ 8,  9, 12, 13], // box 3
  [10, 11, 14, 15], // box 4

  [ 0,  5, 10, 15], // diag 1 \
  [ 3,  6,  9, 12], // diag 2 /
  [ 5,  6,  9, 10], // center
] as Mask[];

function check(grid: Grid) {
  for (const mask of masks) {
    let check = 0;
    for (const i of mask) {
      if (check & grid[i]) return false; // `same digit on ${mask}: ${toBin(check & grid[i])}`;
      check |= grid[i];
    }
    if (check !== 0xff) return false; // `missing digit on ${mask}: ${toBin(check)}`;
  }
  return true; // 'OK';
}

function toBin(x: number) {
  return x.toString(2).padStart(8, '0');
}

const permutations = `
  0123
  0132
  0213
  0231
  0312
  0321
  1023
  1032
  1203
  1230
  1302
  1320
  2013
  2031
  2103
  2130
  2301
  2310
  3012
  3021
  3102
  3120
  3201
  3210
`.split(/\n/g).map(x => x.trim()).filter(x => x).map(x => [...x].map(x => 1 << Number(x))) as number[][];

function* solutions() {
  for (const [a1, b1, c1, d1] of permutations.map(x => x.map(y => y << 4))) {
    for (const [a2, b2, c2, d2] of permutations) {
      yield [
        a1|a2, b1|b2, c1|d2, d1|c2,
        c1|c2, d1|d2, a1|b2, b1|a2,
        d1|b2, c1|a2, b1|c2, a1|d2,
        b1|d2, a1|c2, d1|a2, c1|b2,
      ] as Grid;
      yield [
        a1|a2, b1|b2, d1|c2, c1|d2,
        c1|c2, d1|d2, b1|a2, a1|b2,
        b1|d2, a1|c2, c1|b2, d1|a2,
        d1|b2, c1|a2, a1|d2, b1|c2,
      ] as Grid;
    }
  }
}

const knight: [number, number][] = [
  [0, 6],
  [1, 7],
  [4, 10],
  [5, 11],
  [8, 14],
  [9, 15],
  [0, 9],
  [1, 10],
  [2, 11],
  [4, 13],
  [5, 14],
  [6, 15],
  [2, 4],
  [3, 5],
  [6, 8],
  [7, 9],
  [10, 12],
  [11, 13],
  [1, 8],
  [2, 9],
  [3, 10],
  [5, 12],
  [6, 13],
  [7, 14],
];
const ortho: [number, number][] = [
  [0, 1],
  [1, 2],
  [2, 3],
  [4, 5],
  [5, 6],
  [6, 7],
  [8, 9],
  [9, 10],
  [10, 11],
  [12, 13],
  [13, 14],
  [14, 15],
  [0, 4],
  [1, 5],
  [2, 6],
  [3, 7],
  [4, 8],
  [5, 9],
  [6, 10],
  [7, 11],
  [8, 12],
  [9, 13],
  [10, 14],
  [11, 15],
];
const diag: [number, number][] = [
  [0, 5],
  [1, 6],
  [2, 7],
  [4, 9],
  [5, 10],
  [6, 11],
  [8, 13],
  [9, 14],
  [10, 15],
  [1, 4],
  [2, 5],
  [3, 6],
  [5, 8],
  [6, 9],
  [7, 10],
  [9, 12],
  [10, 13],
  [11, 14],
];

let maxMin = 0;
let minMax = 16;

function minmax(s: Grid, links: [number, number][]) {
  let min = 16;
  let max = 0;
  for (const [a, b] of links) {
    const na = digits.indexOf(s[a]);
    const nb = digits.indexOf(s[b]);
    min = Math.min(min, Math.abs(na - nb));
    max = Math.max(max, Math.abs(na - nb));
  }
  maxMin = Math.max(min, maxMin);
  minMax = Math.min(max, minMax);
  return `min ${min}, max ${max}`;
}

function show(s: Grid, bin = false) {
  const digit = bin ?
    (x: number) => ' ' + x.toString(2).padStart(8, '0') :
    (x: number) => String(digits.indexOf(x as Digit)).padStart(3, ' ');
  return [0, 4, 8, 12].map(r => s.slice(r, r + 4).map(digit).join('')).join('\n');
}

function permute(g: Grid): Grid {
  return g.map((x) => g[digits.indexOf(x)]) as Grid;
}

function order(g: Grid) {
  let order = 0;
  let i = 0x11 as Digit;
  do {
    order++;
    i = g[digits.indexOf(i)];
  } while (i !== 0x11);
  return order;
}

for (const s of solutions()) {
  console.log(`${show(s)}
knight: ${minmax(s, knight)}
ortho:  ${minmax(s, ortho)}
diag:   ${minmax(s, diag)}`);
  //if (order(s) === 16) console.log(show(s), '\n', order(s));
  //xif (check(permute(s))) console.log(show(s));
}

console.log(`---\nmin: ${maxMin}, max: ${minMax}`);
