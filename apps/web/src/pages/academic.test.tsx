import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuth } from '../features/auth/auth';
import { setAccessToken } from '../lib/api';
import { principal, renderPage, signInAs, stubApi } from '../test/render';
import ClassesPage from './ClassesPage';
import DivisionsPage from './DivisionsPage';

const CLASSES = [
  { id: 'c1', code: '1', name: 'Class 1', sequence: 1, isActive: true, isFinal: false },
  { id: 'c2', code: '2', name: 'Class 2', sequence: 2, isActive: true, isFinal: true },
];
const YEARS = [
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

describe('classes page', () => {
  it('lists classes in order and sends the full new order when one moves up', async () => {
    signInAs(principal(['class.view', 'class.manage']));
    const calls = stubApi({
      'GET /classes': () => ({ body: { data: CLASSES } }),
      'PUT /classes/order': () => ({ body: { data: [CLASSES[1], CLASSES[0]] } }),
    });
    renderPage(<ClassesPage />);
    expect(await screen.findByText('Class 1')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Move Class 1 up' })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: 'Move Class 2 up' }));
    await waitFor(() =>
      expect(calls.find((c) => c.key === 'PUT /classes/order')?.body).toEqual({
        ids: ['c2', 'c1'],
      }),
    );
  });

  it('view-only users get no add or reorder controls', async () => {
    signInAs(principal(['class.view']));
    stubApi({ 'GET /classes': () => ({ body: { data: CLASSES } }) });
    renderPage(<ClassesPage />);
    expect(await screen.findByText('Class 1')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /New class/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Move Class/ })).not.toBeInTheDocument();
  });

  it('validates the new-class form and shows the server message for a duplicate code', async () => {
    signInAs(principal(['class.view', 'class.manage']));
    stubApi({
      'GET /classes': () => ({ body: { data: [] } }),
      'POST /classes': () => ({
        status: 409,
        body: {
          error: { code: 'CLASS_CODE_IN_USE', message: 'A class with this code already exists.' },
        },
      }),
    });
    renderPage(<ClassesPage />);
    await userEvent.click(await screen.findByRole('button', { name: 'Add first class' }));
    await userEvent.click(screen.getByRole('button', { name: 'Add class' }));
    expect(await screen.findByText('Enter a name')).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText(/Name/), 'Class 1');
    await userEvent.type(screen.getByLabelText(/Code/), '1');
    await userEvent.click(screen.getByRole('button', { name: 'Add class' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'A class with this code already exists.',
    );
  });
});

describe('divisions page', () => {
  it('shows the current year divisions grouped by class and adds one', async () => {
    signInAs(principal(['division.view', 'division.manage', 'class.view']));
    const calls = stubApi({
      'GET /academic-years': () => ({ body: { data: YEARS } }),
      'GET /classes': () => ({ body: { data: CLASSES } }),
      'GET /divisions': () => ({
        body: {
          data: [
            {
              id: 'd1',
              academicYearId: 'y26',
              classId: 'c1',
              name: 'A',
              capacity: 40,
              isActive: true,
            },
          ],
        },
      }),
      'POST /divisions': () => ({ status: 201, body: { data: {} } }),
    });
    renderPage(<DivisionsPage />);
    expect(await screen.findByText('Division A')).toBeInTheDocument();
    expect(screen.getByText('Capacity 40')).toBeInTheDocument();
    await userEvent.click(screen.getAllByRole('button', { name: /Add/ })[1]!);
    await userEvent.type(screen.getByLabelText(/Division name/), 'B');
    await userEvent.type(screen.getByLabelText(/Capacity/), '35');
    await userEvent.click(screen.getByRole('button', { name: 'Add division' }));
    await waitFor(() =>
      expect(calls.find((c) => c.key === 'POST /divisions')?.body).toEqual({
        academicYearId: 'y26',
        classId: 'c2',
        name: 'B',
        capacity: 35,
      }),
    );
  });

  it('rejects a capacity that is not a whole number before calling the server', async () => {
    signInAs(principal(['division.view', 'division.manage', 'class.view']));
    const calls = stubApi({
      'GET /academic-years': () => ({ body: { data: YEARS } }),
      'GET /classes': () => ({ body: { data: CLASSES } }),
      'GET /divisions': () => ({ body: { data: [] } }),
    });
    renderPage(<DivisionsPage />);
    await userEvent.click(await screen.findByRole('button', { name: /New division/ }));
    await userEvent.selectOptions(screen.getByLabelText(/Class/), 'c1');
    await userEvent.type(screen.getByLabelText(/Division name/), 'A');
    await userEvent.type(screen.getByLabelText(/Capacity/), '2.5');
    await userEvent.click(screen.getByRole('button', { name: 'Add division' }));
    expect(await screen.findByText('Enter 1 to 500, or leave empty')).toBeInTheDocument();
    expect(calls.some((c) => c.key === 'POST /divisions')).toBe(false);
  });

  it('a closed year is read-only', async () => {
    signInAs(principal(['division.view', 'division.manage', 'class.view']));
    stubApi({
      'GET /academic-years': () => ({ body: { data: YEARS } }),
      'GET /classes': () => ({ body: { data: CLASSES } }),
      'GET /divisions': () => ({ body: { data: [] } }),
    });
    renderPage(<DivisionsPage />);
    await userEvent.selectOptions(await screen.findByLabelText('Academic year'), 'y25');
    expect(
      await screen.findByText(/is closed, so its divisions are read-only/),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /New division/ })).not.toBeInTheDocument();
  });

  it('asks for an academic year first when there is none', async () => {
    signInAs(principal(['division.view', 'class.view']));
    stubApi({
      'GET /academic-years': () => ({ body: { data: [] } }),
      'GET /classes': () => ({ body: { data: CLASSES } }),
    });
    renderPage(<DivisionsPage />);
    expect(await screen.findByText('Create an academic year first')).toBeInTheDocument();
  });
});
