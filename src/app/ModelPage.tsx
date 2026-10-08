/**
 * Model & sources (`#/model`, Stage 9). Generated from code so it cannot drift from the engine:
 * the equations come from `MODEL_EQUATIONS` (each names the function that implements it), the car
 * table from `DEFAULT_CAR` through the units layer, the planted artifacts from the level configs.
 * Equations render as native MathML with a plain-text twin (and fall back to it where MathML is
 * not supported).
 */
import { DEFAULT_CAR } from '@/engine/index';
import { CAR_PARAM_DOC, MODEL_EQUATIONS, NOT_MODELLED } from '@/engine/model-doc';
import { DISCLAIMER } from '@/game/disclaimer';
import { LEVELS } from '@/levels/index';
import { formatValue, unitLabel, type UnitSystem } from '@/units';
import { SOURCES } from './model-sources';
import './ModelPage.css';

const MATHML = typeof globalThis.MathMLElement !== 'undefined';

function carValue(row: (typeof CAR_PARAM_DOC)[number], units: UnitSystem): [string, string] {
  const v = DEFAULT_CAR[row.key];
  if (row.quantity) {
    return [
      formatValue(row.quantity, units, v, { withUnit: false }),
      unitLabel(row.quantity, units),
    ];
  }
  return [String(v), row.unit ?? ''];
}

function artifactLines(units: UnitSystem): string[] {
  return LEVELS.flatMap((l) =>
    (l.artifacts ?? []).map((a) => {
      const where =
        a.at.t !== undefined
          ? `at ${formatValue('time', units, a.at.t)}`
          : `at ${formatValue('distance', units, a.at.s ?? 0)}`;
      const len =
        a.durationS !== undefined
          ? ` for ${a.durationS} s`
          : a.kind === 'step'
            ? ' to the end'
            : ' for one sample';
      return `${l.id} ${l.title}, run ${a.run}: a ${a.kind} on ${a.channel} ${where}${len}${l.call ? ', followed by “Make the call”' : ''}.`;
    }),
  );
}

export function ModelPage({ units }: { units: UnitSystem }) {
  return (
    <article class="model" data-testid="model-page">
      <header class="model__head">
        <span class="micro dim">REFERENCE</span>
        <h1 class="h1">How this is modelled</h1>
        <p class="model__disclaimer micro" data-testid="disclaimer-model">
          {DISCLAIMER}
        </p>
        <p class="dim">
          One point-mass car on a fixed path, stepped at 100 Hz. Every equation below is the one the
          engine runs, one line each; the parameter table is read from the car the levels use.
        </p>
      </header>

      <section class="model__sec" aria-labelledby="m-eq">
        <h2 class="h2 dim" id="m-eq">
          Equations
        </h2>
        <ol class="model__eqs">
          {MODEL_EQUATIONS.map((e) => (
            <li key={e.id} class="model__eq" data-eq={e.id}>
              <span class="model__row mono micro dim">{e.row}</span>
              <div class="model__eqbody">
                <span class="model__eqtitle">{e.title}</span>
                {MATHML && (
                  <span
                    class="model__math"
                    // Markup authored in src/engine/model-doc.ts, never user input.
                    dangerouslySetInnerHTML={{ __html: e.mathml }}
                  />
                )}
                <code class={`model__plain mono${MATHML ? ' model__plain--twin' : ''}`}>
                  {e.plain}
                </code>
                <p class="model__note">{e.note}</p>
                <span class="micro faint mono">{`${e.module}.ts: ${e.impl.join(', ')}`}</span>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section class="model__sec" aria-labelledby="m-car">
        <h2 class="h2 dim" id="m-car">
          The car
        </h2>
        <p class="dim">
          Round numbers in the neighbourhood of an open-wheel race car, approximate on purpose.
        </p>
        <table class="model__table" data-testid="car-table">
          <thead>
            <tr>
              <th>Parameter</th>
              <th>Symbol</th>
              <th class="model__r">Value</th>
              <th>Unit</th>
            </tr>
          </thead>
          <tbody>
            {CAR_PARAM_DOC.map((r) => {
              const [v, u] = carValue(r, units);
              return (
                <tr key={r.key} data-param={r.key}>
                  <td>{r.label}</td>
                  <td class="mono dim">{r.symbol}</td>
                  <td class="mono model__r">{v}</td>
                  <td class="mono dim">{u}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      <section class="model__sec" aria-labelledby="m-not">
        <h2 class="h2 dim" id="m-not">
          Deliberately not modelled
        </h2>
        <ul class="model__list">
          {NOT_MODELLED.map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ul>
      </section>

      <section class="model__sec" aria-labelledby="m-sensor">
        <h2 class="h2 dim" id="m-sensor">
          Sensor model
        </h2>
        <ul class="model__list">
          <li>
            Every channel you see is a sensor reading: the model value plus Gaussian noise with σ a
            fixed fraction of the sensor’s range (0.2–0.5 % for primary sensors such as speed,
            pedals and loads; 0.5–1 % for model estimates such as μ, grip and slip).
          </li>
          <li>Dropouts: about one sample in a thousand reads nothing and draws as a gap.</li>
          <li>
            Bounded sensors are clamped after the noise: pedals read 0–100 %, speeds never read
            below zero, the gear is an integer 1–6. Position and heading are exact.
          </li>
          <li>
            Math channels (wheel slip speed, top speed, exit speed) are computed from the noisy
            sensors, so they inherit their noise; timing channels are exact.
          </li>
          <li>
            Planted artifacts. A few readings are deliberately wrong, in the sensor layer only: the
            physics, the hints, the assist and your score never see them. They exist to practise
            telling a sensor fault from a real effect.
            <ul>
              {artifactLines(units).map((t) => (
                <li key={t} class="mono model__artifact" data-testid="artifact-disclosure">
                  {t}
                </li>
              ))}
            </ul>
          </li>
          <li>
            The grip circle plots the model’s tire forces (<code class="mono">fx_*</code>,{' '}
            <code class="mono">fy_*</code>), which no sensor measures: it is labelled “model
            estimate”.
          </li>
        </ul>
      </section>

      <section class="model__sec" aria-labelledby="m-src">
        <h2 class="h2 dim" id="m-src">
          Sources
        </h2>
        <p class="micro dim">
          Each was fetched and checked on 2026-10-08. Links need a network connection; the app does
          not.
        </p>
        <ol class="model__sources" data-testid="sources">
          {SOURCES.map((s) => (
            <li key={s.id} data-source={s.id}>
              <span>{s.cite}</span>{' '}
              <a class="sheet__link mono model__url" href={s.url} target="_blank" rel="noreferrer">
                {s.url}
              </a>
              <span class="micro dim model__supports">{s.supports}</span>
            </li>
          ))}
        </ol>
      </section>
    </article>
  );
}
