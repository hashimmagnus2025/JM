import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { get, getPage, send } from '../../lib/api';

export interface OutstandingRow {
  id: string;
  name: string;
  studentCode: string;
  classLabel: string;
  guardian: string;
  mobile: string;
  oldestDueDate: string | null;
  daysOverdue: number;
  outstanding: number;
  overdue: number;
}
export interface OutstandingFilters {
  q?: string;
  classId?: string;
  divisionId?: string;
  bucket?: string;
  /** 'overdue' (default) = only amounts past their due date; 'all' = everything still pending */
  scope?: 'overdue' | 'all';
}
export interface OutstandingMeta {
  total: number;
  totals: { students: number; outstanding: number; overdue: number };
  aging: { bucket: string; amount: number }[];
}
export const useOutstanding = (f: OutstandingFilters, page: number, pageSize = 15) =>
  useQuery({
    queryKey: ['outstanding', f, page],
    placeholderData: keepPreviousData,
    queryFn: async () => {
      const r = await getPage<OutstandingRow>('/outstanding', { ...f, page, pageSize });
      return { rows: r.data, meta: r.meta as unknown as OutstandingMeta };
    },
  });

export interface ReminderRow {
  id: string;
  date: string;
  studentId: string;
  studentName: string;
  classLabel: string;
  type: string;
  channel: 'WhatsApp' | 'SMS' | 'E-mail' | 'In-app';
  message: string;
  sentBy: string;
  status: 'Delivered' | 'Failed' | 'Queued';
}
export const useReminderHistory = (page: number, pageSize = 12) =>
  useQuery({
    queryKey: ['reminders', 'history', page],
    placeholderData: keepPreviousData,
    queryFn: async () => {
      const r = await getPage<ReminderRow>('/reminders', { page, pageSize });
      return { rows: r.data, total: Number(r.meta?.total ?? 0) };
    },
  });

export interface ReminderRule {
  id: string;
  label: string;
  when: string;
  type: string;
  channel: string;
  enabled: boolean;
}
export const useReminderRules = () =>
  useQuery({
    queryKey: ['reminders', 'rules'],
    queryFn: () => get<ReminderRule[]>('/reminders/rules'),
  });
export function useToggleRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: string; enabled: boolean }) =>
      send<ReminderRule>('PATCH', `/reminders/rules/${v.id}`, { enabled: v.enabled }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['reminders'] }),
  });
}
export interface QueueItem {
  id: string;
  date: string;
  time: string;
  rule: string;
  channel: string;
  recipients: number;
}
export const useReminderQueue = () =>
  useQuery({
    queryKey: ['reminders', 'queue'],
    queryFn: () => get<QueueItem[]>('/reminders/queue'),
  });

export type Segment = 'OVERDUE' | 'UNPAID' | 'PARTIAL' | 'ANY_DUE';
export interface Audience {
  segment: Segment;
  classId?: string;
  divisionId?: string;
  studentId?: string;
}
export const useAudience = (a: Audience) =>
  useQuery({
    queryKey: ['reminders', 'audience', a],
    placeholderData: keepPreviousData,
    queryFn: () => get<{ count: number; amount: number }>('/reminders/audience', { ...a }),
  });
export function useSendReminders() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { audience: Audience; channel: string; message: string }) =>
      send<{ queued: number }>('POST', '/reminders/send', v),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['reminders'] }),
  });
}
