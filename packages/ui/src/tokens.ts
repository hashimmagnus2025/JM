/**
 * "Ledger" design tokens — the single source of truth. `tokens.css` is GENERATED from this file
 * (`pnpm --filter @sfm/ui tokens:build`) and a test fails if they drift apart.
 * Colour pairs are verified against WCAG AA in `tokens.test.ts`.
 */

/** clean blue scale (white + blue interface); brand[600] gives white text 6.7:1 */
export const brand = {
  50: '#EFF6FF',
  100: '#DBEAFE',
  200: '#BFDBFE',
  300: '#93C5FD',
  400: '#60A5FA',
  500: '#2563EB',
  600: '#1D4ED8',
  700: '#1E40AF',
  800: '#1E3A8A',
  900: '#172554',
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
  /** soft blue wash for selected / hovered items; `primary` text on it is AA-readable */
  primarySoft: string;
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
  bg: '#F5F8FD',
  surface: '#FFFFFF',
  surface2: '#EEF3FA',
  border: '#DCE5F1',
  borderStrong: '#B4C3D9',
  text: '#0F1B2D',
  textMuted: '#44546B',
  textSubtle: '#566680',
  primary: brand[600],
  onPrimary: '#FFFFFF',
  primaryHover: brand[700],
  primarySoft: brand[50],
  focus: brand[500],
  success: '#17703F',
  successBg: '#E3F4EA',
  warning: '#8A5A00',
  warningBg: '#FFF1D0',
  danger: '#B42318',
  dangerBg: '#FDE8E6',
  info: '#1D4ED8',
  infoBg: '#E5EEFF',
  neutral: '#475569',
  neutralBg: '#EAEFF6',
};

export const dark: Palette = {
  bg: '#0A1120',
  surface: '#111A2D',
  surface2: '#18243B',
  border: '#24324D',
  borderStrong: '#34476A',
  text: '#E6ECF6',
  textMuted: '#A5B3C9',
  textSubtle: '#8F9FB8',
  primary: '#6B9BFF',
  onPrimary: '#0A1120',
  primaryHover: '#8FB3FF',
  primarySoft: '#16264A',
  focus: '#8FB3FF',
  success: '#6FD6A0',
  successBg: '#13291E',
  warning: '#F0C066',
  warningBg: '#2E2410',
  danger: '#FF9C92',
  dangerBg: '#331614',
  info: '#9DBBFF',
  infoBg: '#14264D',
  neutral: '#A5B3C9',
  neutralBg: '#1C2840',
};

/** colour-blind-safe categorical series (always paired with labels/patterns — never colour alone) */
export const chart = [
  '#1D4ED8',
  '#0891B2',
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
  e1: '0 1px 2px rgb(15 27 45 / 6%)',
  e2: '0 4px 14px rgb(15 27 45 / 8%)',
  e3: '0 14px 36px rgb(15 27 45 / 16%)',
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
