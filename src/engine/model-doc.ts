/**
 * The model, documented from code (Stage 9, Model & sources page). Kept next to the physics so the
 * page cannot drift: every equation entry names the engine function that implements it (`impl`)
 * and the module that exports it, and `tests/engine/model-doc.test.ts` checks each one is a
 * function exported by that module. The car table is read from `DEFAULT_CAR`.
 *
 * Each equation is one line: a MathML rendering (native, no dependency), a plain-text twin (the
 * fallback, and what screen readers and copy/paste get) and one sentence. Pure data; no DOM.
 */
import { DEFAULT_CAR } from './car';
import { K_BRAKE, K_BRAKE_COOL, K_COOL, K_HEAT, SLIDE_HEAT_MULT } from './constants';
import type { CarParams, Quantity } from './types';

// ---- MathML builders (strings; the page renders them as markup authored here, never input) ----
/** Escapes text for markup (`<`, `>`, `&`). */
const esc = (x: string | number): string =>
  String(x).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const mi = (x: string): string => `<mi>${esc(x)}</mi>`;
const mn = (x: string | number): string => `<mn>${esc(x)}</mn>`;
const mo = (x: string): string => `<mo>${esc(x)}</mo>`;
const row = (...xs: string[]): string => `<mrow>${xs.join('')}</mrow>`;
const sub = (a: string, b: string): string => `<msub>${a}${b}</msub>`;
const sup = (a: string, b: string): string => {
  // x_i² reads better as one msubsup than a superscript on a subscripted base.
  const m = /^<msub>(.*)<\/msub>$/.exec(a);
  return m ? `<msubsup>${m[1]}${b}</msubsup>` : `<msup>${a}${b}</msup>`;
};
const frac = (a: string, b: string): string => `<mfrac>${row(a)}${row(b)}</mfrac>`;
const sqrt = (...xs: string[]): string => `<msqrt>${xs.join('')}</msqrt>`;
const paren = (...xs: string[]): string => row(mo('('), ...xs, mo(')'));
/** Text; spaces become no-break spaces, since MathML trims edge whitespace in `<mtext>`. */
const txt = (x: string): string => `<mtext>${esc(x).replace(/ /g, '\u00a0')}</mtext>`;
/** `F` with a text subscript, e.g. F_drag. */
const F = (s: string): string => sub(mi('F'), txt(s));
const half = frac(mn(1), mn(2));
const rho = mi('ρ');
const v2 = sup(mi('v'), mn(2));
const eq = mo('=');
const times = mo('·');
const math = (...xs: string[]): string =>
  `<math xmlns="http://www.w3.org/1998/Math/MathML" display="inline" displaystyle="true">${row(...xs)}</math>`;

export interface ModelEquation {
  /** Stable id, e.g. `aero-coeffs`. */
  id: string;
  /** Contract 02 row(s). */
  row: string;
  title: string;
  /** MathML markup (`<math>…</math>`). */
  mathml: string;
  /** Plain-text twin of the formula. */
  plain: string;
  /** One sentence. */
  note: string;
  /**
   * Names of the engine function(s) that implement it, exported by `module` (checked by test).
   * Names, not references, so the page does not pull the integrator into the main thread.
   */
  impl: readonly string[];
  /** The engine module that exports `impl`. */
  module: 'physics' | 'corner' | 'simulate';
}

export const MODEL_EQUATIONS: readonly ModelEquation[] = Object.freeze([
  {
    id: 'aero-coeffs',
    row: '1',
    title: 'Aero coefficients',
    mathml: math(
      sub(mi('C'), mi('d')),
      mi('A'),
      eq,
      sub(mi('C'), txt('d0')),
      mi('A'),
      mo('+'),
      sub(mi('k'), txt('d')),
      mi('A'),
      times,
      sup(mi('w'), mn(2)),
      mo(','),
      mspace(),
      sub(mi('C'), mi('l')),
      mi('A'),
      eq,
      sub(mi('C'), txt('l0')),
      mi('A'),
      mo('+'),
      sub(mi('k'), txt('l')),
      mi('A'),
      times,
      mi('w'),
    ),
    plain: 'CdA = Cd0A + kdA·w²,  ClA = Cl0A + klA·w',
    note: 'The wing position w buys downforce linearly and costs drag quadratically.',
    impl: ['aeroCoeffs'],
    module: 'physics',
  },
  {
    id: 'drag-downforce',
    row: '2',
    title: 'Drag and downforce',
    mathml: math(
      F('drag'),
      eq,
      half,
      rho,
      sub(mi('C'), mi('d')),
      mi('A'),
      v2,
      mo(','),
      mspace(),
      F('down'),
      eq,
      half,
      rho,
      sub(mi('C'), mi('l')),
      mi('A'),
      v2,
    ),
    plain: 'F_drag = ½ρ·CdA·v²,  F_down = ½ρ·ClA·v²',
    note: 'Both grow with the square of speed, which is why the wing matters more on fast corners and costs more on long straights.',
    impl: ['dragForce', 'downforce'],
    module: 'physics',
  },
  {
    id: 'static-loads',
    row: '3',
    title: 'Static axle loads',
    mathml: math(
      sub(mi('N'), mi('f')),
      eq,
      paren(mn(1), mo('−'), mi('d')),
      mi('m'),
      mi('g'),
      mo('+'),
      paren(mn(1), mo('−'), mi('b')),
      F('down'),
      mo(','),
      mspace(),
      sub(mi('N'), mi('r')),
      eq,
      mi('d'),
      mi('m'),
      mi('g'),
      mo('+'),
      mi('b'),
      F('down'),
    ),
    plain: 'N_f = (1−d)·m·g + (1−b)·F_down,  N_r = d·m·g + b·F_down',
    note: 'Weight splits by the rear weight fraction d, downforce by the aero balance b.',
    impl: ['staticLoads'],
    module: 'physics',
  },
  {
    id: 'long-transfer',
    row: '4',
    title: 'Longitudinal load transfer',
    mathml: math(mi('Δ'), mi('N'), eq, frac(row(mi('m'), sub(mi('a'), mi('x')), mi('h')), mi('L'))),
    plain: 'ΔN = m·a_x·h/L  (to the rear under acceleration, to the front under braking)',
    note: 'Accelerating moves load onto the driven rear axle; braking moves it onto the front, using the previous step’s acceleration.',
    impl: ['transferLoads'],
    module: 'physics',
  },
  {
    id: 'pressure-factor',
    row: '5',
    title: 'Pressure factor',
    mathml: math(
      sub(mi('μ'), mi('p')),
      eq,
      sup(
        mi('e'),
        row(
          mo('−'),
          sup(
            paren(frac(row(mi('p'), mo('−'), sub(mi('p'), txt('opt'))), sub(mi('σ'), mi('p')))),
            mn(2),
          ),
        ),
      ),
    ),
    plain: 'μ_p = exp(−((p − p_opt)/σ_p)²)',
    note: 'Grip peaks at the optimal pressure and falls away on a bell either side.',
    impl: ['pressureFactor'],
    module: 'physics',
  },
  {
    id: 'temp-factor',
    row: '6',
    title: 'Temperature factor (off in this build)',
    mathml: math(
      sub(mi('μ'), mi('T')),
      eq,
      sup(
        mi('e'),
        row(
          mo('−'),
          sup(
            paren(frac(row(mi('T'), mo('−'), sub(mi('T'), txt('opt'))), sub(mi('σ'), mi('T')))),
            mn(2),
          ),
        ),
      ),
    ),
    plain: 'μ_T = exp(−((T − T_opt)/σ_T)²)',
    note: 'Implemented but switched off on every level: tire temperature is a channel here, not a grip effect.',
    impl: ['tempFactor'],
    module: 'physics',
  },
  {
    id: 'tire-mu',
    row: '7',
    title: 'Load-sensitive friction',
    mathml: math(
      sub(mi('μ'), mi('i')),
      eq,
      sub(mi('μ'), txt('peak')),
      sub(mi('μ'), mi('p')),
      sub(mi('μ'), mi('T')),
      mi('G'),
      paren(
        mn(1),
        mo('−'),
        sub(mi('k'), mi('s')),
        frac(
          row(sub(mi('N'), mi('i')), mo('−'), sub(mi('N'), txt('ref'))),
          sub(mi('N'), txt('ref')),
        ),
      ),
    ),
    plain: 'μ_i = μ_peak·μ_p·μ_T·G·(1 − k_s·(N_i − N_ref)/N_ref),  N_ref = m·g/4',
    note: 'A more heavily loaded tire grips a little less per newton of load, so load transfer always costs some total grip.',
    impl: ['tireMu'],
    module: 'physics',
  },
  {
    id: 'axle-budget',
    row: '8',
    title: 'Axle grip budget',
    mathml: math(
      sub(mi('F'), txt('max')),
      eq,
      row(mo('∑'), sub(mi('μ'), mi('i')), sub(mi('N'), mi('i'))),
    ),
    plain: 'F_max,axle = Σ μ_i·N_i',
    note: 'The most force an axle’s two tires can deliver in any direction; the grip circle’s radius.',
    impl: ['axleBudget'],
    module: 'physics',
  },
  {
    id: 'throttle',
    row: '9',
    title: 'Throttle ramp (driver)',
    mathml: math(
      mi('θ'),
      eq,
      txt('min'),
      paren(mn(1), mo(','), frac(mi('t'), sub(mi('t'), txt('ramp')))),
    ),
    plain: 'θ(t) = min(1, t/t_ramp)  (1 if t_ramp = 0; 0 while braking)',
    note: 'The player’s ramp lever sets how fast the driver squeezes the throttle from a standing start.',
    impl: ['throttle'],
    module: 'physics',
  },
  {
    id: 'engine-force',
    row: '10',
    title: 'Engine force',
    mathml: math(
      F('eng'),
      eq,
      mi('θ'),
      times,
      txt('min'),
      paren(
        sub(mi('F'), txt('peak')),
        mo(','),
        frac(mi('P'), row(txt('max'), paren(mi('v'), mo(','), mn('0.5')))),
      ),
    ),
    plain: 'F_eng = θ·min(F_peak, P/max(v, 0.5))',
    note: 'Force-limited at low speed and power-limited above it, delivered at the rear wheels.',
    impl: ['engineForce'],
    module: 'physics',
  },
  {
    id: 'brake-demand',
    row: '11',
    title: 'Brake demand',
    mathml: math(
      F('bf'),
      eq,
      mi('β'),
      sub(mi('F'), txt('brk')),
      sub(mi('b'), txt('f')),
      mo(','),
      mspace(),
      F('br'),
      eq,
      mi('β'),
      sub(mi('F'), txt('brk')),
      paren(mn(1), mo('−'), sub(mi('b'), txt('f'))),
    ),
    plain: 'F_bf = β·F_brk·b_f,  F_br = β·F_brk·(1 − b_f),  β ∈ {0, 1}',
    note: 'The driver brakes at full pedal with a fixed 70/30 front bias.',
    impl: ['brakeDemand'],
    module: 'physics',
  },
  {
    id: 'tire-force',
    row: '12',
    title: 'Tire force and slip',
    mathml: math(
      mi('r'),
      eq,
      frac(sub(mi('F'), txt('demand')), sub(mi('F'), txt('max'))),
      mo(';'),
      mspace(),
      mi('F'),
      eq,
      txt('r ≤ 1 ? '),
      sub(mi('F'), txt('demand')),
      txt(' : slideFactor·'),
      sub(mi('F'), txt('max')),
    ),
    plain: 'r = F_demand/F_max;  F = F_demand if r ≤ 1, else slideFactor·F_max;  slip = s_peak·r',
    note: 'Ask for more than the budget and the tire slides, delivering less force than it could have.',
    impl: ['tireForce'],
    module: 'physics',
  },
  {
    id: 'slide-hysteresis',
    row: '12b',
    title: 'Slide hysteresis',
    mathml: math(
      txt('sliding: on when '),
      mi('r'),
      mo('>'),
      mn(1),
      txt(', off when '),
      mi('r'),
      mo('<'),
      sub(mi('k'), txt('regrip')),
      txt(' or the demand changes mode'),
    ),
    plain:
      'sliding starts at r > 1 and ends at r < k_regrip (0.85), at no demand, or on a drive↔brake switch',
    note: 'A sliding tire does not regrip the moment demand dips under the budget; the driver has to lift, which is why a stab of throttle costs time.',
    impl: ['tireForce'],
    module: 'physics',
  },
  {
    id: 'long-ode',
    row: '13',
    title: 'Longitudinal motion',
    mathml: math(
      mi('m'),
      frac(row(mi('d'), mi('v')), row(mi('d'), mi('t'))),
      eq,
      sub(mi('F'), txt('x,r')),
      mo('−'),
      F('brake'),
      mo('−'),
      F('drag'),
      mo('−'),
      F('roll'),
    ),
    plain:
      'm·dv/dt = F_x,rear − F_brake − F_drag − F_roll  (semi-implicit Euler, dt = 10 ms, v ≥ 0)',
    note: 'One equation of motion along the path, stepped at the 100 Hz logging rate.',
    impl: ['simulate'],
    module: 'simulate',
  },
  {
    id: 'rolling',
    // The last term of row 13's equation of motion, documented on its own line (was a second
    // "13" on the Model page).
    row: '13a',
    title: 'Rolling resistance',
    mathml: math(F('roll'), eq, sub(mi('c'), txt('rr')), times, mi('m'), times, mi('g')),
    plain: 'F_roll = crr·m·g',
    note: 'A small constant drag from the tires deforming as they roll.',
    impl: ['rollingForce'],
    module: 'physics',
  },
  {
    id: 'wheel-speeds',
    row: '14',
    title: 'Wheel speeds',
    mathml: math(sub(mi('v'), txt('wheel')), eq, mi('v'), paren(mn(1), mo('±'), txt('slip'))),
    plain: 'v_wheel = v·(1 + slip) driven rear under drive;  v·(1 − slip) under braking;  else v',
    note: 'Wheelspin shows as a wheel faster than the car, a lock as one slower.',
    impl: ['simulate'],
    module: 'simulate',
  },
  {
    id: 'tire-temp',
    row: '15',
    title: 'Tire temperature',
    mathml: math(
      frac(row(mi('d'), mi('T')), row(mi('d'), mi('t'))),
      eq,
      sub(mi('k'), txt('heat')),
      sup(paren(frac(sub(mi('F'), txt('used')), sub(mi('F'), txt('max')))), mn(2)),
      mi('v'),
      mo('−'),
      sub(mi('k'), txt('cool')),
      paren(mi('T'), mo('−'), sub(mi('T'), txt('track'))),
    ),
    plain: `dT/dt = kHeat·(F_used/F_max)²·v − kCool·(T − T_track),  kHeat = ${K_HEAT}, kCool = ${K_COOL}, ×${SLIDE_HEAT_MULT} while sliding`,
    note: 'Work through the tire heats it and the air cools it; sliding heats it faster.',
    impl: ['tireTempRate'],
    module: 'physics',
  },
  {
    id: 'brake-temp',
    row: '16',
    title: 'Brake temperature',
    mathml: math(
      frac(row(mi('d'), mi('T')), row(mi('d'), mi('t'))),
      eq,
      sub(mi('k'), txt('brake')),
      F('brake'),
      mi('v'),
      mo('−'),
      sub(mi('k'), txt('bcool')),
      paren(mi('T'), mo('−'), sub(mi('T'), txt('amb'))),
    ),
    plain: `dT/dt = kBrake·F_brake·v − kBrakeCool·(T − T_amb),  kBrake = ${K_BRAKE}, kBrakeCool = ${K_BRAKE_COOL}`,
    note: 'Braking power heats the discs; they cool toward ambient.',
    impl: ['brakeTempRate'],
    module: 'physics',
  },
  {
    id: 'gear-rpm',
    row: '17',
    title: 'Gear and engine speed (display only)',
    mathml: math(
      txt('gear'),
      eq,
      mn(1),
      mo('+'),
      txt('floor'),
      paren(txt('min'), paren(mn(5), mo(','), frac(mi('v'), mn(15)))),
    ),
    plain: 'gear = 1 + floor(min(5, v/15));  rpm = 4000 + (v − 15·(gear−1))/15·8000',
    note: 'A plausible sawtooth for the rpm and gear channels; it has no effect on the physics.',
    impl: ['gearRpm'],
    module: 'physics',
  },
  {
    id: 'lateral-demand',
    row: '18',
    title: 'Lateral demand',
    mathml: math(
      sub(mi('a'), mi('y')),
      eq,
      frac(v2, mi('R')),
      mo(','),
      mspace(),
      sub(mi('F'), txt('y,f')),
      eq,
      mi('m'),
      sub(mi('a'), mi('y')),
      paren(mn(1), mo('−'), mi('d')),
      mo(','),
      mspace(),
      sub(mi('F'), txt('y,r')),
      eq,
      mi('m'),
      sub(mi('a'), mi('y')),
      mi('d'),
    ),
    plain: 'a_y = v²/R;  F_y,f = m·a_y·(1−d),  F_y,r = m·a_y·d',
    note: 'The car follows the path exactly, so cornering force is fixed by speed and radius, shared between the axles by weight.',
    impl: ['lateralDemand'],
    module: 'corner',
  },
  {
    id: 'lateral-transfer',
    row: '19',
    title: 'Lateral load transfer',
    mathml: math(
      mi('Δ'),
      sub(mi('N'), txt('lat')),
      eq,
      frac(row(mi('m'), sub(mi('a'), mi('y')), mi('h')), mi('t')),
    ),
    plain: 'ΔN_lat = m·a_y·h/t;  front takes q·ΔN_lat, rear (1−q)·ΔN_lat; outside tire +, inside −',
    note: 'Cornering loads the outside tires, and load sensitivity makes that a net loss of grip.',
    impl: ['lateralTransfer'],
    module: 'corner',
  },
  {
    id: 'friction-circle',
    row: '20',
    title: 'Friction circle',
    mathml: math(
      sqrt(sup(sub(mi('F'), mi('x')), mn(2)), mo('+'), sup(sub(mi('F'), mi('y')), mn(2))),
      mo('≤'),
      sub(mi('F'), txt('max')),
      mo(','),
      mspace(),
      sub(mi('F'), txt('x,max')),
      eq,
      sqrt(sup(sub(mi('F'), txt('max')), mn(2)), mo('−'), sup(sub(mi('F'), mi('y')), mn(2))),
    ),
    plain: '√(F_x² + F_y²) ≤ F_max;  F_x,max = √(F_max² − F_y²)',
    note: 'Grip spent turning is not available for driving or braking: the grip circle plots exactly this.',
    impl: ['frictionCircle'],
    module: 'corner',
  },
  {
    id: 'corner-limit',
    row: '21',
    title: 'Corner limit speed',
    mathml: math(
      sub(mi('v'), txt('lim')),
      eq,
      txt('max '),
      mi('v'),
      txt(' with '),
      sub(mi('F'), txt('y,f')),
      mo('≤'),
      sub(mi('F'), txt('max,f')),
      txt(', '),
      sub(mi('F'), txt('y,r')),
      mo('≤'),
      sub(mi('F'), txt('max,r')),
    ),
    plain: 'v_lim = the largest v with F_y,f ≤ F_max,f and F_y,r ≤ F_max,r (bisection, 0.01 m/s)',
    note: 'The driver holds this speed through each corner; downforce raises it.',
    impl: ['cornerLimitSpeed'],
    module: 'corner',
  },
  {
    id: 'grip-used',
    row: '22',
    title: 'Grip used',
    mathml: math(
      txt('grip_used'),
      eq,
      frac(
        sqrt(sup(sub(mi('F'), mi('x')), mn(2)), mo('+'), sup(sub(mi('F'), mi('y')), mn(2))),
        sub(mi('F'), txt('max')),
      ),
    ),
    plain: 'grip_used = √(F_x² + F_y²)/F_max',
    note: 'The fraction of the budget in use: 1 is the limit, the edge of the grip circle.',
    impl: ['gripUsed'],
    module: 'corner',
  },
]);

function mspace(): string {
  return '<mspace width="1em"></mspace>';
}

/** What the model deliberately leaves out (the page lists these). */
export const NOT_MODELLED: readonly string[] = Object.freeze([
  'Yaw dynamics: the car follows the path exactly, so there is no oversteer or understeer; grip limits only speed.',
  'Suspension and pitch dynamics: load transfer is instantaneous (from the previous 10 ms step).',
  'Tire temperature effect on grip: the equation exists but is off on every level in this build.',
  'Fuel mass: the car weighs the same at the start and the end.',
  'Gear-shift dynamics: gear and rpm are a display sawtooth with no effect on the motion.',
]);

/** One row of the car table. `quantity` formats through the units layer; else `unit` is shown. */
export interface CarParamDoc {
  key: keyof CarParams;
  symbol: string;
  label: string;
  quantity?: Quantity;
  /** Fixed unit label when no quantity applies (e.g. m²). */
  unit?: string;
}

export const CAR_PARAM_DOC: readonly CarParamDoc[] = Object.freeze([
  { key: 'mass', symbol: 'm', label: 'Mass, with driver', quantity: 'mass' },
  { key: 'power', symbol: 'P', label: 'Engine power', quantity: 'power' },
  { key: 'fPeak', symbol: 'F_peak', label: 'Peak engine force', quantity: 'force' },
  { key: 'cd0A', symbol: 'Cd0A', label: 'Drag area, no wing', unit: 'm²' },
  { key: 'kdA', symbol: 'kdA', label: 'Drag area per wing step²', unit: 'm²' },
  { key: 'cl0A', symbol: 'Cl0A', label: 'Lift area, no wing', unit: 'm²' },
  { key: 'klA', symbol: 'klA', label: 'Lift area per wing step', unit: 'm²' },
  {
    key: 'aeroBalanceRear',
    symbol: 'b',
    label: 'Downforce share on the rear',
    quantity: 'fraction',
  },
  { key: 'muPeak', symbol: 'μ_peak', label: 'Peak tire friction', quantity: 'dimensionless' },
  { key: 'kLoadSens', symbol: 'k_s', label: 'Tire load sensitivity', quantity: 'dimensionless' },
  { key: 'cogHeight', symbol: 'h', label: 'Centre of gravity height', quantity: 'distance' },
  { key: 'wheelbase', symbol: 'L', label: 'Wheelbase', quantity: 'distance' },
  { key: 'trackWidth', symbol: 't', label: 'Track width', quantity: 'distance' },
  {
    key: 'crr',
    symbol: 'c_rr',
    label: 'Rolling resistance coefficient',
    quantity: 'dimensionless',
  },
  { key: 'brakeForceMax', symbol: 'F_brk', label: 'Brake force at full pedal', quantity: 'force' },
  { key: 'brakeBiasFront', symbol: 'b_f', label: 'Front brake bias', quantity: 'fraction' },
  { key: 'pOpt', symbol: 'p_opt', label: 'Optimal tire pressure', quantity: 'pressure' },
  { key: 'sigmaP', symbol: 'σ_p', label: 'Pressure bell width', quantity: 'pressure' },
  { key: 'tOpt', symbol: 'T_opt', label: 'Optimal tire temperature', quantity: 'temperature' },
  { key: 'sigmaT', symbol: 'σ_T', label: 'Temperature bell width', unit: 'K' },
  { key: 'sPeak', symbol: 's_peak', label: 'Slip ratio at peak force', quantity: 'ratio' },
  {
    key: 'kSlide',
    symbol: 'k_slide',
    label: 'Slip growth while sliding',
    quantity: 'dimensionless',
  },
  {
    key: 'slideFactor',
    symbol: 'slideFactor',
    label: 'Force kept while sliding',
    quantity: 'fraction',
  },
  { key: 'kRegrip', symbol: 'k_regrip', label: 'Regrip threshold', quantity: 'fraction' },
  { key: 'fuelMass0', symbol: 'm_fuel', label: 'Fuel mass (not modelled)', quantity: 'mass' },
  {
    key: 'arbFrontShare',
    symbol: 'q',
    label: 'Front share of lateral transfer',
    quantity: 'fraction',
  },
]);

/** The car the table documents. */
export const DOCUMENTED_CAR: Readonly<CarParams> = DEFAULT_CAR;
