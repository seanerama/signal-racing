/**
 * ⌘K command palette (design-system "Navigation"): jump to a level, add a channel to the stack by
 * name, toggle projector mode, units and axis. Type to filter (substring on the label), ↑/↓ to
 * move, Enter to run, Esc to close.
 */
import { useMemo, useState } from 'preact/hooks';
import { Modal } from './components/Modal';
import './screens.css';

export interface Command {
  id: string;
  label: string;
  /** Right-aligned hint, e.g. a key or "locked". */
  hint?: string;
  group: 'Level' | 'Channel' | 'View';
  disabled?: boolean;
  run(): void;
}

export interface CommandPaletteProps {
  commands: Command[];
  onClose(): void;
}

export function filterCommands(commands: Command[], q: string): Command[] {
  const s = q.trim().toLowerCase();
  if (!s) return commands;
  const words = s.split(/\s+/);
  return commands.filter((c) => {
    const hay = `${c.group} ${c.label}`.toLowerCase();
    return words.every((w) => hay.includes(w));
  });
}

export function CommandPalette({ commands, onClose }: CommandPaletteProps) {
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const list = useMemo(() => filterCommands(commands, q).slice(0, 60), [commands, q]);
  const active = list[Math.min(sel, list.length - 1)];

  const exec = (c: Command | undefined) => {
    if (!c || c.disabled) return;
    onClose();
    c.run();
  };

  return (
    <Modal label="Command palette" onClose={onClose} width={520} align="top" testId="palette">
      <div class="palette">
        <input
          class="palette__input data"
          placeholder="Jump to a level, add a channel, toggle a view…"
          aria-label="Command"
          value={q}
          data-autofocus
          onInput={(e) => {
            setQ(e.currentTarget.value);
            setSel(0);
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setSel((i) => Math.min(list.length - 1, i + 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setSel((i) => Math.max(0, i - 1));
            } else if (e.key === 'Enter') {
              e.preventDefault();
              exec(active);
            }
          }}
        />
        <ul class="palette__list" role="listbox" aria-label="Commands">
          {list.length === 0 && <li class="palette__empty micro dim">No match.</li>}
          {list.map((c, i) => (
            <li
              key={c.id}
              role="option"
              aria-selected={c === active}
              aria-disabled={c.disabled || undefined}
              class={`palette__item${c === active ? ' palette__item--on' : ''}${c.disabled ? ' palette__item--off' : ''}`}
              onMouseEnter={() => setSel(i)}
              onClick={() => exec(c)}
            >
              <span class="micro faint palette__group">{c.group}</span>
              <span class={c.group === 'Channel' ? 'mono' : ''}>{c.label}</span>
              {c.hint && <span class="micro dim palette__hint">{c.hint}</span>}
            </li>
          ))}
        </ul>
      </div>
    </Modal>
  );
}
