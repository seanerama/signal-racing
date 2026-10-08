/** Typed engine errors (contract 02). The worker reconstructs them by `name` across the RPC boundary. */

/** The input is malformed or a lever is out of range. `field` is a dotted path, e.g. `setup.wing`. */
export class SimInputError extends Error {
  readonly field: string;
  constructor(field: string, message: string) {
    super(`${field}: ${message}`);
    this.name = 'SimInputError';
    this.field = field;
  }
}

/** The integrator produced NaN or Infinity. Never return silently clamped garbage. */
export class SimDivergedError extends Error {
  readonly step: number;
  readonly state: Record<string, number>;
  constructor(step: number, state: Record<string, number>) {
    super(`simulation diverged at step ${step}`);
    this.name = 'SimDivergedError';
    this.step = step;
    this.state = state;
  }
}
