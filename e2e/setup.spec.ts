import { fileURLToPath } from 'node:url';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
const HERE = fileURLToPath(new URL('.', import.meta.url));

const creds = (): { email: string; temporaryPassword: string } =>
  JSON.parse(readFileSync(join(HERE, '.e2e-credentials.json'), 'utf8'));
const NEW_PASSWORD = 'Violet-Lamp-2026!';

test.skip(
  !process.env.E2E_MONGO_URI,
  'set E2E_MONGO_URI to a throwaway database to run the end-to-end tests',
);

async function expectNoA11yViolations(page: Page, label: string): Promise<void> {
  const r = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  const bad = r.violations.flatMap((v) =>
    v.nodes.map((n) => `${v.id} · ${n.target.join(' ')} · ${n.any[0]?.message ?? v.help}`),
  );
  expect(bad, `accessibility violations on ${label}`).toEqual([]);
}

test.describe.serial('first-time setup journey', () => {
  test('login page: accessible, validates, and rejects a wrong password in plain language', async ({
    page,
  }) => {
    await page.goto('/');
    await expect(page).toHaveURL(/\/login$/);
    await expectNoA11yViolations(page, 'login');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByText('Enter your e-mail')).toBeVisible();
    await page.getByLabel(/E-mail/).fill(creds().email);
    await page.getByLabel(/Password/).fill('definitely-wrong');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByRole('alert')).toContainText('The e-mail or password is not correct.');
  });

  test('a new user with a temporary password must choose their own before anything else', async ({
    page,
  }) => {
    await page.goto('/login');
    await page.getByLabel(/E-mail/).fill(creds().email);
    await page.getByLabel(/Password/).fill(creds().temporaryPassword);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByRole('heading', { name: 'Choose a new password' })).toBeVisible();
    // trying to open another page bounces back
    await page.goto('/academic/years');
    await expect(page.getByRole('heading', { name: 'Choose a new password' })).toBeVisible();

    await page.getByLabel(/Temporary password/).fill(creds().temporaryPassword);
    await page.getByLabel('New password', { exact: false }).first().fill('short');
    await page.getByLabel(/Repeat new password/).fill('short');
    await page.getByRole('button', { name: 'Save new password' }).click();
    await expect(page.getByText('Use at least 10 characters')).toBeVisible();

    await page.getByLabel('New password', { exact: false }).first().fill(NEW_PASSWORD);
    await page.getByLabel(/Repeat new password/).fill(NEW_PASSWORD);
    await page.getByRole('button', { name: 'Save new password' }).click();
    await expect(page.getByRole('heading', { name: /Welcome, Asha/ })).toBeVisible();
  });

  test('dashboard guides the setup, and the session survives a page reload (silent refresh)', async ({
    page,
  }) => {
    await page.goto('/login');
    await page.getByLabel(/E-mail/).fill(creds().email);
    await page.getByLabel(/Password/).fill(NEW_PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByRole('heading', { name: /Welcome, Asha/ })).toBeVisible();
    await expect(page.getByText('Complete the institution profile')).toBeVisible();
    await expectNoA11yViolations(page, 'dashboard');
    await page.reload();
    await expect(page.getByRole('heading', { name: /Welcome, Asha/ })).toBeVisible(); // cookie → refresh → signed in again
    expect(
      await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage })),
    ).not.toMatch(/eyJ/); // no JWT in storage
  });

  test.describe.serial('after onboarding (signed in with the new password)', () => {
    // every test gets a fresh browser, so each one signs in first
    test.beforeEach(async ({ page }) => {
      await page.goto('/login');
      await page.getByLabel(/E-mail/).fill(creds().email);
      await page.getByLabel(/Password/).fill(NEW_PASSWORD);
      await page.getByRole('button', { name: 'Sign in' }).click();
      await expect(page.getByRole('heading', { name: /Welcome, Asha/ })).toBeVisible();
    });

    test('create an academic year, make it current, and see it on the dashboard', async ({
      page,
    }) => {
      await page.goto('/academic/years');
      await expect(page.getByText('No academic years yet')).toBeVisible();
      await expectNoA11yViolations(page, 'academic years (empty)');
      await page
        .getByRole('button', { name: /New academic year/ })
        .first()
        .click();
      const dialog = page.getByRole('dialog', { name: 'New academic year' });
      await dialog.getByLabel(/Starts on/).fill('2026-04-01');
      await dialog.getByLabel(/Ends on/).fill('2027-03-31');
      await dialog.getByLabel(/Name/).fill('2026-27');
      await dialog.getByRole('button', { name: 'Create year' }).click();
      const row = page.getByRole('row', { name: /2026-27/ });
      await expect(row).toContainText('Planned');

      // overlapping dates are refused in plain language
      await page.getByRole('button', { name: /New academic year/ }).click();
      const d2 = page.getByRole('dialog', { name: 'New academic year' });
      await d2.getByLabel(/Starts on/).fill('2026-10-01');
      await d2.getByLabel(/Ends on/).fill('2027-09-30');
      await d2.getByLabel(/Name/).fill('2026-27');
      await d2.getByRole('button', { name: 'Create year' }).click();
      await expect(d2.getByRole('alert').first()).toBeVisible();
      await d2.getByRole('button', { name: 'Cancel' }).click();

      await page.getByRole('button', { name: 'Actions for 2026-27' }).click();
      await page.getByRole('menuitem', { name: /Make this the current year/ }).click();
      await page.getByRole('button', { name: 'Make current' }).click();
      await expect(row).toContainText('Current');
      await expect(row).toContainText('Active');
      await expectNoA11yViolations(page, 'academic years');

      await page.goto('/');
      await expect(page.getByText('Current academic year:')).toContainText('2026-27');
    });

    test('institution profile can be edited and saved', async ({ page }) => {
      await page.goto('/administration/institution');
      await page.getByLabel(/Institution name/).fill('Jawahar Memorial School');
      await page.getByLabel('City').fill('Nagpur');
      await page.getByLabel('Phone', { exact: true }).fill('0712 2345678');
      await page.getByRole('button', { name: 'Save changes' }).click();
      await expect(page.getByText('Institution details saved')).toBeVisible();
      await page.reload();
      await expect(page.getByLabel(/Institution name/)).toHaveValue('Jawahar Memorial School');
      await expectNoA11yViolations(page, 'institution');
    });

    test('settings: change a rule, see it marked as changed, and reset it', async ({ page }) => {
      await page.goto('/administration/settings');
      // scoped to the page content: the "setting updated" toast is a list item too
      const item = page.locator('main li').filter({ hasText: 'Due-soon window (days)' });
      await expect(item).toContainText('7 days');
      await item.getByRole('button', { name: /Change/ }).click();
      const dialog = page.getByRole('dialog', { name: 'Due-soon window (days)' });
      await dialog.getByLabel(/Number of days/).fill('10');
      await dialog.getByLabel(/Reason/).fill('Parents asked for earlier notice');
      await dialog.getByRole('button', { name: 'Save setting' }).click();
      await expect(item).toContainText('10 days');
      await expect(item).toContainText('Changed');
      await expectNoA11yViolations(page, 'settings');
      await item.getByRole('button', { name: /Use default/ }).click();
      await page.getByRole('dialog').getByRole('button', { name: 'Use default' }).click();
      await expect(item).toContainText('7 days');
    });

    test('student categories: the seeded General category is there; add another', async ({
      page,
    }) => {
      await page.goto('/academic/categories');
      await expect(page.getByText('General', { exact: true })).toBeVisible();
      await page.getByRole('button', { name: /New category/ }).click();
      const dialog = page.getByRole('dialog');
      await dialog.getByLabel(/Name/).fill('RTE seat');
      await dialog.getByLabel(/Code/).fill('rte');
      await dialog.getByRole('button', { name: 'Add category' }).click();
      await expect(page.getByText('RTE seat')).toBeVisible();
    });

    test('sign out ends the session; protected pages bounce to the login', async ({ page }) => {
      await page.goto('/');
      await page.getByRole('button', { name: 'Account menu' }).click();
      await page.getByRole('menuitem', { name: 'Sign out' }).click();
      await expect(page).toHaveURL(/\/login$/);
      await page.goto('/academic/years');
      await expect(page).toHaveURL(/\/login$/);
    });
  });
});
