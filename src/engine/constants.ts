/** Physical and numerical constants (contract 02 "Constants" and fixed model coefficients). */

/** kg/m³, air density. */
export const RHO = 1.225;
/** m/s², gravity. */
export const G = 9.81;
/** s, integration timestep (100 Hz logging). */
export const DT = 0.01;
/** s, maximum simulated time; beyond it the run is unfinished (`totalTime = Infinity`). */
export const MAX_TIME = 300;
/** m, distance step of the backward braking-envelope pass. */
export const ENVELOPE_DS = 0.25;
/** m/s, speed floor in `P / max(v, V_ENGINE_MIN)` (row 10). */
export const V_ENGINE_MIN = 0.5;
/** m/s, below this while braking in a stop segment the car is stopped (snap to 0). */
export const STOP_SPEED = 0.05;
/** m/s, tolerance of the corner limit speed bisection (row 21). */
export const CORNER_TOL = 0.01;
/** m/s, upper bracket of the corner limit speed bisection. */
export const CORNER_V_MAX = 200;
/** Tire heating coefficient (row 15). */
export const K_HEAT = 0.9;
/** 1/s, tire cooling coefficient (row 15). */
export const K_COOL = 0.02;
/** Heat-in multiplier while the axle is sliding (row 15). */
export const SLIDE_HEAT_MULT = 4;
/** Brake heating coefficient (row 16). */
export const K_BRAKE = 2e-6;
/** 1/s, brake cooling coefficient (row 16). */
export const K_BRAKE_COOL = 0.05;
/** Number of gears (row 17). */
export const GEARS = 6;
/** m/s of speed per gear band (row 17). */
export const GEAR_BAND = 15;
/** rpm at the bottom of each gear band (row 17). */
export const RPM_BASE = 4000;
/** rpm span of one gear band (row 17). */
export const RPM_SPAN = 8000;
/** Envelope speed used where no target constrains the car (m/s, effectively unbounded). */
export const V_UNBOUNDED = 1e6;
