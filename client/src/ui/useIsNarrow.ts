import { useSyncExternalStore } from 'react';
import { NARROW_BREAKPOINT, isNarrow } from './viewport.ts';

const query = (): MediaQueryList | null =>
  (typeof window !== 'undefined' && window.matchMedia
    ? window.matchMedia(`(max-width: ${NARROW_BREAKPOINT}px)`)
    : null);

const subscribe = (onChange: () => void): (() => void) => {
  const media = query();
  media?.addEventListener('change', onChange);
  return () => media?.removeEventListener('change', onChange);
};

/** Re-renders when the layout crosses the breakpoint, so React and CSS agree. */
export const useIsNarrow = (): boolean =>
  useSyncExternalStore(subscribe, isNarrow, () => true);
