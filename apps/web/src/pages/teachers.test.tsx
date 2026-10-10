import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Toaster } from 'sonner';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuth } from '../features/auth/auth';
import { setAccessToken } from '../lib/api';
import { principal, renderPage, signInAs, stubApi } from '../test/render';
import DivisionsPage from './DivisionsPage';
import TeachersPage from './TeachersPage';

const TEACHERS = [
  {
    id: 't1',
    teacherCode: 'TCH-000001',
    staffId: 'EMP-1',
    fullName: 'Asha Mehta',
    mobile: '9876543210',
    joiningDate: '2020-06-01',
    status: 'ACTIVE',
  },
  {
    id: 't2',
    teacherCode: 'TCH-000002',
    staffId: 'EMP-2',
    fullName: 'Ravi Kumar',
    mobile: '9876543211',
    joiningDate: '2021-06-01',
    status: 'ACTIVE',
  },
  {
    id: 't3',
    teacherCode: 'TCH-000003',
    staffId: 'EMP-3',
    fullName: 'Left Person',
    mobile: '9876543212',
    joiningDate: '2015-06-01',
    status: 'LEFT',
    leavingDate: '2025-03-31',
  },
];
const YEAR = {
  id: 'y26',
  label: '2026-27',
  startDate: '2026-04-01',
  endDate: '2027-03-31',
  status: 'ACTIVE',
  isCurrent: true,
};
const CLASS = { id: 'c1', code: '1', name: 'Class 1', sequence: 1, isActive: true, isFinal: false };
const DIVS = [
  { id: 'dA', academicYearId: 'y26', classId: 'c1', name: 'A', isActive: true },
  { id: 'dB', academicYearId: 'y26', classId: 'c1', name: 'B', isActive: true },
];
const ASSIGNMENT = {
  id: 'a1',
  academicYearId: 'y26',
  classId: 'c1',
  divisionId: 'dA',
  teacherId: 't1',
  effectiveFrom: '2026-04-01',
  effectiveTo: null,
  isCurrent: true,
};

beforeEach(() => {
  setAccessToken('t');
  useAuth.getState().set('booting', null);
});
afterEach(() => vi.unstubAllGlobals());

describe('teachers page', () => {
  it('lists teachers with status, and passes the search and status filters to the server', async () => {
    signInAs(principal(['teacher.view']));
    const calls = stubApi({ 'GET /teachers': () => ({ body: { data: TEACHERS } }) });
    renderPage(<TeachersPage />);
    expect(await screen.findByText('Asha Mehta')).toBeInTheDocument();
    expect(screen.getByText('Left Person')).toBeInTheDocument();
    expect(screen.getAllByText('Left').length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: /New teacher/ })).not.toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Search teachers'), 'asha');
    await userEvent.selectOptions(screen.getByLabelText('Status'), 'ACTIVE');
    await waitFor(() =>
      expect(calls.filter((c) => c.key === 'GET /teachers').length).toBeGreaterThan(2),
    );
  });

  it('validates the new-teacher form before calling the server, then creates', async () => {
    signInAs(principal(['teacher.view', 'teacher.create']));
    const calls = stubApi({
      'GET /teachers': () => ({ body: { data: [] } }),
      'POST /teachers': () => ({ status: 201, body: { data: TEACHERS[0] } }),
    });
    renderPage(<TeachersPage />);
    await userEvent.click(await screen.findByRole('button', { name: 'Add first teacher' }));
    await userEvent.click(screen.getByRole('button', { name: 'Add teacher' }));
    expect(await screen.findByText('Enter the full name')).toBeInTheDocument();
    expect(screen.getByText('Enter the staff ID')).toBeInTheDocument();
    expect(screen.getByText('Enter a 10-digit mobile number')).toBeInTheDocument();
    expect(calls.some((c) => c.key === 'POST /teachers')).toBe(false);

    await userEvent.type(screen.getByLabelText(/Full name/), 'Asha Mehta');
    await userEvent.type(screen.getByLabelText(/Staff ID/), 'EMP-1');
    await userEvent.type(screen.getByLabelText(/Mobile/), '98765 43210');
    await userEvent.type(screen.getByLabelText(/Joining date/), '2020-06-01');
    await userEvent.click(screen.getByRole('button', { name: 'Add teacher' }));
    await waitFor(() =>
      expect(calls.find((c) => c.key === 'POST /teachers')?.body).toEqual({
        fullName: 'Asha Mehta',
        staffId: 'EMP-1',
        mobile: '98765 43210',
        joiningDate: '2020-06-01',
      }),
    );
  });

  it('shows the server message when a teacher still holds a division', async () => {
    signInAs(principal(['teacher.view', 'teacher.deactivate']));
    stubApi({
      'GET /teachers': () => ({ body: { data: [TEACHERS[0]] } }),
      'POST /teachers/t1/status': () => ({
        status: 409,
        body: {
          error: {
            code: 'TEACHER_HAS_ASSIGNMENTS',
            message:
              'Asha Mehta is class teacher of division A (2026-27). Change or end that assignment first.',
          },
        },
      }),
    });
    renderPage(
      <>
        <TeachersPage />
        <Toaster />
      </>,
    );
    await userEvent.click(await screen.findByRole('button', { name: 'Actions for Asha Mehta' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Switch off' }));
    expect(await screen.findByText(/is class teacher of division A/)).toBeInTheDocument();
  });
});

describe('class teachers on the divisions page', () => {
  const stubs = (assignments: object[] = [ASSIGNMENT]) => ({
    'GET /academic-years': () => ({ body: { data: [YEAR] } }),
    'GET /classes': () => ({ body: { data: [CLASS] } }),
    'GET /divisions': () => ({ body: { data: DIVS } }),
    'GET /teachers': () => ({ body: { data: TEACHERS } }),
    'GET /teacher-assignments': () => ({ body: { data: assignments } }),
  });
  const perms = [
    'division.view',
    'class.view',
    'teacher.view',
    'teacherAssignment.view',
    'teacherAssignment.assign',
    'teacherAssignment.change',
  ];

  it('shows each division’s class teacher, and flags divisions that have none', async () => {
    signInAs(principal(perms));
    stubApi(stubs());
    renderPage(<DivisionsPage />);
    expect(await screen.findByText('Asha Mehta')).toBeInTheDocument();
    expect(screen.getByText('No class teacher yet')).toBeInTheDocument();
  });

  it('assigns a class teacher to a division that has none (only active teachers are offered)', async () => {
    signInAs(principal([...perms, 'division.manage']));
    const calls = stubApi({
      ...stubs(),
      'POST /teacher-assignments': () => ({ status: 201, body: { data: ASSIGNMENT } }),
    });
    renderPage(<DivisionsPage />);
    await userEvent.click(await screen.findByRole('button', { name: 'Actions for Class 1 B' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Assign class teacher' }));
    const dialog = await screen.findByRole('dialog');
    const select = within(dialog).getByLabelText(/Teacher/);
    expect(within(select).queryByText(/Left Person/)).not.toBeInTheDocument();
    await userEvent.selectOptions(select, 't2');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Assign' }));
    await waitFor(() =>
      expect(calls.find((c) => c.key === 'POST /teacher-assignments')?.body).toMatchObject({
        divisionId: 'dB',
        teacherId: 't2',
      }),
    );
  });

  it('change needs a reason and offers everyone except the current class teacher', async () => {
    signInAs(principal([...perms, 'division.manage']));
    const calls = stubApi({
      ...stubs(),
      'POST /teacher-assignments/a1/change': () => ({ body: { data: ASSIGNMENT } }),
    });
    renderPage(<DivisionsPage />);
    await userEvent.click(await screen.findByRole('button', { name: 'Actions for Class 1 A' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Change class teacher' }));
    const dialog = await screen.findByRole('dialog');
    const select = within(dialog).getByLabelText(/Teacher/);
    expect(within(select).queryByText(/Asha Mehta/)).not.toBeInTheDocument();
    await userEvent.selectOptions(select, 't2');
    const submit = within(dialog).getByRole('button', { name: 'Change teacher' });
    expect(submit).toBeDisabled();
    await userEvent.type(within(dialog).getByLabelText(/Reason/), 'Transferred to Class 2');
    await userEvent.click(submit);
    await waitFor(() =>
      expect(
        calls.find((c) => c.key === 'POST /teacher-assignments/a1/change')?.body,
      ).toMatchObject({
        newTeacherId: 't2',
        reason: 'Transferred to Class 2',
      }),
    );
  });

  it('a view-only user sees class teachers but no change actions', async () => {
    signInAs(principal(['division.view', 'class.view', 'teacher.view', 'teacherAssignment.view']));
    stubApi(stubs());
    renderPage(<DivisionsPage />);
    expect(await screen.findByText('Asha Mehta')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Actions for Class 1 A' }));
    expect(
      await screen.findByRole('menuitem', { name: 'Class teacher history' }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('menuitem', { name: 'Change class teacher' }),
    ).not.toBeInTheDocument();
  });
});
