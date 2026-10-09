import type { ReactNode } from 'react';
import { usePermission } from '../features/auth/auth';

/**
 * Hides what the user may not use. This is a convenience, never security: the backend enforces every
 * permission again on every request.
 */
export function PermissionGate({
  permission,
  children,
  fallback = null,
}: {
  permission: string;
  children: ReactNode;
  fallback?: ReactNode;
}) {
  return usePermission(permission) ? <>{children}</> : <>{fallback}</>;
}
