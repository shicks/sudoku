import { bigints, isSingular } from './util';

// 1 .. size
type CellAddr = number;

// superposition: size*digits bits
type Grid = bigint & {__grid__: never};

type Shading = bigint & {__shading__: never};

// digit superposition for a single cell
type Mask = number & {__mask__: never};

type ArgsOf<F extends Function> =
  F extends (...args: infer A) => any ? A :
  F extends new(...args: infer A) => any ? A : never;

/** Expresses the geometry of a grid, including shadings and exclusions. */
export class Geometry {

  constructor(
    readonly size: number,
    readonly digits: number,
    readonly digitMask: bigint,
    readonly all: Shading,
    readonly shadings: Shading[],
    readonly exclusions: Grid[],
  ) {}

  static forShading<
    G extends Geometry,
    C extends new(...args: ArgsOf<typeof Geometry>) => G,
  >(
    this: C,
    digits: number,
    shadings: Shading[],
  ): G {
    let all: bigint; // NOTE: this is not necessarily accurate
    let size = 0;
    const exclusions: Grid[] = [];
    for (const shading of shadings) {
      if (all == null) all = shading as bigint;
      all |= shading as bigint;
      for (const bit of bigints.bits(shading)) {
        const rest = shading ^ bigints.bit(bit);
        const prev = exclusions[bit] ?? rest;
        exclusions[bit] = (prev | rest) as Grid;
        size = Math.max(size, bit);
      }
    }
    const digitMask = BigInt((1 << digits) - 1);
    return new this(size, digits, digitMask, all as Shading, shadings, exclusions);
  }

  cpl(s: Shading): Shading {
    return (this.all ^ s) as Shading;
  }

  // Looks up an address in the grid
  lookup(g: Grid, c: CellAddr): Mask {
    return Number((g >> BigInt(c * this.digits)) & this.digitMask) as Mask;
  }

  // Apply exclusions for all fixed numbers.  Iterates to a fixed point.
  normalize(g: Grid): Grid|undefined {
    let out = g;
    for (let i = 0; i < this.size; i++) {
      const m = this.lookup(out, i);
      if (m === 0) return undefined;
      const v = isSingular(m);
      if (v == null) continue;
      const e = this.exclusions[9 * i + v - 1];
      out = (out & ~e) as Grid;
    }
    return out === g ? out : this.normalize(out);
  }
}
