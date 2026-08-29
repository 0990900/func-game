/**
 * The visual language, in one place. CSS reads these as custom properties; the
 * Pixi table (milestone D) reads the same numbers, so DOM and canvas cannot
 * drift apart.
 */
import type { ContainerName } from '../../../src/core/types.ts';

export const palette = {
  bg: '#090d12',
  surface: '#111821',
  surface2: '#17212c',
  line: '#293747',
  text: '#eef4f8',
  muted: '#9cacbc',
  accent: '#f4c95d',
  accentDark: '#161207',
} as const;

export const containerColor: Record<ContainerName, string> = {
  Maybe: '#ba7cff',
  Either: '#ff7a86',
  List: '#58d6ad',
  Task: '#69a8ff',
};

export const utilityColor = '#f4c95d';
export const wildcardColor = '#ffffff';

export const space = {
  1: '4px', 2: '8px', 3: '12px', 4: '16px', 5: '24px', 6: '32px',
} as const;

/** Hex to the 0xRRGGBB number Pixi wants. */
export const toHexNumber = (hex: string): number => Number.parseInt(hex.slice(1), 16);

/** Publishes the palette as CSS custom properties on :root. */
export function applyCssVariables(root: HTMLElement = document.documentElement): void {
  const set = (name: string, value: string) => root.style.setProperty(name, value);
  set('--bg', palette.bg);
  set('--surface', palette.surface);
  set('--surface-2', palette.surface2);
  set('--line', palette.line);
  set('--text', palette.text);
  set('--muted', palette.muted);
  set('--accent', palette.accent);
  set('--accent-dark', palette.accentDark);
  set('--utility', utilityColor);
  for (const [name, color] of Object.entries(containerColor)) {
    set(`--${name.toLowerCase()}`, color);
  }
  for (const [step, value] of Object.entries(space)) {
    set(`--space-${step}`, value);
  }
}
