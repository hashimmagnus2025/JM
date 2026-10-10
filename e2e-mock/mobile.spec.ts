import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

for (const path of [
  '/',
  '/students',
  '/fees/collect',
  '/receivables/outstanding',
  '/insights/reports',
]) {
  test(`phone: ${path} fits the screen and is accessible`, async ({ page }) => {
    await page.goto(path);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.getByRole('status', { name: 'Loading' })).toHaveCount(0);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, `horizontal scroll on ${path}`).toBeLessThanOrEqual(1);
    const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
    expect(r.violations.map((v) => [v.id, v.nodes.map((n) => n.target.join(' '))])).toEqual([]);
  });
}
