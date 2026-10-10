import type { UseQueryResult } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { ApiError } from '../lib/api';
import { friendlyMessage } from '../lib/messages';
import { ErrorState, Skeleton } from './ui';

/**
 * One consistent way to show loading / error / forbidden for any query.
 * (Empty states are domain specific, so the child decides what to show for an empty list.)
 */
export function QueryBoundary<T>({
  query,
  skeleton,
  children,
}: {
  query: UseQueryResult<T>;
  skeleton?: ReactNode;
  children: (data: T) => ReactNode;
}) {
  if (query.isPending) {
    return (
      <>
        {skeleton ?? (
          <div className="space-y-3 p-5" role="status" aria-busy="true" aria-label="Loading">
            <Skeleton className="h-6 w-1/3" />
            <Skeleton className="h-10" />
            <Skeleton className="h-10" />
            <Skeleton className="h-10" />
          </div>
        )}
      </>
    );
  }
  if (query.isError) {
    const e = query.error;
    if (e instanceof ApiError && e.status === 403) {
      return (
        <ErrorState
          message="You do not have permission to see this. Ask your administrator if you need access."
          requestId={e.requestId}
        />
      );
    }
    return (
      <ErrorState
        message={friendlyMessage(e)}
        onRetry={() => void query.refetch()}
        requestId={e instanceof ApiError ? e.requestId : undefined}
      />
    );
  }
  return <>{children(query.data)}</>;
}
