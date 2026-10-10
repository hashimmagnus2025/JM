import { useQuery } from '@tanstack/react-query';
import { get } from '../../lib/api';
import type { FeeStatus } from '../fees/types';

export interface ClassFeeRow {
  id: string;
  name: string;
  divisions: number;
  students: number;
  expected: number;
  collected: number;
  outstanding: number;
  overdue: number;
  pct: number;
}

export interface DashboardData {
  asOf: string;
  yearLabel: string;
  academic: {
    classes: number;
    divisions: number;
    students: number;
    teachers: number;
    receipts: number;
    unassignedDivisions: number;
  };
  fees: {
    expected: number;
    collected: number;
    outstanding: number;
    overdue: number;
    today: number;
    month: number;
    upcoming30: number;
    targetPct: number;
    collectionPct: number;
    target: number;
  };
  monthly: { month: string; target: number; actual: number; future: boolean }[];
  status: Record<FeeStatus | 'DUE_SOON', number>;
  classes: ClassFeeRow[];
  aging: { bucket: string; amount: number }[];
  methods: { method: string; amount: number }[];
  topOverdue: {
    id: string;
    name: string;
    classLabel: string;
    guardian: string;
    status: FeeStatus;
    overdue: number;
  }[];
}

export const useDashboard = () =>
  useQuery({ queryKey: ['dashboard'], queryFn: () => get<DashboardData>('/dashboard') });
