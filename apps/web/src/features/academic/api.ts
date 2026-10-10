import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { get, send } from '../../lib/api';
import { qk as setupKeys } from '../setup/api';

export interface ClassRow {
  id: string;
  code: string;
  name: string;
  sequence: number;
  isActive: boolean;
  isFinal: boolean;
}

export interface Division {
  id: string;
  academicYearId: string;
  classId: string;
  name: string;
  capacity?: number;
  isActive: boolean;
}

export const qk = {
  classes: ['classes'] as const,
  divisions: (yearId?: string) => ['divisions', yearId ?? 'all'] as const,
  allDivisions: ['divisions'] as const,
};

export const useClasses = () =>
  useQuery({ queryKey: qk.classes, queryFn: () => get<ClassRow[]>('/classes') });

export const useDivisions = (academicYearId: string | undefined) =>
  useQuery({
    queryKey: qk.divisions(academicYearId),
    enabled: !!academicYearId,
    queryFn: () => get<Division[]>('/divisions', { academicYearId }),
  });

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

export const useCreateClass = () =>
  useApiMutation(
    (v: { code: string; name: string; isFinal: boolean }) => send<ClassRow>('POST', '/classes', v),
    [qk.classes],
  );
export const useUpdateClass = () =>
  useApiMutation(
    (v: { id: string; name?: string; isActive?: boolean; isFinal?: boolean }) => {
      const { id, ...patch } = v;
      return send<ClassRow>('PATCH', `/classes/${id}`, patch);
    },
    // switching a class off is checked against its divisions
    [qk.classes, qk.allDivisions],
  );
export const useReorderClasses = () =>
  useApiMutation(
    (ids: string[]) => send<ClassRow[]>('PUT', '/classes/order', { ids }),
    [qk.classes],
  );

// a year with divisions can no longer go back to "planned", so the years list is refreshed too
const divisionKeys = [qk.allDivisions, setupKeys.years] as const;

export const useCreateDivision = () =>
  useApiMutation(
    (v: { academicYearId: string; classId: string; name: string; capacity?: number }) =>
      send<Division>('POST', '/divisions', v),
    divisionKeys,
  );
export const useUpdateDivision = () =>
  useApiMutation(
    (v: { id: string; name?: string; capacity?: number | null; isActive?: boolean }) => {
      const { id, ...patch } = v;
      return send<Division>('PATCH', `/divisions/${id}`, patch);
    },
    divisionKeys,
  );
export const useCloneDivisions = () =>
  useApiMutation(
    (v: { fromYearId: string; toYearId: string }) =>
      send<{ created: number; skipped: number }>('POST', '/divisions/clone', v),
    divisionKeys,
  );
