import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { get, send } from '../../lib/api';

export interface Institution {
  id: string;
  name: string;
  shortName?: string;
  code: string;
  address: {
    line1?: string;
    line2?: string;
    city?: string;
    state?: string;
    pincode?: string;
    country?: string;
  };
  contact: { phone?: string; altPhone?: string; email?: string; website?: string };
  registrationNo?: string;
  timezone: string;
  currency: string;
  academicStartMonth: number;
  receiptFooter?: string;
  extra: Record<string, string>;
}

export type YearStatus = 'PLANNED' | 'ACTIVE' | 'CLOSED';
export interface AcademicYear {
  id: string;
  label: string;
  startDate: string;
  endDate: string;
  status: YearStatus;
  isCurrent: boolean;
  closedAt?: string;
}

export interface Category {
  id: string;
  code: string;
  name: string;
  isActive: boolean;
  sequence: number;
}

export interface SettingView {
  key: string;
  group: string;
  label: string;
  description: string;
  rule?: string;
  value: unknown;
  default: unknown;
  isDefault: boolean;
  updatedAt?: string;
}

export const qk = {
  institution: ['institution'] as const,
  years: ['academic-years'] as const,
  currentYear: ['academic-years', 'current'] as const,
  suggestYear: ['academic-years', 'suggest'] as const,
  categories: ['student-categories'] as const,
  settings: ['settings'] as const,
};

/* ------------------------------ queries ------------------------------ */

export const useInstitution = () =>
  useQuery({ queryKey: qk.institution, queryFn: () => get<Institution>('/institution') });
export const useYears = () =>
  useQuery({ queryKey: qk.years, queryFn: () => get<AcademicYear[]>('/academic-years') });
export const useCurrentYear = () =>
  useQuery({
    queryKey: qk.currentYear,
    queryFn: () => get<AcademicYear | null>('/academic-years/current'),
  });
export const useCategories = () =>
  useQuery({ queryKey: qk.categories, queryFn: () => get<Category[]>('/student-categories') });
export const useSettings = () =>
  useQuery({ queryKey: qk.settings, queryFn: () => get<SettingView[]>('/settings') });
export const useSuggestedYear = (enabled: boolean) =>
  useQuery({
    queryKey: qk.suggestYear,
    enabled,
    queryFn: () =>
      get<{ label: string; startDate: string; endDate: string } | null>(
        '/academic-years/suggest-next',
      ),
  });

/* ------------------------------ mutations ------------------------------ */

function useApiMutation<V, R>(
  fn: (v: V) => Promise<R>,
  invalidate: readonly (readonly unknown[])[],
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: async () => {
      await Promise.all(invalidate.map((k) => qc.invalidateQueries({ queryKey: k })));
    },
  });
}

export const useUpdateInstitution = () =>
  useApiMutation(
    (v: Partial<Institution>) => send<Institution>('PATCH', '/institution', v),
    [qk.institution],
  );

export const useCreateYear = () =>
  useApiMutation(
    (v: { label: string; startDate: string; endDate: string }) =>
      send<AcademicYear>('POST', '/academic-years', v),
    [qk.years, qk.currentYear],
  );
export const useUpdateYear = () =>
  useApiMutation(
    (v: { id: string; label: string; startDate: string; endDate: string }) =>
      send<AcademicYear>('PATCH', `/academic-years/${v.id}`, {
        label: v.label,
        startDate: v.startDate,
        endDate: v.endDate,
      }),
    [qk.years, qk.currentYear],
  );
export type YearAction = 'activate' | 'deactivate' | 'set-current' | 'close' | 'reopen';
export const useYearAction = () =>
  useApiMutation(
    (v: { id: string; action: YearAction; reason?: string }) =>
      send<AcademicYear>(
        'POST',
        `/academic-years/${v.id}/${v.action}`,
        v.reason !== undefined ? { reason: v.reason } : undefined,
      ),
    [qk.years, qk.currentYear],
  );

export const useCreateCategory = () =>
  useApiMutation(
    (v: { code: string; name: string }) => send<Category>('POST', '/student-categories', v),
    [qk.categories],
  );
export const useUpdateCategory = () =>
  useApiMutation(
    (v: { id: string; name?: string; isActive?: boolean }) => {
      const { id, ...patch } = v;
      return send<Category>('PATCH', `/student-categories/${id}`, patch);
    },
    [qk.categories],
  );

export const useUpdateSetting = () =>
  useApiMutation(
    (v: { key: string; value: unknown; reason?: string }) =>
      send<SettingView>('PUT', `/settings/${v.key}`, {
        value: v.value,
        ...(v.reason ? { reason: v.reason } : {}),
      }),
    [qk.settings],
  );
export const useResetSetting = () =>
  useApiMutation((key: string) => send<SettingView>('DELETE', `/settings/${key}`), [qk.settings]);
