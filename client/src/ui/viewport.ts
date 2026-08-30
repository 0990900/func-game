/**
 * Where the layout changes shape.
 *
 * Narrow screens fan the cards and ask for two taps; wide ones lay everything
 * out and take one. The threshold matches the CSS breakpoint, so the two halves
 * of the UI never disagree about which layout they are in.
 */
export const NARROW_BREAKPOINT = 760;

export const isNarrow = (): boolean => window.innerWidth <= NARROW_BREAKPOINT;
