/**
 * Entry points for the 3D data views. This module is light: three.js and the view code load on
 * first use through dynamic `import()`, so three is never in the initial chunk (inlined in the
 * single-file build, where there is only one chunk).
 *
 * Both return a handle synchronously; `update` before load keeps the latest props, and `dispose`
 * before load cancels the mount.
 */
import { log } from '@/app/log';
import type { SurfaceProps, ViewHandle, WaterfallProps } from './types';
import './viz3d.css';

export type { SurfaceProps, ViewHandle, WaterfallProps } from './types';

function lazyView<P>(
  el: HTMLElement,
  props: P,
  load: () => Promise<(el: HTMLElement, props: P) => ViewHandle<P>>,
): ViewHandle<P> {
  let latest = props;
  let inner: ViewHandle<P> | null = null;
  let disposed = false;
  el.dataset.viz3d = 'loading';
  const ready = load().then(
    (create) => {
      if (disposed) return;
      inner = create(el, latest);
      el.dataset.viz3d = 'ready';
      return inner.ready;
    },
    (err: unknown) => {
      el.dataset.viz3d = 'error';
      log.error('3D view failed to load', err);
      throw err;
    },
  );
  ready.catch(() => undefined);
  return {
    ready: ready.then(() => undefined),
    update(next) {
      latest = next;
      inner?.update(next);
    },
    dispose() {
      disposed = true;
      inner?.dispose();
      inner = null;
      delete el.dataset.viz3d;
    },
  };
}

/** Mounts the run waterfall for one channel into `el` (sized by the caller). */
export function openWaterfall(el: HTMLElement, props: WaterfallProps): ViewHandle<WaterfallProps> {
  return lazyView(el, props, () => import('./waterfall').then((m) => m.createWaterfall));
}

/** Mounts the response surface into `el` (debrief only: it reveals the optimum). */
export function mountResponseSurface(
  el: HTMLElement,
  props: SurfaceProps,
): ViewHandle<SurfaceProps> {
  return lazyView(el, props, () =>
    import('./response-surface').then((m) => m.createResponseSurface),
  );
}
