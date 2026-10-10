import { Check } from 'lucide-react';
import { useState } from 'react';
import { PERMISSION_DEFS } from '@sfm/shared';
import { DataTable, Section, Tabs } from '../components/data';
import { QueryBoundary } from '../components/QueryBoundary';
import { Badge, Card, PageHeader } from '../components/ui';
import { useRoles, useUsers, type RoleRow } from '../features/admin/api';
import { initials } from '../lib/format';

function Matrix({ roles }: { roles: RoleRow[] }) {
  const groups = [...new Set(PERMISSION_DEFS.map((p) => p.group))];
  return (
    <div className="space-y-4">
      {groups.map((g) => (
        <Section key={g} title={g} flush>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <caption className="sr-only">{g} permissions by role</caption>
              <thead>
                <tr className="border-b border-line bg-surface-2/60 text-[12px] font-semibold tracking-wide text-muted uppercase">
                  <th scope="col" className="px-4 py-3">
                    Permission
                  </th>
                  {roles.map((r) => (
                    <th key={r.key} scope="col" className="px-3 py-3 text-center whitespace-nowrap">
                      {r.name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {PERMISSION_DEFS.filter((p) => p.group === g).map((p) => (
                  <tr key={p.key}>
                    <th scope="row" className="px-4 py-2.5 font-normal text-ink">
                      {p.label}
                    </th>
                    {roles.map((r) => (
                      <td key={r.key} className="px-3 py-2.5 text-center">
                        {r.permissions.includes(p.key) ? (
                          <>
                            <Check className="mx-auto size-4 text-success" aria-hidden />
                            <span className="sr-only">Allowed</span>
                          </>
                        ) : (
                          <span className="text-subtle" aria-label="Not allowed">
                            —
                          </span>
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      ))}
    </div>
  );
}

export default function UsersPage() {
  const users = useUsers();
  const roles = useRoles();
  const [tab, setTab] = useState<'users' | 'roles' | 'matrix'>('users');
  return (
    <>
      <PageHeader
        title="Users & roles"
        description="Who can sign in, and what each role is allowed to do. Money-related powers are kept to the roles that need them."
      />
      <Tabs
        label="Users and roles"
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'users', label: 'Users', count: users.data?.length },
          { id: 'roles', label: 'Roles', count: roles.data?.length },
          { id: 'matrix', label: 'What each role can do' },
        ]}
      />
      {tab === 'users' && (
        <Card>
          <QueryBoundary query={users}>
            {(list) => (
              <DataTable
                caption="Users"
                rows={list}
                rowKey={(u) => u.id}
                columns={[
                  {
                    key: 'n',
                    header: 'Name',
                    cell: (u) => (
                      <div className="flex items-center gap-3">
                        <span
                          aria-hidden
                          className="grid size-9 place-items-center rounded-full bg-primary-soft text-xs font-semibold text-primary"
                        >
                          {initials(u.name)}
                        </span>
                        <div>
                          <p className="font-medium text-ink">{u.name}</p>
                          <p className="text-xs text-muted">{u.email}</p>
                        </div>
                      </div>
                    ),
                  },
                  { key: 'r', header: 'Role', cell: (u) => u.roleName },
                  { key: 'l', header: 'Last sign-in', cell: (u) => u.lastLogin },
                  {
                    key: 's',
                    header: 'Status',
                    cell: (u) =>
                      u.active ? <Badge tone="success">Active</Badge> : <Badge>Switched off</Badge>,
                  },
                ]}
              />
            )}
          </QueryBoundary>
        </Card>
      )}
      {tab === 'roles' && (
        <QueryBoundary query={roles}>
          {(list) => (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {list.map((r) => (
                <Card key={r.key} className="p-5">
                  <div className="mb-1 flex items-start justify-between gap-2">
                    <h2 className="text-base font-semibold text-ink">{r.name}</h2>
                    <Badge tone="brand">
                      {r.userCount} user{r.userCount === 1 ? '' : 's'}
                    </Badge>
                  </div>
                  <p className="text-sm text-muted">{r.description}</p>
                  <p className="mt-3 text-xs text-muted">{r.permissions.length} permissions</p>
                </Card>
              ))}
            </div>
          )}
        </QueryBoundary>
      )}
      {tab === 'matrix' && (
        <QueryBoundary query={roles}>{(list) => <Matrix roles={list} />}</QueryBoundary>
      )}
    </>
  );
}
