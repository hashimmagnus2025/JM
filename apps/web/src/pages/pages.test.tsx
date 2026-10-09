import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RequireAuth } from '../app/router';
import { useAuth } from '../features/auth/auth';
import { setAccessToken } from '../lib/api';
import { principal, renderPage, signInAs, stubApi } from '../test/render';
import AcademicYearsPage from './AcademicYearsPage';
import CategoriesPage from './CategoriesPage';
import LoginPage from './LoginPage';

const YEARS = [
  {
    id: 'y27',
    label: '2027-28',
    startDate: '2027-04-01',
    endDate: '2028-03-31',
    status: 'PLANNED',
    isCurrent: false,
  },
  {
    id: 'y26',
    label: '2026-27',
    startDate: '2026-04-01',
    endDate: '2027-03-31',
    status: 'ACTIVE',
    isCurrent: true,
  },
  {
    id: 'y25',
    label: '2025-26',
    startDate: '2025-04-01',
    endDate: '2026-03-31',
    status: 'CLOSED',
    isCurrent: false,
  },
];

beforeEach(() => {
  setAccessToken('t');
  useAuth.getState().set('booting', null);
});
afterEach(() => vi.unstubAllGlobals());

describe('login page', () => {
  it('validates before calling the server and shows field messages', async () => {
    const calls = stubApi({});
    renderPage(<LoginPage />, '/login');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText('Enter your e-mail')).toBeInTheDocument();
    expect(screen.getByText('Enter your password')).toBeInTheDocument();
    expect(calls).toHaveLength(0);
    await userEvent.type(screen.getByLabelText(/E-mail/), 'not-an-email');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText('Enter a valid e-mail')).toBeInTheDocument();
  });

  it('shows a friendly message for wrong credentials and keeps the user on the page', async () => {
    stubApi({
      'POST /auth/login': () => ({
        status: 401,
        body: { error: { code: 'INVALID_CREDENTIALS', message: 'x' } },
      }),
    });
    renderPage(<LoginPage />, '/login');
    await userEvent.type(screen.getByLabelText(/E-mail/), 'a@school.test');
    await userEvent.type(screen.getByLabelText(/Password/), 'wrong');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The e-mail or password is not correct.',
    );
    expect(useAuth.getState().status).not.toBe('authed');
  });

  it('signs in: stores the principal and never writes the token to storage', async () => {
    stubApi({
      'POST /auth/login': () => ({
        body: {
          data: {
            accessToken: 'secret-token',
            expiresIn: 900,
            user: { id: 'u1', name: 'A', email: 'a@a', roleKeys: [], mustChangePassword: false },
          },
        },
      }),
      'GET /auth/me': () => ({ body: { data: principal(['academicYear.view']) } }),
    });
    renderPage(
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/" element={<p>HOME</p>} />
      </Routes>,
      '/login',
    );
    await userEvent.type(screen.getByLabelText(/E-mail/), 'asha@school.test');
    await userEvent.type(screen.getByLabelText(/Password/), 'Correct-Horse-42!');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText('HOME')).toBeInTheDocument();
    expect(
      JSON.stringify([...Object.entries(localStorage), ...Object.entries(sessionStorage)]),
    ).not.toContain('secret-token');
  });
});

describe('route guard', () => {
  it('sends a signed-out visitor to the login page', async () => {
    useAuth.getState().set('anon', null);
    renderPage(
      <Routes>
        <Route path="/login" element={<p>LOGIN</p>} />
        <Route element={<RequireAuth />}>
          <Route path="/" element={<p>SECRET</p>} />
        </Route>
      </Routes>,
    );
    expect(await screen.findByText('LOGIN')).toBeInTheDocument();
    expect(screen.queryByText('SECRET')).not.toBeInTheDocument();
  });

  it('locks a user with a temporary password onto the change-password page', async () => {
    stubApi({});
    signInAs(principal([], { mustChangePassword: true }));
    renderPage(
      <Routes>
        <Route element={<RequireAuth />}>
          <Route path="/" element={<p>DASH</p>} />
          <Route path="/change-password" element={<p>CHANGE</p>} />
        </Route>
      </Routes>,
    );
    expect(
      await screen.findByRole('heading', { name: 'Choose a new password' }),
    ).toBeInTheDocument();
    expect(screen.queryByText('DASH')).not.toBeInTheDocument();
  });
});

describe('academic years page', () => {
  const api = () => stubApi({ 'GET /academic-years': () => ({ body: { data: YEARS } }) });

  it('lists years with status and a Current marker', async () => {
    api();
    signInAs(principal(['academicYear.view']));
    renderPage(<AcademicYearsPage />);
    const row = await screen.findByRole('row', { name: /2026-27/ });
    expect(within(row).getByText('Current')).toBeInTheDocument();
    expect(within(row).getByText('Active')).toBeInTheDocument();
    expect(screen.getByRole('row', { name: /2025-26/ })).toHaveTextContent('Closed');
    expect(screen.getByRole('row', { name: /2027-28/ })).toHaveTextContent('Planned');
    expect(screen.getByText('1 Apr 2026 – 31 Mar 2027')).toBeInTheDocument();
  });

  it('a view-only user sees no create button and no row actions', async () => {
    api();
    signInAs(principal(['academicYear.view']));
    renderPage(<AcademicYearsPage />);
    await screen.findByText('2026-27');
    expect(screen.queryByRole('button', { name: /New academic year/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Actions for/ })).not.toBeInTheDocument();
  });

  it('a manager can create a year pre-filled with the suggestion; the request carries the typed values', async () => {
    const calls = stubApi({
      'GET /academic-years': () => ({ body: { data: [] } }),
      'GET /academic-years/suggest-next': () => ({
        body: { data: { label: '2026-27', startDate: '2026-04-01', endDate: '2027-03-31' } },
      }),
      'POST /academic-years': (b) => ({
        status: 201,
        body: { data: { id: 'new', status: 'PLANNED', isCurrent: false, ...(b as object) } },
      }),
    });
    signInAs(principal(['academicYear.view', 'academicYear.manage']));
    renderPage(<AcademicYearsPage />);
    expect(await screen.findByText('No academic years yet')).toBeInTheDocument();
    await userEvent.click(
      screen.getAllByRole('button', { name: /academic year/i })[0] as HTMLElement,
    );
    const dialog = await screen.findByRole('dialog', { name: 'New academic year' });
    await waitFor(() => expect(within(dialog).getByLabelText(/Name/)).toHaveValue('2026-27'));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create year' }));
    await waitFor(() =>
      expect(calls.find((c) => c.key === 'POST /academic-years')?.body).toEqual({
        label: '2026-27',
        startDate: '2026-04-01',
        endDate: '2027-03-31',
      }),
    );
  });

  it("shows the server's overlap error in plain language and keeps the dialog open", async () => {
    stubApi({
      'GET /academic-years': () => ({ body: { data: YEARS } }),
      'GET /academic-years/suggest-next': () => ({
        body: { data: { label: '2028-29', startDate: '2028-04-01', endDate: '2029-03-31' } },
      }),
      'POST /academic-years': () => ({
        status: 422,
        body: { error: { code: 'YEAR_OVERLAP', message: 'overlap' } },
      }),
    });
    signInAs(principal(['academicYear.view', 'academicYear.manage']));
    renderPage(<AcademicYearsPage />);
    await screen.findByText('2026-27');
    await userEvent.click(screen.getByRole('button', { name: /New academic year/ }));
    const dialog = await screen.findByRole('dialog');
    await waitFor(() => expect(within(dialog).getByLabelText(/Name/)).toHaveValue('2028-29'));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create year' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'These dates overlap with another academic year.',
    );
  });

  it('row actions follow the year state and permissions (closed → reopen; current → no close)', async () => {
    api();
    signInAs(principal(['academicYear.view', 'academicYear.manage', 'academicYear.close']));
    renderPage(<AcademicYearsPage />);
    await screen.findByText('2026-27');
    await userEvent.click(screen.getByRole('button', { name: 'Actions for 2025-26' }));
    expect(await screen.findByRole('menuitem', { name: /Reopen year/ })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Close year' })).not.toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    // the current year is active and current: nothing is allowed on it (it cannot be closed or sent back), so no menu at all
    expect(screen.queryByRole('button', { name: 'Actions for 2026-27' })).not.toBeInTheDocument();
    // a planned year can be edited, activated and made current
    await userEvent.click(screen.getByRole('button', { name: 'Actions for 2027-28' }));
    for (const name of [/Edit dates and name/, 'Activate', /Make this the current year/])
      expect(await screen.findByRole('menuitem', { name })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Close year' })).not.toBeInTheDocument();
  });

  it('closing needs a reason (the confirm button stays disabled until one is typed)', async () => {
    const calls = stubApi({
      'GET /academic-years': () => ({ body: { data: [{ ...YEARS[0], status: 'ACTIVE' }] } }),
      'POST /academic-years/y27/close': () => ({
        body: { data: { ...YEARS[0], status: 'CLOSED' } },
      }),
    });
    signInAs(principal(['academicYear.view', 'academicYear.close']));
    renderPage(<AcademicYearsPage />);
    await screen.findByText('2027-28');
    await userEvent.click(screen.getByRole('button', { name: 'Actions for 2027-28' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Close year' }));
    const dialog = await screen.findByRole('dialog', { name: /Close 2027-28/ });
    const confirm = within(dialog).getByRole('button', { name: 'Close year' });
    expect(confirm).toBeDisabled();
    await userEvent.type(within(dialog).getByLabelText(/Reason/), 'ok');
    expect(confirm).toBeDisabled(); // too short
    await userEvent.type(within(dialog).getByLabelText(/Reason/), ' year ended');
    expect(confirm).toBeEnabled();
    await userEvent.click(confirm);
    await waitFor(() =>
      expect(calls.find((c) => c.key === 'POST /academic-years/y27/close')?.body).toEqual({
        reason: 'ok year ended',
      }),
    );
  });

  it('API failure shows a retryable error, not a blank page', async () => {
    stubApi({
      'GET /academic-years': () => ({
        status: 500,
        body: {
          error: {
            code: 'INTERNAL_ERROR',
            message: 'Something went wrong. Please try again.',
            requestId: 'req-9',
          },
        },
      }),
    });
    signInAs(principal(['academicYear.view']));
    renderPage(<AcademicYearsPage />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Something went wrong');
    expect(screen.getByText('Reference: req-9')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });

  it('403 from the API explains the missing permission', async () => {
    stubApi({
      'GET /academic-years': () => ({
        status: 403,
        body: { error: { code: 'FORBIDDEN', message: 'no' } },
      }),
    });
    signInAs(principal([]));
    renderPage(<AcademicYearsPage />);
    expect(await screen.findByRole('alert')).toHaveTextContent('You do not have permission');
  });
});

describe('student categories page', () => {
  it('lists categories with status; managers can add one; the code is upper-cased', async () => {
    const calls = stubApi({
      'GET /student-categories': () => ({
        body: {
          data: [
            { id: 'c1', code: 'GENERAL', name: 'General', isActive: true, sequence: 1 },
            { id: 'c2', code: 'RTE', name: 'RTE seat', isActive: false, sequence: 2 },
          ],
        },
      }),
      'POST /student-categories': (b) => ({
        status: 201,
        body: { data: { id: 'c3', isActive: true, sequence: 3, ...(b as object) } },
      }),
    });
    signInAs(principal(['studentCategory.view', 'studentCategory.manage']));
    renderPage(<CategoriesPage />);
    expect(await screen.findByText('General')).toBeInTheDocument();
    expect(screen.getByText('Switched off')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /New category/ }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText(/Name/), 'Staff ward');
    await userEvent.type(within(dialog).getByLabelText(/Code/), 'staff_ward');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add category' }));
    await waitFor(() =>
      expect(calls.find((c) => c.key === 'POST /student-categories')?.body).toEqual({
        code: 'STAFF_WARD',
        name: 'Staff ward',
      }),
    );
  });

  it('rejects a badly formed code before calling the server', async () => {
    const calls = stubApi({ 'GET /student-categories': () => ({ body: { data: [] } }) });
    signInAs(principal(['studentCategory.view', 'studentCategory.manage']));
    renderPage(<CategoriesPage />);
    await userEvent.click(await screen.findByRole('button', { name: /New category/ }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText(/Name/), 'Bad one');
    await userEvent.type(within(dialog).getByLabelText(/Code/), '1 bad code');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add category' }));
    expect(
      await within(dialog).findByText(/Use letters, digits and underscores/),
    ).toBeInTheDocument();
    expect(calls.some((c) => c.key === 'POST /student-categories')).toBe(false);
  });
});
