import type { UnitSystem } from '@/units';
import { formatValue } from '@/units';
import { Button } from '../components/Button';

/** Placeholder until the level select lands (Stage 6). */
export function Home({ units }: { units: UnitSystem }) {
  return (
    <section class="dev-page">
      <h1 class="h1">Signal</h1>
      <p class="dim">Foundation build. The level select arrives with the game core.</p>
      <dl class="dev-kv data">
        <dt class="dim">sample speed</dt>
        <dd data-testid="sample-speed">{formatValue('speed', units, 100 / 3.6)}</dd>
        <dt class="dim">sample pressure</dt>
        <dd data-testid="sample-pressure">{formatValue('pressure', units, 1.65)}</dd>
      </dl>
      <div class="dev-row">
        <Button variant="primary" size="run">
          Run
        </Button>
        <Button>Export CSV</Button>
        <Button variant="ghost">Ghost</Button>
        <Button variant="hint" cost={1}>
          Hint 1
        </Button>
        <a class="dev-link mono" href="#/dev/worker">
          #/dev/worker
        </a>
      </div>
    </section>
  );
}
