/**
 * "Ledger" design tokens — the single source of truth. `tokens.css` is GENERATED from this file
 * (`pnpm --filter @sfm/ui tokens:build`) and a test fails if they drift apart.
 * Colour pairs are verified against WCAG AA in `tokens.test.ts`.
 */

export const brand = {
  50: '#EAF6F2',
  100: '#CFEBE2',
  200: '#A2D7C7',
  300: '#6FBDA7',
  400: '#3FA088',
  500: '#1F8670',
  600: '#136D5B',
  700: '#0F5748',
  800: '#0C4439',
  900: '#08302A',
} as const;

export interface Palette {
  bg: string;
  surface: string;
  surface2: string;
  border: string;
  borderStrong: string;
  text: string;
  textMuted: string;
  textSubtle: string;
  primary: string;
  onPrimary: string;
  primaryHover: string;
  focus: string;
  success: string;
  successBg: string;
  warning: string;
  warningBg: string;
  danger: string;
  dangerBg: string;
  info: string;
  infoBg: string;
  neutral: string;
  neutralBg: string;
}

export const light: Palette = {
  bg: '#F7F8F6',
  surface: '#FFFFFF',
  surface2: '#F0F3F1',
  border: '#DDE3DF',
  borderStrong: '#C3CDC8',
  text: '#14201C',
  textMuted: '#4F5F58',
  textSubtle: '#5E6E67',
  primary: brand[600],
  onPrimary: '#FFFFFF',
  primaryHover: brand[700],
  focus: brand[500],
  success: '#17703F',
  successBg: '#E3F4EA',
  warning: '#8A5A00',
  warningBg: '#FFF1D0',
  danger: '#B42318',
  dangerBg: '#FDE8E6',
  info: '#1D5FA8',
  infoBg: '#E5EFFB',
  neutral: '#4F5F58',
  neutralBg: '#EBEFED',
};

export const dark: Palette = {
  bg: '#0E1513',
  surface: '#141D1A',
  surface2: '#1A2521',
  border: '#26332E',
  borderStrong: '#374841',
  text: '#E6EEEA',
  textMuted: '#A3B5AC',
  textSubtle: '#8FA198',
  primary: '#4BB59B',
  onPrimary: '#08302A',
  primaryHover: '#6FC7B1',
  focus: '#6FC7B1',
  success: '#6FD6A0',
  successBg: '#13291E',
  warning: '#F0C066',
  warningBg: '#2E2410',
  danger: '#FF9C92',
  dangerBg: '#331614',
  info: '#8DBBF2',
  infoBg: '#12263D',
  neutral: '#A3B5AC',
  neutralBg: '#1F2A26',
};

/** colour-blind-safe categorical series (always paired with labels/patterns — never colour alone) */
export const chart = [
  '#136D5B',
  '#2F5D9E',
  '#D69E2E',
  '#D9593D',
  '#7B61B8',
  '#4AA3C7',
  '#8A9A2B',
  '#64748B',
] as const;

export const font = {
  family: "'Inter Variable', Inter, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
  /** every numeral is tabular so columns of money line up */
  numeric: 'tabular-nums',
  size: {
    xs: '12px',
    sm: '13px',
    base: '14px',
    md: '16px',
    lg: '18px',
    xl: '20px',
    '2xl': '24px',
    '3xl': '30px',
    '4xl': '36px',
  },
  weight: { regular: 400, medium: 500, semibold: 600 },
} as const;

export const space = {
  0: '0',
  1: '4px',
  2: '8px',
  3: '12px',
  4: '16px',
  5: '20px',
  6: '24px',
  8: '32px',
  10: '40px',
  12: '48px',
} as const;
export const radius = { sm: '6px', md: '8px', lg: '12px', xl: '16px' } as const;
export const shadow = {
  e1: '0 1px 2px rgb(16 32 27 / 6%)',
  e2: '0 4px 12px rgb(16 32 27 / 8%)',
  e3: '0 12px 32px rgb(16 32 27 / 14%)',
} as const;
export const motion = {
  fast: '120ms',
  base: '180ms',
  slow: '240ms',
  easing: 'cubic-bezier(.2, 0, 0, 1)',
} as const;
export const breakpoints = { sm: 640, md: 768, lg: 1024, xl: 1280 } as const;

const kebab = (s: string): string => s.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
const vars = (p: Palette): string =>
  Object.entries(p)
    .map(([k, v]) => `  --${kebab(k)}: ${v};`)
    .join('\n');

/** generate tokens.css (light default, dark via prefers-color-scheme unless forced by data-theme) */
export function generateCss(): string {
  const scale = Object.entries(brand)
    .map(([k, v]) => `  --brand-${k}: ${v};`)
    .join('\n');
  const rest = [
    ...Object.entries(space).map(([k, v]) => `  --space-${k}: ${v};`),
    ...Object.entries(radius).map(([k, v]) => `  --radius-${k}: ${v};`),
    ...Object.entries(shadow).map(([k, v]) => `  --shadow-${k}: ${v};`),
    ...Object.entries(font.size).map(([k, v]) => `  --text-${k}: ${v};`),
    ...Object.entries(motion).map(([k, v]) => `  --motion-${k}: ${v};`),
    ...chart.map((c, i) => `  --chart-${i + 1}: ${c};`),
    `  --font-family: ${font.family};`,
  ].join('\n');
  return `/* GENERATED from src/tokens.ts — do not edit. Run: pnpm --filter @sfm/ui tokens:build */
:root {
${scale}
${vars(light)}
${rest}
  color-scheme: light;
}

@media (prefers-color-scheme: dark) {
  :root:not([data-theme='light']) {
${vars(dark).replace(/^ {2}/gm, '    ')}
    color-scheme: dark;
  }
}

:root[data-theme='dark'] {
${vars(dark)}
  color-scheme: dark;
}

body {
  background: var(--bg);
  color: var(--text);
  font-family: var(--font-family);
  font-size: var(--text-base);
  font-variant-numeric: tabular-nums;
}

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    transition-duration: 0.01ms !important;
  }
}
`;
}
