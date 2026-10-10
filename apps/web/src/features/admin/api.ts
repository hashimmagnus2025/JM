import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { get, getPage } from '../../lib/api';

export interface UserRow {
  id: string;
  name: string;
  email: string;
  roleKey: string;
  roleName: string;
  active: boolean;
  lastLogin: string;
}
export interface RoleRow {
  key: string;
  name: string;
  description: string;
  permissions: string[];
  userCount: number;
}
export interface AuditRow {
  id: string;
  at: string;
  user: string;
  action: string;
  entity: string;
  detail: string;
}
export const useUsers = () =>
  useQuery({ queryKey: ['users'], queryFn: () => get<UserRow[]>('/users') });
export const useRoles = () =>
  useQuery({ queryKey: ['roles'], queryFn: () => get<RoleRow[]>('/roles') });
export const useAudit = (q: string, page: number, pageSize = 15) =>
  useQuery({
    queryKey: ['audit', q, page],
    placeholderData: keepPreviousData,
    queryFn: async () => {
      const r = await getPage<AuditRow>('/audit-logs', { q, page, pageSize });
      return { rows: r.data, total: Number(r.meta?.total ?? 0) };
    },
  });
