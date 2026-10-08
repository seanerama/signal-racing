/**
 * Display-only smoothing for a strip (Stage 9, gutter menu "Smooth (5-pt centred mean)").
 *
 * `y[i]` = the mean of the finite samples in `x[i−2 … i+2]`, the window clipped at the ends of the
 * run (so the first and last samples average 3 and 4 points). A dropout (NaN) never enters a mean,
 * and a dropout sample stays a gap: smoothing never invents a reading where the sensor gave none.
 *
 * It changes what a strip draws and its readout (marked `~`), never the data: the channel table,
 * the CSV, hint rules and the assist read the raw run.
 */

/** Half-width of the window: 2 → five points. */
export const SMOOTH_HALF = 2;

export function smooth5(x: ArrayLike<number>): Float64Array {
  const n = x.length;
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const c = x[i] as number;
    if (!Number.isFinite(c)) {
      out[i] = NaN;
      continue;
    }
    let sum = 0;
    let k = 0;
    const lo = Math.max(0, i - SMOOTH_HALF);
    const hi = Math.min(n - 1, i + SMOOTH_HALF);
    for (let j = lo; j <= hi; j++) {
      const v = x[j] as number;
      if (Number.isFinite(v)) {
        sum += v;
        k++;
      }
    }
    out[i] = sum / k;
  }
  return out;
}
