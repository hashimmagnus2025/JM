import { createHash, randomBytes } from 'node:crypto';
import { SignJWT, jwtVerify, errors as joseErrors } from 'jose';
import { unauthorized } from '../../lib/errors';

export const JWT_ISSUER = 'sfm-api';
export const JWT_AUDIENCE = 'sfm-web';

export interface AccessClaims {
  /** user id */
  sub: string;
  /** session id */
  sid: string;
  /** user.tokenVersion at issue time */
  tv: number;
}

const key = (secret: string): Uint8Array => new TextEncoder().encode(secret);

/** HS256 access token. The algorithm is pinned on both sides; issuer and audience are validated. */
export async function signAccessToken(
  claims: AccessClaims,
  opts: { secret: string; ttlSeconds: number; now?: Date },
): Promise<string> {
  const iat = Math.floor((opts.now ?? new Date()).getTime() / 1000);
  return new SignJWT({ sid: claims.sid, tv: claims.tv })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(claims.sub)
    .setIssuer(JWT_ISSUER)
    .setAudience(JWT_AUDIENCE)
    .setIssuedAt(iat)
    .setExpirationTime(iat + opts.ttlSeconds)
    .sign(key(opts.secret));
}

export async function verifyAccessToken(
  token: string,
  opts: { secret: string; now?: Date },
): Promise<AccessClaims> {
  try {
    const { payload } = await jwtVerify(token, key(opts.secret), {
      algorithms: ['HS256'],
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
      ...(opts.now ? { currentDate: opts.now } : {}),
    });
    if (
      typeof payload.sub !== 'string' ||
      typeof payload['sid'] !== 'string' ||
      typeof payload['tv'] !== 'number'
    ) {
      throw unauthorized('TOKEN_INVALID', 'Your session is not valid. Please sign in again.');
    }
    return { sub: payload.sub, sid: payload['sid'], tv: payload['tv'] };
  } catch (e) {
    if (e instanceof joseErrors.JWTExpired)
      throw unauthorized('TOKEN_EXPIRED', 'Your session has expired.');
    if (e && typeof e === 'object' && (e as { status?: number }).status === 401) throw e;
    throw unauthorized('TOKEN_INVALID', 'Your session is not valid. Please sign in again.');
  }
}

/** opaque 256-bit refresh token; only its SHA-256 is stored */
export const newRefreshToken = (): string => randomBytes(32).toString('base64url');
export const hashRefreshToken = (token: string): string =>
  createHash('sha256').update(token, 'utf8').digest('hex');
export const newFamilyId = (): string => randomBytes(16).toString('hex');
