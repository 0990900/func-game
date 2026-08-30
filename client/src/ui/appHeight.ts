/**
 * Publishes the height actually visible to the player as `--app-height`.
 *
 * `100dvh` is meant to track a mobile browser's collapsing toolbars, but on iOS
 * Safari it lags the real viewport, which leaves a dead band between the app and
 * the toolbar. The visual viewport reports what is on screen right now, so the
 * playing grid can be exactly that tall.
 */
export function trackAppHeight(): () => void {
  const viewport = window.visualViewport;

  const apply = (): void => {
    const height = viewport?.height ?? window.innerHeight;
    document.documentElement.style.setProperty('--app-height', `${Math.round(height)}px`);
  };

  apply();
  viewport?.addEventListener('resize', apply);
  window.addEventListener('resize', apply);
  // iOS fires neither reliably when the toolbars slide away mid-scroll.
  window.addEventListener('orientationchange', apply);

  return () => {
    viewport?.removeEventListener('resize', apply);
    window.removeEventListener('resize', apply);
    window.removeEventListener('orientationchange', apply);
  };
}
