/** Public engine API (contract 02). Pure: no I/O, no globals, no `Date`, no `Math.random`. */
export { simulate, createSimCache, type SimCache } from './simulate';
export { DEFAULT_CAR } from './car';
export { validateInput, LEVER_RANGES } from './validate';
export { trackGeometry, poseAt, trackLayout } from './track';
export { cornerLimitSpeed } from './corner';
export { SimInputError, SimDivergedError } from './errors';
export { PHYSICAL_CHANNELS, type PhysicalChannelMeta } from './channels';
export { brakingEnvelope } from './driver';
export { DT, MAX_TIME, G, RHO } from './constants';
export type * from './types';
