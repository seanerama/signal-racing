/**
 * Playback controls (Stage 10), in the result header: while a run plays, Pause/Resume and Skip;
 * once it has finished, Replay; and always the speed segmented control `1× 2× 4×` (persisted by
 * the caller). Keyboard (app map): Space pauses or resumes, `S` skips, `1/2/4` set the speed.
 */
import type { Speed } from './playback';
import { playState, playSpeed, skipPlayback, togglePause } from './playback';
import './report.css';

export interface PlaybackControlsProps {
  /** A finished run exists that can be replayed. */
  canReplay: boolean;
  onReplay(): void;
  onSpeed(s: Speed): void;
}

const SPEEDS: Speed[] = [1, 2, 4];

export function PlaybackControls({ canReplay, onReplay, onSpeed }: PlaybackControlsProps) {
  const state = playState.value;
  const speed = playSpeed.value;
  const active = state !== 'idle';
  return (
    <div class="pb" role="group" aria-label="Playback" data-testid="playback" data-state={state}>
      {active ? (
        <>
          <button
            type="button"
            class="pb__btn"
            onClick={togglePause}
            aria-pressed={state === 'paused'}
            title={state === 'paused' ? 'Resume (Space)' : 'Pause (Space)'}
            data-testid="pb-pause"
          >
            {state === 'paused' ? '▶ Resume' : '❚❚ Pause'}
          </button>
          <button
            type="button"
            class="pb__btn"
            onClick={skipPlayback}
            title="Skip to the finish (S)"
            data-testid="pb-skip"
          >
            Skip ▸▸
          </button>
        </>
      ) : (
        <button
          type="button"
          class="pb__btn"
          onClick={onReplay}
          disabled={!canReplay}
          title="Replay this run (Space)"
          data-testid="pb-replay"
        >
          ▶ Replay
        </button>
      )}
      <div class="pb__speeds" role="radiogroup" aria-label="Playback speed">
        {SPEEDS.map((s) => (
          <button
            key={s}
            type="button"
            role="radio"
            aria-checked={speed === s}
            class={`pb__speed${speed === s ? ' pb__speed--on' : ''}`}
            onClick={() => onSpeed(s)}
            title={`${s}× (${s})`}
            data-testid={`pb-speed-${s}`}
          >
            {`${s}×`}
          </button>
        ))}
      </div>
    </div>
  );
}
