import pino, { type Logger } from 'pino';

/** Never log secrets or personal data: these paths are replaced with [REDACTED] in every log line. */
export const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'res.headers["set-cookie"]',
  '*.password',
  '*.passwordHash',
  '*.token',
  '*.accessToken',
  '*.refreshToken',
  '*.secret',
  '*.mobile',
  '*.email',
  'guardians[*].mobile',
  'guardians[*].email',
];

export function createLogger(level: string = 'info', destination?: pino.DestinationStream): Logger {
  return pino(
    { level, redact: { paths: REDACT_PATHS, censor: '[REDACTED]' }, base: { service: 'sfm-api' } },
    destination,
  );
}
