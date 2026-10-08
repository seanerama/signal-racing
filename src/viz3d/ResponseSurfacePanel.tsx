/**
 * Ready-to-mount response surface for the Debrief's slot (Stage 6). Lazy-loads three.js on mount
 * and disposes the WebGL context on unmount. Debrief only: the surface reveals the optimum.
 *
 *   <ResponseSurfacePanel grid={grid} runs={runs} level={level} units={units} />
 */
import { useMemo } from 'preact/hooks';
import type { RunRecord } from '@/game/types';
import type { LevelConfig } from '@/levels/types';
import type { UnitSystem } from '@/units';
import type { GridResult } from '@/worker/types';
import { mountResponseSurface } from './index';
import type { SurfaceProps } from './types';
import { useView } from './use-view';

export interface ResponseSurfacePanelProps {
  grid: GridResult;
  runs: RunRecord[];
  level: LevelConfig;
  units: UnitSystem;
  class?: string;
}

export function ResponseSurfacePanel({
  grid,
  runs,
  level,
  units,
  class: cls,
}: ResponseSurfacePanelProps) {
  const props = useMemo<SurfaceProps>(
    () => ({ grid, runs, level, units }),
    [grid, runs, level, units],
  );
  const { ref, status } = useView(mountResponseSurface, props);
  return (
    <section
      class={`rs-panel${cls ? ` ${cls}` : ''}`}
      aria-label="Response surface: outcome time over the two most influential levers"
      data-testid="response-surface"
    >
      <div class="rs-panel__head">
        <h2 class="rs-panel__title h2">Response surface</h2>
        <span class="rs-panel__note micro">
          {`${grid.evaluated} setups evaluated · drag to orbit`}
        </span>
      </div>
      <div class="rs-panel__view" style={{ position: 'relative' }}>
        <div
          ref={ref}
          class="viz3d"
          style={{ position: 'absolute', inset: 0 }}
          data-testid="response-surface-view"
        />
        {status !== 'ready' && (
          <span class="viz3d-status micro">
            {status === 'error' ? '3D view failed to load' : 'loading 3D…'}
          </span>
        )}
      </div>
    </section>
  );
}
