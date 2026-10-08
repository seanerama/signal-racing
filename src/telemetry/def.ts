/**
 * Registry-internal channel definition: a contract-03 `ChannelDef` plus the nominal SI range the
 * noise layer scales against (`sigma = sigmaFrac × (hi − lo)`) and an optional quantisation step
 * for digital channels (gear, status bits). Consumers only ever see `ChannelDef`; the extra fields
 * are reachable through `channelRange()` / `channelQuantum()` in `registry.ts`.
 */
import type { ChannelDef } from './types';

export interface RegisteredChannel extends ChannelDef {
  /** Nominal SI range `[lo, hi]` of the sensor. Drives the noise amplitude and is a sane axis default. */
  readonly range: readonly [number, number];
  /** Quantisation step applied after noise (digital channels), in SI. Absent for analogue channels. */
  readonly quantum?: number;
}

/** Default sensor noise: 1.5% of range, 1 dropout per 1000 samples. */
export const DEFAULT_NOISE: ChannelDef['noise'] = { sigmaFrac: 0.015, dropoutRate: 0.001 };

/** No noise and no dropouts (track-view position channels, logger math channels). */
export const NO_NOISE: ChannelDef['noise'] = { sigmaFrac: 0, dropoutRate: 0 };
