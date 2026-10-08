import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { generateCss } from '../src/tokens';

writeFileSync(fileURLToPath(new URL('../src/tokens.css', import.meta.url)), generateCss());
console.log('tokens.css written'); // eslint-disable-line no-console
