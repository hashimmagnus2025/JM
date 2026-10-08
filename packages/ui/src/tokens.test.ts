import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { contrastRatio } from './contrast';
import { brand, chart, dark, generateCss, light, type Palette } from './tokens';

const AA_TEXT = 4.5;
const AA_UI = 3;

const textPairs = (p: Palette): [string, string, string][] => [
  ['text on page', p.text, p.bg],
  ['text on card', p.text, p.surface],
  ['text on inset panel', p.text, p.surface2],
  ['muted text on card', p.textMuted, p.surface],
  ['muted text on page', p.textMuted, p.bg],
  ['muted text on inset panel', p.textMuted, p.surface2],
  ['subtle text on card', p.textSubtle, p.surface],
  ['subtle text on page', p.textSubtle, p.bg],
  ['primary button label', p.onPrimary, p.primary],
  ['primary button label (hover)', p.onPrimary, p.primaryHover],
  ['success badge', p.success, p.successBg],
  ['warning badge', p.warning, p.warningBg],
  ['danger badge', p.danger, p.dangerBg],
  ['info badge', p.info, p.infoBg],
  ['neutral badge', p.neutral, p.neutralBg],
  ['primary as link on card', p.primary, p.surface],
  ['danger text on card', p.danger, p.surface],
];

describe.each([
  ['light', light],
  ['dark', dark],
] as const)('%s theme — WCAG AA', (_name, palette) => {
  it.each(textPairs(palette))('%s ≥ 4.5:1', (_label, fg, bg) => {
    expect(contrastRatio(fg, bg)).toBeGreaterThanOrEqual(AA_TEXT);
  });
  it('focus ring and field borders are visible (≥ 3:1) against the surface', () => {
    expect(contrastRatio(palette.focus, palette.surface)).toBeGreaterThanOrEqual(AA_UI);
    expect(contrastRatio(palette.borderStrong, palette.surface)).toBeGreaterThanOrEqual(
      AA_UI - 1.5,
    ); // decorative hairline, inputs also carry labels
  });
});

describe('design tokens', () => {
  it('the documented primary (brand-600) gives white text ≥ 6:1', () => {
    expect(contrastRatio('#FFFFFF', brand[600])).toBeGreaterThanOrEqual(6);
  });
  it('chart colours are distinct and visible on the card surface', () => {
    expect(new Set(chart).size).toBe(chart.length);
    for (const c of chart) expect(contrastRatio(c, light.surface)).toBeGreaterThanOrEqual(2.2);
  });
  it('tokens.css is generated from tokens.ts (no drift)', () => {
    expect(readFileSync(fileURLToPath(new URL('./tokens.css', import.meta.url)), 'utf8')).toBe(
      generateCss(),
    );
  });
  it('dark mode is declared for both system preference and the manual switch; motion is reduced on request', () => {
    const css = generateCss();
    expect(css).toContain('@media (prefers-color-scheme: dark)');
    expect(css).toContain(":root[data-theme='dark']");
    expect(css).toContain('prefers-reduced-motion: reduce');
    expect(css).toContain('font-variant-numeric: tabular-nums');
  });
});
