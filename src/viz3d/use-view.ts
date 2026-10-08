/**
 * Preact glue: mount a lazily loaded 3D view into a ref'd element, push prop updates, and dispose
 * on unmount (route change). No three.js import here.
 */
import { useEffect, useRef, useState } from 'preact/hooks';
import type { ViewHandle } from './types';

export type ViewStatus = 'loading' | 'ready' | 'error';

export function useView<P>(
  mount: (el: HTMLElement, props: P) => ViewHandle<P>,
  props: P,
): { ref: { current: HTMLDivElement | null }; status: ViewStatus } {
  const ref = useRef<HTMLDivElement>(null);
  const handle = useRef<ViewHandle<P> | null>(null);
  const [status, setStatus] = useState<ViewStatus>('loading');
  const first = useRef(true);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const h = mount(el, props);
    handle.current = h;
    let live = true;
    h.ready.then(
      () => live && setStatus('ready'),
      () => live && setStatus('error'),
    );
    return () => {
      live = false;
      h.dispose();
      handle.current = null;
    };
    // Mount once; later prop changes go through update().
  }, []);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    handle.current?.update(props);
  }, [props]);

  return { ref, status };
}
