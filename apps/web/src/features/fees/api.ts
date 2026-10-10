import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { get, getPage, send } from '../../lib/api';
import type { PaymentMethod, PaymentRow, ReceiptData } from './types';

export interface FeeStructureData {
  years: { id: string; label: string }[];
  year: string;
  classId: string;
  className: string;
  status: 'Published' | 'Draft' | 'Locked (year closed)';
  version: number;
  studentCount: number;
  lines: { code: string; label: string; amount: number }[];
  total: number;
  admissionFee: number;
  categoryRates: { code: string; name: string; concessionPct: number; total: number }[];
  instalments: { no: number; dueDate: string; amount: number }[];
}
export const useFeeStructure = (year: string, classId: string) =>
  useQuery({
    queryKey: ['fee-structure', year, classId],
    placeholderData: keepPreviousData,
    queryFn: () => get<FeeStructureData>('/fee-structures', { year, classId }),
  });

export interface PaymentFilters {
  q?: string;
  method?: string;
  status?: string;
  from?: string;
  to?: string;
}
export const usePayments = (f: PaymentFilters, page: number, pageSize = 15) =>
  useQuery({
    queryKey: ['payments', f, page],
    placeholderData: keepPreviousData,
    queryFn: async () => {
      const r = await getPage<PaymentRow>('/payments', { ...f, page, pageSize });
      return {
        rows: r.data,
        total: Number(r.meta?.total ?? 0),
        collected: Number(r.meta?.collected ?? 0),
      };
    },
  });
export const useReceipt = (id: string | null) =>
  useQuery({
    queryKey: ['payments', 'receipt', id],
    enabled: !!id,
    queryFn: () => get<ReceiptData>(`/payments/${id}`),
  });

/** money-moving: the caller supplies one Idempotency-Key per attempt, so a double click can never post twice */
export function useCollectPayment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: {
      studentId: string;
      amount: number;
      method: PaymentMethod;
      reference?: string;
      idempotencyKey: string;
    }) => {
      const { idempotencyKey, ...body } = v;
      return send<ReceiptData>('POST', '/payments', body, { 'Idempotency-Key': idempotencyKey });
    },
    onSuccess: () => qc.invalidateQueries(),
  });
}
export function useReversePayment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: string; reason: string }) =>
      send<PaymentRow>('POST', `/payments/${v.id}/reverse`, { reason: v.reason }),
    onSuccess: () => qc.invalidateQueries(),
  });
}

export interface AdjustmentRow {
  id: string;
  studentId: string;
  studentName: string;
  classLabel: string;
  type: 'Scholarship' | 'Discount' | 'Concession' | 'Waiver';
  amount: number;
  reason: string;
  approvedBy: string | null;
  date: string;
  status: 'APPROVED' | 'PENDING';
}
export const useAdjustments = () =>
  useQuery({ queryKey: ['adjustments'], queryFn: () => get<AdjustmentRow[]>('/adjustments') });
export function useApproveAdjustment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => send<AdjustmentRow>('POST', `/adjustments/${id}/approve`),
    onSuccess: () => qc.invalidateQueries(),
  });
}
