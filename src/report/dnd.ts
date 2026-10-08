/**
 * Drag-and-drop payloads shared by the strip stack (reorder) and the channel table (drag a row
 * into the stack). HTML5 DnD carries the payload in `dataTransfer`; a module copy backs it up for
 * browsers/test environments that withhold `getData` during `dragover`.
 */
import type { ChannelId } from '@/engine/types';

export const DND_MIME = 'application/x-signal-channel';

export interface DragPayload {
  id: ChannelId;
  from: 'stack' | 'table';
}

let active: DragPayload | null = null;

export function beginDrag(ev: DragEvent, payload: DragPayload): void {
  active = payload;
  const dt = ev.dataTransfer;
  if (dt) {
    try {
      dt.setData(DND_MIME, JSON.stringify(payload));
      dt.setData('text/plain', payload.id);
      dt.effectAllowed = 'move';
    } catch {
      // some environments refuse setData; the module copy still works
    }
  }
}

/** The payload being dragged, or null if the drag is not one of ours. */
export function readDrag(ev: DragEvent): DragPayload | null {
  const dt = ev.dataTransfer;
  if (dt) {
    try {
      const raw = dt.getData(DND_MIME);
      if (raw) return JSON.parse(raw) as DragPayload;
    } catch {
      // fall through to the module copy
    }
  }
  return active;
}

export function endDrag(): void {
  active = null;
}
