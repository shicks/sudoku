// Counts up to 30 bits, using only SMI to hopefully make it _even_ faster
export function count30(i: bigint|number): number {
  let j = Number(i);
  j -= (j >>> 1) & 0x15555555;
  j = (j & 0x13333333) + ((j >>> 2) & 0x13333333);
  j = (j + (j >>> 4)) & 0x0f0f0f0f;
  return (j * 0x01010101) >>> 24;
}

// Counts bits up to 32, using just number since it's hopefully faster
export function count32(i: bigint|number): number {
  let j = Number(i);
  j -= (j >>> 1) & 0x55555555;
  j = (j & 0x33333333) + ((j >>> 2) & 0x33333333);
  j = (j + (j >>> 4)) & 0x0f0f0f0f;
  return (j * 0x01010101) >>> 24;
}

// NOTE: we can safely use number for up to 52 bits
export function count52(i: number): number {
  return count30(Math.floor(i / 0x1000000)) + count30(i % 0x1000000);
}

// Counts bits up to 64
export function count64(i: bigint): number {
  i -= (i >> 1n) & 0x5555555555555555n;
  i = (i & 0x3333333333333333n) +
      ((i >> 2n) & 0x3333333333333333n);
  i = (i + (i >> 4n)) & 0x0f0f0f0f0f0f0f0fn;
  return Number(((i * 0x0101010101010101n) >> 56n) & 0xffn);
}

// Counts bits up to 128
export function count128(i: bigint): number {
  i -= (i >> 1n) & 0x55555555555555555555555555555555n;
  i = (i & 0x33333333333333333333333333333333n) +
      ((i >> 2n) & 0x33333333333333333333333333333333n);
  i = (i + (i >> 4n)) & 0x0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0fn;
  return Number(((i * 0x01010101010101010101010101010101n) >> 120n) & 0xffn);
}

// TODO - do we want any intermediate versions?

// Counts bits up to 1024
export const count1024: (b: bigint) => number = (() => {
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

  return function count(i: bigint): number {
    i -= (i >> 1n) & a;
    i = (i & b) + ((i >> 2n) & b);
    i = (i + (i >> 4n)) & c;
    i = (i + (i >> 8n)) & d; // 0..16 every 16 bits, 
    i = (i + (i >> 384n)) & f384;
    i = (i + (i >> 128n) + (i >> 256n)) & f128;
    return Number(((i * e) >> 112n) & 0xffffn);
  };
})();

export function countFor(bits: number): (b: bigint) => number {
  if (bits < 30) return count30;
  if (bits < 32) return count32;
  if (bits < 64) return count64;
  if (bits < 128) return count128;
  return count1024;
}

interface Bitmap<T extends number|bigint> {
  ctor(arg: number|bigint): T;
  bit(n: number): T;
  bits(s: T): number[];
  has(s: T, b: number): boolean;
}

export const bigints: Bitmap<bigint> = {
  ctor: BigInt,
  bit(n: number): bigint {
    return 1n << BigInt(n);
  },
  has(s: bigint, b: number): boolean {
    return Boolean(s & (1n << BigInt(b)));
  },
  bits(s: bigint): number[] {
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
  },
};

export const nums32: Bitmap<number> = {
  ctor: Number,
  bit(n: number): number {
    return 1 << n;
  },
  has(s: number, b: number): boolean {
    return Boolean(s & (1 << b));
  },
  bits(s: number): number[] {
    const out = [];
    let y = 0;
    while (s) {
      const z = 32 - Math.clz32(s ^ (s - 1));
      out.push((y += z) - 1);
      if (z === 32) break;
      s >>>= z;
    }
    return out;
  },
}

// NOTE: we need special handling to support 33..52 bits
export const nums52: Bitmap<number> = {
  ctor: Number,
  bit(n: number): number {
    return 2 ** n;
  },
  has(s: number, b: number): boolean {
    return Boolean((s / 2 ** b) & 1);
  },
  bits(s: number): number[] {
    const out = [];
    while (s >= 1) {
      const z = Math.log2(s);
      out.push(z);
      s -= 2 ** z;
    }
    return out; // TODO - reverse?
  },
}

export function isSingular(b: number|bigint): number|undefined {
  if (typeof b === 'bigint') {
    if (b & (b - 1n)) return undefined;
    return b.toString(2).length - 1;
  }
  const z = 31 - Math.clz32(b);
  return b === 1 << z ? z + 1 : undefined;
}
