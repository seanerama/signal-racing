/**
 * B1L debrief: the per-segment delta table. For the best run: each segment's time, its engine
 * floor (the fastest any one setup does that segment alone; rough cut, from the grid search) and
 * the delta, then the totals, the compromise gap and the best achievable gap.
 */
import type { RunRecord } from '@/game/types';
import { bestAchievableGap, compromiseGap } from '@/game/session';
import type { LevelConfig } from '@/levels/types';
import { DeltaValue } from '@/report/DeltaValue';
import { formatValue, unitLabel, type UnitSystem } from '@/units';
import type { GridResult } from '@/worker/types';

export interface JoinTableProps {
  level: LevelConfig;
  grid: GridResult | null;
  best: RunRecord | null;
  units: UnitSystem;
}

export function JoinTable({ level, grid, best, units }: JoinTableProps) {
  if (!grid) return null;
  const t = (v: number) => formatValue('time', units, v, { withUnit: false });
  const segs = level.track.segments;
  const floors = grid.segmentFloors;
  const sum = floors.reduce((a, b) => a + b, 0);
  return (
    <div class="db__join" data-testid="join-table">
      <h2 class="h2 dim db__h">Per segment</h2>
      <table class="db__table">
        <thead>
          <tr>
            <th>Segment</th>
            <th class="db__r">Your best</th>
            <th class="db__r">Engine floor</th>
            <th class="db__r">segment_delta</th>
          </tr>
        </thead>
        <tbody>
          {segs.map((seg, i) => {
            const mine = best?.outcome.segmentTimes[i];
            return (
              <tr key={seg.id}>
                <td>{seg.label}</td>
                <td class="db__r mono">{mine === undefined ? '—' : t(mine)}</td>
                <td class="db__r mono dim">{t(floors[i]!)}</td>
                <td class="db__r">
                  <DeltaValue value={mine === undefined ? null : mine - floors[i]!} size="data" />
                </td>
              </tr>
            );
          })}
          <tr class="db__total">
            <td class="dim">total</td>
            <td class="db__r mono">{best ? t(best.outcome.totalTime) : '—'}</td>
            <td class="db__r mono dim">{t(sum)}</td>
            <td class="db__r">
              <DeltaValue
                value={best ? compromiseGap(best.outcome.totalTime, grid) : null}
                size="data"
              />
            </td>
          </tr>
        </tbody>
      </table>
      <p class="micro faint">
        {`Times in ${unitLabel('time', units)}. The last cell is your compromise gap; the best any single setup can do is +${t(bestAchievableGap(grid))}. Engine floor: the fastest the engine does each segment alone, over every setup the target search tried.`}
      </p>
    </div>
  );
}
