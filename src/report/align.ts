/**
 * Aligning one run onto another's x axis.
 *
 * uPlot needs one shared x array per chart, but the best run has a different `n`. Each strip
 * therefore resamples the best run onto the current run's x (`t` in time mode, `s` in distance
 * mode) by linear interpolation. Dropouts stay gaps: a NaN neighbour gives NaN, and so does any
 * x outside the source range (no extrapolation).
 */

type NumArray = ArrayLike<number>;

/**
 * Index of the last element of the ascending array `xs` that is ≤ `x`, or -1 if `x < xs[0]`
 * (and -1 for an empty array). Binary search.
 */
export function indexAtOrBefore(xs: NumArray, x: number): number {
  let lo = 0;
  let hi = xs.length - 1;
  if (hi < 0 || !(x >= (xs[0] as number))) return -1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if ((xs[mid] as number) <= x) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/** Index of the sample in ascending `xs` nearest to `x`, clamped to the array. -1 if empty. */
export function nearestIndex(xs: NumArray, x: number): number {
  const n = xs.length;
  if (n === 0) return -1;
  const i = indexAtOrBefore(xs, x);
  if (i < 0) return 0;
  if (i >= n - 1) return n - 1;
  const a = xs[i] as number;
  const b = xs[i + 1] as number;
  return x - a <= b - x ? i : i + 1;
}

/** Linear interpolation of `ys(xs)` at `x`. NaN outside the range or next to a dropout. */
export function interpAt(xs: NumArray, ys: NumArray, x: number): number {
  const n = Math.min(xs.length, ys.length);
  if (n === 0 || Number.isNaN(x)) return NaN;
  const i = indexAtOrBefore(xs, x);
  if (i < 0) return NaN;
  const x0 = xs[i] as number;
  const y0 = ys[i] as number;
  if (x === x0) return y0;
  if (i >= n - 1) return NaN;
  const x1 = xs[i + 1] as number;
  const y1 = ys[i + 1] as number;
  if (Number.isNaN(y0) || Number.isNaN(y1)) return NaN;
  if (x1 === x0) return y0;
  return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
}

/**
 * Resamples `srcY(srcX)` onto `dstX`. Both x arrays must be ascending (time and distance are,
 * within a run). Linear-time merge walk rather than one binary search per sample.
 */
export function resampleOnto(srcX: NumArray, srcY: NumArray, dstX: NumArray): Float64Array {
  const out = new Float64Array(dstX.length);
  const n = Math.min(srcX.length, srcY.length);
  let j = 0;
  for (let i = 0; i < dstX.length; i++) {
    const x = dstX[i] as number;
    if (n === 0 || Number.isNaN(x) || x < (srcX[0] as number) || x > (srcX[n - 1] as number)) {
      out[i] = NaN;
      continue;
    }
    while (j < n - 2 && (srcX[j + 1] as number) <= x) j++;
    const x0 = srcX[j] as number;
    const y0 = srcY[j] as number;
    if (x === x0) {
      out[i] = y0;
      continue;
    }
    const x1 = srcX[j + 1] as number;
    const y1 = srcY[j + 1] as number;
    if (x === x1) {
      out[i] = y1;
      continue;
    }
    out[i] =
      Number.isNaN(y0) || Number.isNaN(y1) || x1 === x0
        ? NaN
        : y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
  }
  return out;
}
