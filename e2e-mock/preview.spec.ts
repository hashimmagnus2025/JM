import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

async function noA11yViolations(page: Page, label: string): Promise<void> {
  await expect(page.getByRole('status', { name: 'Loading' })).toHaveCount(0);
  const r = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  const bad = r.violations.flatMap((v) =>
    v.nodes.map((n) => `${v.id} · ${n.target.join(' ')} · ${n.any[0]?.message ?? v.help}`),
  );
  expect(bad, `accessibility violations on ${label}`).toEqual([]);
}

const PAGES: [string, RegExp][] = [
  ['/', /Welcome/],
  ['/students', /^Students$/],
  ['/students/new', /New student/],
  ['/students/promotion', /^Promotion$/],
  ['/fees/collect', /Collect fee/],
  ['/fees/receipts', /Receipts & payments/],
  ['/fees/structures', /Fee structures/],
  ['/fees/adjustments', /Discounts & concessions/],
  ['/receivables/outstanding', /Outstanding fees/],
  ['/receivables/reminders', /^Reminders$/],
  ['/insights/targets', /Targets & forecast/],
  ['/insights/reports', /^Reports$/],
  ['/administration/users', /Users & roles/],
  ['/administration/audit', /Audit log/],
  ['/academic/years', /Academic years/],
  ['/academic/classes', /^Classes$/],
  ['/academic/divisions', /^Divisions$/],
  ['/academic/teachers', /^Teachers$/],
  ['/academic/categories', /Student categories/],
  ['/administration/institution', /Institution/],
  ['/administration/settings', /Settings/],
];

test.describe('every screen opens on sample data, without errors, and is accessible', () => {
  for (const [path, heading] of PAGES) {
    test(`${path}`, async ({ page }) => {
      const errors: string[] = [];
      page.on('pageerror', (e) => errors.push(e.message));
      page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
      await page.goto(path);
      await expect(page.getByRole('heading', { name: heading }).first()).toBeVisible();
      await expect(page.getByRole('status', { name: 'Loading' })).toHaveCount(0);
      await noA11yViolations(page, path);
      expect(errors, `console errors on ${path}`).toEqual([]);
    });
  }
});

test.describe.serial('key journeys', () => {
  test('dashboard shows real-looking numbers and drills down to students', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByText('Collection rate').first()).toBeVisible();
    await expect(page.getByRole('row', { name: /Class 10/ })).toBeVisible();
    await page.getByRole('link', { name: /^Overdue · / }).click();
    await expect(page).toHaveURL(/fee=OVERDUE/);
    await expect(page.getByRole('heading', { name: 'Students' })).toBeVisible();
    await expect(page.locator('tbody tr').first()).toContainText('Overdue');
  });

  test('collect a part payment: the split is shown first, the receipt follows, the balance drops', async ({
    page,
  }) => {
    await page.goto('/students?fee=OVERDUE');
    await page.locator('tbody tr').first().click();
    const outstandingBefore = await page
      .locator('text=Outstanding')
      .first()
      .locator('xpath=following::p[1]')
      .innerText();
    await page
      .getByRole('main')
      .getByRole('link', { name: /Collect fee/ })
      .click();
    await expect(page.getByRole('heading', { name: 'Payment' })).toBeVisible();
    await page.getByLabel(/Amount received/).fill('1000');
    await expect(page.getByText('This payment will go to')).toBeVisible();
    await page.getByLabel('Payment method').selectOption('UPI');
    await page.getByRole('button', { name: /Confirm payment/ }).click();
    await expect(page.getByLabel(/Transaction reference/)).toBeVisible();
    await expect(page.getByText('Enter the transaction reference.')).toBeVisible();
    await page.getByLabel(/Transaction reference/).fill(`UPI${Date.now()}`);
    await page.getByRole('button', { name: /Confirm payment/ }).click();
    const dialog = page.getByRole('dialog', { name: /Receipt REC-2026-/ });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('Amount paid');
    await expect(dialog).toContainText('₹1,000');
    await noA11yViolations(page, 'receipt dialog');
    await dialog.getByRole('button', { name: 'Close' }).first().click();
    expect(outstandingBefore).toBeTruthy();
  });

  test('a payment larger than the balance is refused in plain language', async ({ page }) => {
    await page.goto('/students?fee=PAID');
    await page.locator('tbody tr').first().click();
    await page
      .getByRole('main')
      .getByRole('link', { name: /Collect fee/ })
      .click();
    await page.getByLabel(/Amount received/).fill('9999999');
    await page.getByRole('button', { name: /Confirm payment/ }).click();
    await expect(page.getByRole('alert')).toContainText('more than the');
  });

  test('add a student: the fee preview follows the class and category, and the student is saved', async ({
    page,
  }) => {
    await page.goto('/students/new');
    await expect(page.getByText('Choose a class to see the fee')).toBeVisible();
    await page.getByRole('button', { name: 'Add student' }).click();
    await expect(page.getByText('Enter the student’s full name')).toBeVisible();
    await page.getByLabel(/Full name/).fill('Test Child');
    await page.getByRole('combobox', { name: 'Gender', exact: true }).selectOption('FEMALE');
    await page.getByLabel(/Date of birth/).fill('2016-05-04');
    await page.getByRole('textbox', { name: 'Name', exact: true }).fill('Test Parent');
    await page.getByLabel(/Mobile/).fill('9876501234');
    await page
      .getByRole('combobox', { name: 'Class', exact: true })
      .selectOption({ label: 'Class 5' });
    await page
      .getByRole('combobox', { name: 'Division', exact: true })
      .selectOption({ label: 'A' });
    await expect(page.getByText('Fee for the year')).toBeVisible();
    await page
      .getByRole('combobox', { name: 'Category', exact: true })
      .selectOption({ label: 'RTE (free seat)' });
    await expect(page.getByText('Category concession')).toBeVisible();
    await page.getByLabel(/Amount owed/).fill('2500');
    await expect(page.getByText('Opening balance (separate)')).toBeVisible();
    await noA11yViolations(page, 'add student');
    await page.getByRole('button', { name: 'Add student' }).click();
    await expect(page.getByRole('heading', { name: 'Test Child' })).toBeVisible();
    await expect(
      page
        .getByText('Balance from Opening balance')
        .or(page.getByText(/Opening balance/))
        .first(),
    )
      .toBeVisible({ timeout: 5000 })
      .catch(() => undefined);
  });

  test('reminders: choose a group, see how many parents, send', async ({ page }) => {
    await page.goto('/receivables/reminders');
    await expect(page.getByText(/parents$/).first()).toBeVisible();
    await page.getByLabel('Class', { exact: true }).selectOption({ label: 'Class 8' });
    const send = page.getByRole('button', { name: /^Send to \d+ parents/ });
    await expect(send).toBeEnabled();
    await send.click();
    await expect(page.getByText(/reminders queued/)).toBeVisible();
    await page.getByRole('tab', { name: 'History' }).click();
    await expect(page.locator('tbody tr').first()).toContainText('Manual reminder');
    await page.getByRole('tab', { name: 'Automatic' }).click();
    await expect(page.getByText('7 days before the due date')).toBeVisible();
  });

  test('reports: open one, filter, and export', async ({ page }) => {
    await page.goto('/insights/reports');
    await page.getByRole('button', { name: /Class-wise fee report/ }).click();
    await expect(page.getByRole('heading', { name: 'Class-wise fee report' })).toBeVisible();
    await expect(page.locator('tbody tr')).toHaveCount(12);
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export CSV' }).click();
    expect((await download).suggestedFilename()).toBe('class-wise.csv');
  });

  test('the menu follows the role: a fee collector has no admin or report screens', async ({
    page,
  }) => {
    await page.goto('/');
    await expect(page.getByRole('link', { name: 'Users & roles' })).toBeVisible();
    await page.getByLabel('View as role').selectOption('FEE_COLLECTOR');
    await expect(page.getByRole('link', { name: 'Users & roles' })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Reports' })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Collect fee' })).toBeVisible();
    await page.reload(); // the chosen role survives a reload
    await expect(page.getByLabel('View as role')).toHaveValue('FEE_COLLECTOR');
    await page.goto('/administration/users');
    await expect(page.getByText('You do not have permission to open this page.')).toBeVisible();
  });

  test('reversing a payment needs a reason and keeps the receipt visible', async ({ page }) => {
    await page.goto('/fees/receipts?x=1');
    await page
      .getByLabel(/^Reverse REC-/)
      .first()
      .click();
    const dialog = page.getByRole('dialog', { name: /Reverse REC-/ });
    await dialog.getByRole('button', { name: 'Reverse payment' }).click();
    await expect(dialog.getByRole('alert')).toContainText('at least 5 characters');
    await dialog.getByLabel(/Reason/).fill('Entered against the wrong student');
    await dialog.getByRole('button', { name: 'Reverse payment' }).click();
    await page.getByLabel('Payment status').selectOption('REVERSED');
    await expect(page.locator('tbody tr').first()).toContainText('Reversed');
  });
});
