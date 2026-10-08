import { test, expect } from 'vitest';
import { PHYSICAL_CHANNELS } from '@/engine';
import { allChannels } from '@/telemetry/registry';
test('telemetry registry matches engine PHYSICAL_CHANNELS (ids + quantities)', () => {
  const reg = new Map(allChannels().map((c) => [c.id, c]));
  const bad = PHYSICAL_CHANNELS.filter(
    (p) => !reg.has(p.id) || reg.get(p.id)!.quantity !== p.quantity,
  ).map((p) => p.id);
  const extra = allChannels()
    .filter((c) => c.source.kind === 'physical' && !PHYSICAL_CHANNELS.some((p) => p.id === c.id))
    .map((c) => c.id);
  expect(bad).toEqual([]);
  expect(extra).toEqual([]);
});
