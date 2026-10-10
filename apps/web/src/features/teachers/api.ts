import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { get, send } from '../../lib/api';

export type TeacherStatus = 'ACTIVE' | 'INACTIVE' | 'LEFT';
export type Gender = 'MALE' | 'FEMALE' | 'OTHER';

export interface Teacher {
  id: string;
  teacherCode: string;
  staffId: string;
  fullName: string;
  mobile: string;
  email?: string;
  gender?: Gender;
  qualification?: string;
  joiningDate: string;
  status: TeacherStatus;
  leavingDate?: string;
  remarks?: string;
}

export interface Assignment {
  id: string;
  academicYearId: string;
  classId: string;
  divisionId: string;
  teacherId: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  isCurrent: boolean;
  endReason?: 'CHANGED' | 'LEFT_INSTITUTION' | 'CORRECTION' | 'YEAR_END';
  reason?: string;
}

export interface TeacherInput {
  staffId: string;
  fullName: string;
  mobile: string;
  joiningDate: string;
  email?: string;
  gender?: Gender;
  qualification?: string;
  remarks?: string;
}

export const qk = {
  teachers: ['teachers'] as const,
  list: (status?: string, q?: string) => ['teachers', 'list', status ?? '', q ?? ''] as const,
  assignments: ['teacher-assignments'] as const,
  year: (yearId?: string) => ['teacher-assignments', 'year', yearId ?? ''] as const,
  history: (divisionId: string) => ['teacher-assignments', 'division', divisionId] as const,
};

export const useTeachers = (filter: { status?: string; q?: string } = {}, enabled = true) =>
  useQuery({
    enabled,
    queryKey: qk.list(filter.status, filter.q),
    queryFn: () =>
      get<Teacher[]>('/teachers', {
        ...(filter.status ? { status: filter.status } : {}),
        ...(filter.q ? { q: filter.q } : {}),
      }),
  });

/** every assignment of one academic year (current and closed) */
export const useYearAssignments = (academicYearId: string | undefined) =>
  useQuery({
    queryKey: qk.year(academicYearId),
    enabled: !!academicYearId,
    queryFn: () => get<Assignment[]>('/teacher-assignments', { academicYearId }),
  });

export const useDivisionHistory = (divisionId: string, enabled: boolean) =>
  useQuery({
    queryKey: qk.history(divisionId),
    enabled,
    queryFn: () => get<Assignment[]>(`/divisions/${divisionId}/assignment-history`),
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

const both = [qk.teachers, qk.assignments] as const;

export const useCreateTeacher = () =>
  useApiMutation((v: TeacherInput) => send<Teacher>('POST', '/teachers', v), [qk.teachers]);

/** a null clears an optional field */
export type TeacherPatch = Partial<
  Pick<TeacherInput, 'staffId' | 'fullName' | 'mobile' | 'joiningDate'>
> & {
  email?: string | null;
  gender?: Gender | null;
  qualification?: string | null;
  remarks?: string | null;
};

export const useUpdateTeacher = () =>
  useApiMutation(
    (v: { id: string; patch: TeacherPatch }) =>
      send<Teacher>('PATCH', `/teachers/${v.id}`, v.patch),
    [qk.teachers],
  );

export const useTeacherStatus = () =>
  useApiMutation(
    (v: { id: string; status: TeacherStatus; leavingDate?: string }) =>
      send<Teacher>('POST', `/teachers/${v.id}/status`, {
        status: v.status,
        ...(v.leavingDate ? { leavingDate: v.leavingDate } : {}),
      }),
    both,
  );

export const useAssignTeacher = () =>
  useApiMutation(
    (v: { divisionId: string; teacherId: string; effectiveFrom: string }) =>
      send<Assignment>('POST', '/teacher-assignments', v),
    [qk.assignments],
  );

export const useChangeTeacher = () =>
  useApiMutation(
    (v: { id: string; newTeacherId: string; effectiveFrom: string; reason: string }) => {
      const { id, ...body } = v;
      return send<Assignment>('POST', `/teacher-assignments/${id}/change`, body);
    },
    [qk.assignments],
  );

export const useEndAssignment = () =>
  useApiMutation(
    (v: { id: string; effectiveTo: string; reason: string }) => {
      const { id, ...body } = v;
      return send<{ ended: boolean }>('POST', `/teacher-assignments/${id}/end`, body);
    },
    [qk.assignments],
  );
