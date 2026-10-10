import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { get, getPage, send } from '../../lib/api';
import type { AdjustmentRow } from '../fees/api';
import type { FeeStatus, FeeSummary, InstallmentRow, PaymentRow } from '../fees/types';
import type { ReminderRow } from '../receivables/api';

export type StudentStatus = 'ACTIVE' | 'INACTIVE' | 'PASSED_OUT';

export interface StudentRow {
  id: string;
  studentId: string;
  admissionNo: string;
  name: string;
  classId: string;
  divisionId: string;
  classLabel: string;
  guardian: string;
  mobile?: string;
  categoryName: string;
  status: StudentStatus;
  feeStatus: FeeStatus;
  outstanding: number;
  roll: number;
}

export interface StudentFilters {
  q?: string;
  classId?: string;
  divisionId?: string;
  feeStatus?: string;
  categoryCode?: string;
  status?: string;
}

export interface StudentProfile {
  id: string;
  studentId: string;
  admissionNo: string;
  name: string;
  gender: 'MALE' | 'FEMALE';
  dob: string;
  address: string;
  admissionDate: string;
  status: StudentStatus;
  classId: string;
  className: string;
  divisionName: string;
  classLabel: string;
  roll: number;
  categoryName: string;
  concession: number;
  guardian: { name: string; mobile: string; email: string };
  fee: FeeSummary;
  installments: InstallmentRow[];
  otherReceivables: { label: string; dueDate: string; amount: number; paid: number }[];
  history: {
    year: string;
    classLabel: string;
    outcome: 'Current' | 'Promoted';
    payable: number;
    paid: number;
  }[];
  payments: PaymentRow[];
  reminders: ReminderRow[];
  adjustments: AdjustmentRow[];
}

export interface FeePreview {
  lines: { code: string; label: string; amount: number }[];
  admission: number;
  gross: number;
  concession: number;
  payable: number;
  openingBalance: number;
  total: number;
  instalments: { no: number; dueDate: string; amount: number }[];
}

export interface NewStudent {
  name: string;
  gender: 'MALE' | 'FEMALE';
  dob: string;
  guardianName: string;
  mobile: string;
  email?: string;
  classId: string;
  divisionId: string;
  categoryCode: string;
  /** paise owed from before this system; recorded as its own dated item */
  openingBalance: number;
}

export const qk = {
  all: ['students'] as const,
  list: (f: StudentFilters, page: number) => ['students', 'list', f, page] as const,
  one: (id: string) => ['students', 'one', id] as const,
};

export const useStudents = (filters: StudentFilters, page: number, pageSize = 15) =>
  useQuery({
    queryKey: qk.list(filters, page),
    placeholderData: keepPreviousData,
    queryFn: async () => {
      const r = await getPage<StudentRow>('/students', { ...filters, page, pageSize });
      return { rows: r.data, total: Number(r.meta?.total ?? r.data.length) };
    },
  });

/** search-as-you-type for the fee counter: nothing is requested until two letters are typed */
export const useStudentSearch = (q: string) =>
  useQuery({
    queryKey: ['students', 'search', q],
    enabled: q.trim().length >= 2,
    queryFn: async () =>
      (
        await getPage<StudentRow>('/students', {
          q: q.trim(),
          page: 1,
          pageSize: 8,
          status: 'ACTIVE',
        })
      ).data,
  });

export const useStudent = (id: string | undefined) =>
  useQuery({
    queryKey: qk.one(id ?? ''),
    enabled: !!id,
    queryFn: () => get<StudentProfile>(`/students/${id}`),
  });

export const useFeePreview = (p: {
  classId: string;
  categoryCode: string;
  openingBalance: number;
}) =>
  useQuery({
    queryKey: ['students', 'fee-preview', p],
    enabled: !!p.classId,
    placeholderData: keepPreviousData,
    queryFn: () => get<FeePreview>('/students/fee-preview', p),
  });

/** the server decides how an amount would be split across instalments (oldest due first) */
export const useAllocationPreview = (studentId: string, amount: number) =>
  useQuery({
    queryKey: ['students', 'allocation', studentId, amount],
    enabled: !!studentId && amount > 0,
    placeholderData: keepPreviousData,
    queryFn: () =>
      get<{
        lines: { installmentNo: number; label: string; amount: number }[];
        allocated: number;
        balanceAfter: number;
      }>(`/students/${studentId}/allocation-preview`, { amount }),
  });

export function useCreateStudent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: NewStudent) =>
      send<{ id: string; studentId: string; name: string }>('POST', '/students', v),
    onSuccess: () => qc.invalidateQueries(),
  });
}

export function usePromote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { studentIds: string[]; toClassId: string; toDivisionId: string }) =>
      send<{ promoted: number }>('POST', '/promotions', v),
    onSuccess: () => qc.invalidateQueries(),
  });
}
