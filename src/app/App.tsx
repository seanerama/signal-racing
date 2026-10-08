import { signal } from '@preact/signals';
import type { UnitSystem } from '@/units';
import { TopBar } from './components/TopBar';
import { routePath } from './router';
import { DevReport } from './routes/DevReport';
import { DevWorker } from './routes/DevWorker';
import { Home } from './routes/Home';
import './App.css';

/** Local units signal. Stage 5 replaces it with the persisted `units` pref (contract 06). */
const units = signal<UnitSystem>('metric');

function Route() {
  switch (routePath.value) {
    case '/dev/worker':
      return <DevWorker />;
    case '/dev/report':
      return <DevReport units={units.value} onUnitsChange={(next) => (units.value = next)} />;
    default:
      return <Home units={units.value} />;
  }
}

/** App shell (placeholder): top bar + routed content. */
export function App() {
  return (
    <div class="app">
      <TopBar units={units.value} onUnitsChange={(next) => (units.value = next)} />
      <main class="app__main">
        <Route />
      </main>
    </div>
  );
}
