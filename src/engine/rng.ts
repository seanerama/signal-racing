/**
 * Seeded PRNG (contract 01): sfc32 with labelled stream splitting and Box–Muller normals.
 * Pure: no `Math.random`, no globals. The same seed and fork labels always give the same
 * sequences, regardless of how many values the parent has already drawn.
 */

export interface Rng {
  /** Uniform in [0, 1). */
  next(): number;
  /** Standard normal (mean 0, σ 1), Box–Muller. */
  normal(): number;
  /**
   * A stable, independent child stream derived from this stream's seed and `label`
   * (not from its current position), e.g. `fork('noise:speed')`.
   */
  fork(label: string): Rng;
}

const TWO_POW_32 = 4294967296;

/** cyrb53 string hash, folded to 32 bits. `seed` mixes in the parent stream's key. */
function hash32(str: string, seed: number): number {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (h1 ^ h2) >>> 0;
}

/** splitmix32 step: expands one 32-bit key into well-mixed state words. */
function splitmix32(state: { x: number }): number {
  state.x = (state.x + 0x9e3779b9) >>> 0;
  let z = state.x;
  z = Math.imul(z ^ (z >>> 16), 0x85ebca6b);
  z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35);
  return (z ^ (z >>> 16)) >>> 0;
}

/** Number of discarded sfc32 outputs after seeding. */
const WARMUP = 12;

function makeRng(key: number): Rng {
  const sm = { x: key >>> 0 };
  let a = splitmix32(sm);
  let b = splitmix32(sm);
  let c = splitmix32(sm);
  let d = splitmix32(sm);

  /** sfc32 core: one uint32 output. */
  const nextU32 = (): number => {
    const t = (((a + b) >>> 0) + d) >>> 0;
    d = (d + 1) >>> 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) >>> 0;
    c = (c << 21) | (c >>> 11);
    c = (c + t) >>> 0;
    return t;
  };
  for (let i = 0; i < WARMUP; i++) nextU32();

  let spare: number | null = null;

  const next = (): number => nextU32() / TWO_POW_32;

  return {
    next,
    normal(): number {
      if (spare !== null) {
        const v = spare;
        spare = null;
        return v;
      }
      // u1 in (0, 1] so log(u1) is finite.
      const u1 = 1 - next();
      const u2 = next();
      const r = Math.sqrt(-2 * Math.log(u1));
      const theta = 2 * Math.PI * u2;
      spare = r * Math.sin(theta);
      return r * Math.cos(theta);
    },
    fork(label: string): Rng {
      return makeRng(hash32(label, key));
    },
  };
}

/** Creates a stream from a uint32 seed (non-integers are truncated to uint32). */
export function createRng(seed: number): Rng {
  return makeRng(seed >>> 0);
}
