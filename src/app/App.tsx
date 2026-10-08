import { units } from '@/game/prefs';
import { TopBar } from './components/TopBar';
import { routePath } from './router';
import { DevReport } from './routes/DevReport';
import { DevWorker } from './routes/DevWorker';
import { Home } from './routes/Home';
import { DevViz3d } from '@/viz3d/DevViz3d';
import './App.css';

function Route() {
  switch (routePath.value) {
    case '/dev/worker':
      return <DevWorker />;
    case '/dev/report':
      return <DevReport units={units.value} onUnitsChange={(next) => (units.value = next)} />;
    case '/dev/viz3d':
      return <DevViz3d units={units.value} />;
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
