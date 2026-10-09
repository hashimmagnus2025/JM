import { fileURLToPath } from 'node:url';
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
const HERE = fileURLToPath(new URL('.', import.meta.url));

test.skip(
  !process.env.E2E_MONGO_URI,
  'set E2E_MONGO_URI to a throwaway database to run the end-to-end tests',
);

test('phone: sign in, open the menu drawer, navigate, no horizontal scrolling, accessible', async ({
  page,
}) => {
  const { email } = JSON.parse(readFileSync(join(HERE, '.e2e-credentials.json'), 'utf8')) as {
    email: string;
  };
  await page.goto('/login');
  await page.getByLabel(/E-mail/).fill(email);
  await page.getByLabel(/Password/).fill('Violet-Lamp-2026!');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: /Welcome/ })).toBeVisible();

  await expect(page.getByRole('navigation', { name: 'Main' })).toBeHidden(); // sidebar collapses on a phone
  await page.getByRole('button', { name: 'Open menu' }).click();
  await page.getByRole('link', { name: 'Academic years' }).click();
  await expect(page.getByRole('heading', { name: 'Academic years' })).toBeVisible();
  await expect(page.getByRole('dialog', { name: 'Menu' })).toBeHidden(); // drawer closes after navigating

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(r.violations.map((v) => v.id)).toEqual([]);
});
