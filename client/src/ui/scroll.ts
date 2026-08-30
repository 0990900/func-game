/**
 * Page scrolling that follows the player through the pick.
 *
 * Only on narrow screens: on a desktop the whole table is visible at once and
 * moving the page under someone would be disorienting.
 */
export const isNarrow = (): boolean => window.innerWidth <= 760;

const behavior = (): ScrollBehavior =>
  (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth');

export function scrollPageTo(top: number): void {
  if (!isNarrow()) return;
  window.scrollTo({ top: Math.max(0, top), behavior: behavior() });
}

/** Height of the sticky status bar, which would otherwise cover the target. */
export function stickyClearance(): number {
  const statusBar = document.querySelector('.statusbar');
  return (statusBar?.getBoundingClientRect().height ?? 0) + 12;
}
