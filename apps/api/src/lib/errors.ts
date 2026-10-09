import { ZodError } from 'zod';
import { AcademicError } from '../domain/academic/errors';
import { FinanceError } from '../domain/finance/errors';

/**
 * One error shape for the whole API:
 *   { error: { code, message, details?, requestId } }
 * `code` is stable (the frontend maps it to a friendly message); `message` is a safe fallback and never
 * contains stack traces, SQL/Mongo errors or secrets.
 */
export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
    public readonly headers?: Record<string, string>,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const badRequest = (code: string, message: string, details?: unknown): AppError =>
  new AppError(400, code, message, details);
export const unauthorized = (code = 'UNAUTHENTICATED', message = 'Please sign in.'): AppError =>
  new AppError(401, code, message);
export const forbidden = (
  message = 'You do not have permission to do this.',
  code = 'FORBIDDEN',
): AppError => new AppError(403, code, message);
export const notFound = (message = 'Not found.', code = 'NOT_FOUND'): AppError =>
  new AppError(404, code, message);
export const conflict = (code: string, message: string, details?: unknown): AppError =>
  new AppError(409, code, message, details);
export const unprocessable = (code: string, message: string, details?: unknown): AppError =>
  new AppError(422, code, message, details);

export interface ErrorBody {
  status: number;
  body: { error: { code: string; message: string; details?: unknown; requestId: string } };
  headers?: Record<string, string>;
  /** unexpected errors are logged at error level, expected ones are not */
  unexpected: boolean;
}

/** Translate anything thrown into a safe HTTP response. */
export function toErrorBody(err: unknown, requestId: string): ErrorBody {
  const make = (
    status: number,
    code: string,
    message: string,
    details?: unknown,
    unexpected = false,
  ) => ({
    status,
    unexpected,
    body: { error: { code, message, ...(details !== undefined ? { details } : {}), requestId } },
  });

  if (err instanceof AppError) {
    return {
      ...make(err.status, err.code, err.message, err.details),
      ...(err.headers ? { headers: err.headers } : {}),
    };
  }
  if (err instanceof ZodError) {
    return make(
      400,
      'VALIDATION_ERROR',
      'Some details are missing or invalid.',
      err.issues.map((i) => ({ field: i.path.join('.'), issue: i.code, message: i.message })),
    );
  }
  if (err instanceof FinanceError || err instanceof AcademicError) {
    return make(422, err.code, err.message, err.details);
  }
  const e = err as { type?: string; status?: number };
  if (e?.type === 'entity.parse.failed')
    return make(400, 'INVALID_JSON', 'The request body is not valid JSON.');
  if (e?.type === 'entity.too.large')
    return make(413, 'PAYLOAD_TOO_LARGE', 'The request is too large.');
  return make(500, 'INTERNAL_ERROR', 'Something went wrong. Please try again.', undefined, true);
}
