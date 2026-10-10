import { useQuery } from '@tanstack/react-query';
import { get } from '../../lib/api';

export interface TargetsData {
  yearLabel: string;
  months: { month: string; target: number; actual: number; future: boolean }[];
  forecast: {
    expectedAnnual: number;
    collectedToDate: number;
    outstanding: number;
    currentRate: number;
    projected: number;
    projectedPct: number;
  };
  classes: { id: string; name: string; target: number; actual: number; pct: number }[];
}
export const useTargets = () =>
  useQuery({ queryKey: ['targets'], queryFn: () => get<TargetsData>('/targets') });

export interface ReportInfo {
  key: string;
  group: string;
  title: string;
  description: string;
}
export interface ReportColumn {
  key: string;
  header: string;
  type: 'text' | 'money' | 'number' | 'date';
}
export interface ReportResult {
  title: string;
  columns: ReportColumn[];
  rows: Record<string, string | number | null>[];
  totals?: Record<string, string | number>;
}
export const useReportCatalog = () =>
  useQuery({ queryKey: ['reports'], queryFn: () => get<ReportInfo[]>('/reports') });
export const useReport = (
  key: string | null,
  filters: { classId?: string; from?: string; to?: string },
) =>
  useQuery({
    queryKey: ['reports', key, filters],
    enabled: !!key,
    queryFn: () => get<ReportResult>(`/reports/${key}`, filters),
  });
