/**
 * The level list (contract 04), in unlock order. Stage 6 ships A1–A4; Stage 8 appends B1L/B4L.
 * Workers, progress and the UI all resolve levels from here.
 */
import { A1 } from './a1-throttle';
import { A2 } from './a2-grip';
import { A3 } from './a3-weight';
import { A4 } from './a4-corner';
import type { LevelConfig } from './types';

export { A1, A2, A3, A4 };

/** Levels in unlock order. */
export const LEVELS: readonly LevelConfig[] = [A1, A2, A3, A4];

export function getLevel(id: string): LevelConfig | undefined {
  return LEVELS.find((l) => l.id === id);
}
