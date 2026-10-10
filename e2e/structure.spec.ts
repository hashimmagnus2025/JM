import { fileURLToPath } from 'node:url';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
const HERE = fileURLToPath(new URL('.', import.meta.url));

const creds = (): { email: string } =>
  JSON.parse(readFileSync(join(HERE, '.e2e-credentials.json'), 'utf8'));
// set by setup.spec.ts, which runs first in the same database
const PASSWORD = 'Violet-Lamp-2026!';

test.skip(
  !process.env.E2E_MONGO_URI,
  'set E2E_MONGO_URI to a throwaway database to run the end-to-end tests',
);

async function expectNoA11yViolations(page: Page, label: string): Promise<void> {
  // wait for any loading placeholder to go away so axe sees the settled page
  await expect(page.getByRole('status', { name: 'Loading' })).toHaveCount(0);
  const r = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  const bad = r.violations.flatMap((v) =>
    v.nodes.map((n) => `${v.id} · ${n.target.join(' ')} · ${n.any[0]?.message ?? v.help}`),
  );
  expect(bad, `accessibility violations on ${label}`).toEqual([]);
}

test.describe.serial('classes, divisions, teachers and class teachers', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel(/E-mail/).fill(creds().email);
    await page.getByLabel(/Password/).fill(PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByRole('heading', { name: /Welcome/ })).toBeVisible();
  });

  test('classes: add two, mark the last one, and reorder', async ({ page }) => {
    await page.goto('/academic/classes');
    await expect(page.getByText('No classes yet')).toBeVisible();
    await expectNoA11yViolations(page, 'classes (empty)');

    await page.getByRole('button', { name: 'Add first class' }).click();
    let dialog = page.getByRole('dialog', { name: 'New class' });
    await dialog.getByRole('button', { name: 'Add class' }).click();
    await expect(dialog.getByText('Enter a name')).toBeVisible();
    await dialog.getByLabel(/Name/).fill('Class 1');
    await dialog.getByLabel(/Code/).fill('1');
    await dialog.getByRole('button', { name: 'Add class' }).click();
    await expect(page.getByRole('listitem').filter({ hasText: 'Class 1' })).toBeVisible();

    await page.getByRole('button', { name: /New class/ }).click();
    dialog = page.getByRole('dialog', { name: 'New class' });
    await dialog.getByLabel(/Name/).fill('Class 2');
    await dialog.getByLabel(/Code/).fill('1'); // duplicate code
    await dialog.getByRole('button', { name: 'Add class' }).click();
    await expect(dialog.getByRole('alert')).toContainText(/already exists/);
    await dialog.getByLabel(/Code/).fill('2');
    await dialog.getByRole('switch').check({ force: true });
    await dialog.getByRole('button', { name: 'Add class' }).click();

    const items = page.locator('main ol > li');
    await expect(items).toHaveCount(2);
    await expect(items.nth(1)).toContainText('Last class');
    await page.getByRole('button', { name: 'Move Class 2 up' }).click();
    await expect(items.nth(0)).toContainText('Class 2');
    await expectNoA11yViolations(page, 'classes');
  });

  test('divisions: add A and B to Class 1 for the current year', async ({ page }) => {
    await page.goto('/academic/divisions');
    await expect(page.getByLabel('Academic year')).toContainText('2026-27');
    await page.getByRole('button', { name: /New division/ }).click();
    let dialog = page.getByRole('dialog', { name: /New division/ });
    await dialog.getByLabel(/^Class/).selectOption({ label: 'Class 1' });
    await dialog.getByLabel(/Division name/).fill('A');
    await dialog.getByLabel(/Capacity/).fill('40');
    await dialog.getByRole('button', { name: 'Add division' }).click();
    await expect(page.getByText('Division A', { exact: true })).toBeVisible();

    // the same name again (different case) is refused in plain language
    await page.getByRole('button', { name: /New division/ }).click();
    dialog = page.getByRole('dialog', { name: /New division/ });
    await dialog.getByLabel(/^Class/).selectOption({ label: 'Class 1' });
    await dialog.getByLabel(/Division name/).fill('a');
    await dialog.getByRole('button', { name: 'Add division' }).click();
    await expect(dialog.getByRole('alert')).toContainText(/already exists/);
    await dialog.getByLabel(/Division name/).fill('B');
    await dialog.getByRole('button', { name: 'Add division' }).click();
    await expect(page.getByText('Division B', { exact: true })).toBeVisible();
    await expect(page.getByText('Capacity 40')).toBeVisible();
    await expectNoA11yViolations(page, 'divisions');

    // the Classes page now shows the division count
    await page.goto('/academic/classes');
    await expect(page.getByText(/2 divisions in 2026-27/)).toBeVisible();
  });

  test('teachers: add two, search, and see a validation message', async ({ page }) => {
    await page.goto('/academic/teachers');
    await expect(page.getByText('No teachers yet')).toBeVisible();
    await expectNoA11yViolations(page, 'teachers (empty)');
    const add = async (name: string, staffId: string, mobile: string) => {
      await page
        .getByRole('button', { name: /New teacher|Add first teacher/ })
        .first()
        .click();
      const dialog = page.getByRole('dialog', { name: 'New teacher' });
      await dialog.getByLabel(/Full name/).fill(name);
      await dialog.getByLabel(/Staff ID/).fill(staffId);
      await dialog.getByLabel(/Mobile/).fill(mobile);
      await dialog.getByLabel(/Joining date/).fill('2020-06-01');
      await dialog.getByRole('button', { name: 'Add teacher' }).click();
      await expect(page.getByRole('listitem').filter({ hasText: name })).toBeVisible();
    };
    await page.getByRole('button', { name: 'Add first teacher' }).click();
    const bad = page.getByRole('dialog', { name: 'New teacher' });
    await bad.getByLabel(/Mobile/).fill('12345');
    await bad.getByRole('button', { name: 'Add teacher' }).click();
    await expect(bad.getByText('Enter a 10-digit mobile number')).toBeVisible();
    await bad.getByRole('button', { name: 'Cancel' }).click();

    await add('Asha Mehta', 'EMP-1', '98765 43210');
    await add('Ravi Kumar', 'EMP-2', '9876543211');
    await expect(page.getByText('TCH-000001')).toBeVisible();
    await page.getByLabel('Search teachers').fill('ravi');
    await expect(page.getByRole('listitem').filter({ hasText: 'Asha Mehta' })).toHaveCount(0);
    await page.getByLabel('Search teachers').fill('');
    await expectNoA11yViolations(page, 'teachers');
  });

  test('class teacher: assign, protect from switch-off, change with a reason, see history', async ({
    page,
  }) => {
    await page.goto('/academic/divisions');
    await expect(page.getByText('No class teacher yet')).toHaveCount(2);

    await page.getByRole('button', { name: 'Actions for Class 1 A' }).click();
    await page.getByRole('menuitem', { name: 'Assign class teacher' }).click();
    let dialog = page.getByRole('dialog', { name: /Assign class teacher/ });
    await dialog.getByLabel(/Teacher/).selectOption({ label: 'Asha Mehta · TCH-000001' });
    await dialog.getByRole('button', { name: 'Assign' }).click();
    await expect(page.getByText('Class teacher: Asha Mehta')).toBeVisible();
    await expect(page.getByText('No class teacher yet')).toHaveCount(1);
    await expectNoA11yViolations(page, 'divisions with a class teacher');

    // she cannot be switched off while she holds a division
    await page.goto('/academic/teachers');
    await page.getByRole('button', { name: 'Actions for Asha Mehta' }).click();
    await page.getByRole('menuitem', { name: 'Switch off' }).click();
    await expect(page.getByText(/is class teacher of division A/)).toBeVisible();

    await page.goto('/academic/divisions');
    await page.getByRole('button', { name: 'Actions for Class 1 A' }).click();
    await page.getByRole('menuitem', { name: 'Change class teacher' }).click();
    dialog = page.getByRole('dialog', { name: /Change class teacher/ });
    await dialog.getByLabel(/Teacher/).selectOption({ label: 'Ravi Kumar · TCH-000002' });
    await expect(dialog.getByRole('button', { name: 'Change teacher' })).toBeDisabled(); // reason first
    await dialog.getByLabel(/Reason/).fill('Asha moves to Class 2');
    await dialog.getByRole('button', { name: 'Change teacher' }).click();
    await expect(page.getByText('Class teacher: Ravi Kumar')).toBeVisible();

    await page.getByRole('button', { name: 'Actions for Class 1 A' }).click();
    await page.getByRole('menuitem', { name: 'Class teacher history' }).click();
    dialog = page.getByRole('dialog', { name: /Class teacher history/ });
    await expect(dialog.getByRole('listitem')).toHaveCount(2);
    await expect(dialog).toContainText('Asha Mehta');
    await expect(dialog).toContainText('Changed');
    await expect(dialog).toContainText('Current');
    await expectNoA11yViolations(page, 'class teacher history');
  });
});
