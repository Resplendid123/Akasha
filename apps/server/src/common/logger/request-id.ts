import { randomUUID } from 'node:crypto';

/**
 * requestId resolution, shared by nestjs-cls `idGenerator` and pino `customProps`.
 *
 * Why cache on the request object instead of reading `cls.getId()` in customProps:
 * pino-http evaluates `customProps` twice — once in `loggingMiddleware` (feeds
 * request-scoped business logs) and again in `onResFinished` (feeds the access
 * log). The second call happens on the `finish`/`close` event, where the CLS
 * AsyncLocalStorage context is not guaranteed to still be live. Caching the id
 * on the raw request makes both evaluations return the same value regardless of
 * ALS liveness *and* regardless of whether the CLS middleware ran before the
 * pino middleware.
 */
const REQUEST_ID_KEY = Symbol.for('akasha.requestId');

const MAX_REQUEST_ID_LENGTH = 128;

/**
 * A caller-supplied `x-request-id` is only trusted when it is a single, clean
 * token. Duplicated headers arrive as `string[]` (or a comma-joined string) and
 * would corrupt the field, so those fall back to a generated UUID.
 */
export function isValidRequestId(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  return (
    trimmed.length > 0 &&
    trimmed.length <= MAX_REQUEST_ID_LENGTH &&
    !/[\s,]/.test(trimmed)
  );
}

type RequestLike = {
  headers?: Record<string, string | string[] | undefined>;
  [key: symbol]: unknown;
};

/**
 * Returns the request's id, generating and caching one on first call.
 * Returns `''` when there is no request object (non-HTTP contexts).
 */
export function resolveRequestId(req: unknown): string {
  if (!req || typeof req !== 'object') return '';

  const target = req as RequestLike;
  const cached = target[REQUEST_ID_KEY];
  if (typeof cached === 'string') return cached;

  const raw = target.headers?.['x-request-id'];
  const candidate = Array.isArray(raw) ? undefined : raw;
  const requestId = isValidRequestId(candidate) ? candidate.trim() : randomUUID();

  target[REQUEST_ID_KEY] = requestId;
  return requestId;
}
