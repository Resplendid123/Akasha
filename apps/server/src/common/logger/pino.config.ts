import { hostname } from 'node:os';
import { Params } from 'nestjs-pino';
import { Options } from 'pino-http';
import { DestinationStream, stdSerializers, stdTimeFunctions } from 'pino';
import { redactSensitiveUrl } from '../helpers/utils';
import { resolveRequestId } from './request-id';

const CONTEXTS_TO_IGNORE = [
  'InstanceLoader',
  'RoutesResolver',
  'RouterExplorer',
  'LegacyRouteConverter',
  'WebSocketsController',
];

/**
 * Backstop for business code that explicitly logs a sensitive value
 * (`logger.info({ token })`) — *not* HTTP header/body masking.
 *
 * `redact` runs on the final log object, after serializers. The `req` serializer
 * below only emits method/url/ip/userAgent, and pino-http does not record request
 * bodies, so `req.headers.*` / `req.body.*` paths could never match and are
 * deliberately omitted rather than kept as dead config.
 *
 * `*` is a single-level wildcard: these paths cover depth 1 (`{ token }`) and
 * depth 2 (`{ user: { token } }`) only, not `{ req: { body: { password } } }`.
 */
const REDACT_PATHS = [
  'password',
  'token',
  'secret',
  'accessToken',
  'refreshToken',
  'authorization',
  'cookie',
  '*.password',
  '*.token',
  '*.secret',
  '*.accessToken',
  '*.refreshToken',
  '*.authorization',
  '*.cookie',
  'err.details.password',
  'err.details.token',
  'err.details.secret',
  'err.details.accessToken',
  'err.details.refreshToken',
  'err.details.authorization',
  'err.details.cookie',
  'err.details.*.password',
  'err.details.*.token',
  'err.details.*.secret',
  'err.details.*.accessToken',
  'err.details.*.refreshToken',
  'err.details.*.authorization',
  'err.details.*.cookie',
];

/**
 * @param serviceName value of the `service` base field, used to tell the main API
 *   and the collaboration server apart in aggregated logs.
 * @param destination test-only stream for capturing output. pino rejects
 *   `transport` and a destination stream together, so passing one disables
 *   `transport`.
 */
export function createPinoConfig(
  serviceName: string,
  destination?: DestinationStream,
): Params {
  const isProduction = process.env.NODE_ENV?.toLowerCase() === 'production';
  const isDebugMode = process.env.DEBUG_MODE?.toLowerCase() === 'true';
  const logHttp = process.env.LOG_HTTP?.toLowerCase() === 'true';

  const level = isProduction && !isDebugMode ? 'info' : 'debug';

  const autoLogging = {
    // Reads `originalUrl`, not `url`: Nest mounts middleware through
    // @fastify/middie, which strips the mount prefix from `req.url` for the
    // duration of the middleware, so `ignore` would only ever see `/` or
    // `/live` and never match. middie sets `originalUrl` to the untouched path
    // before running middlewares, and Nest's own adapter routes on it the same
    // way. (The `req` serializer runs later, at onResFinished, once `req.url`
    // has been restored — which is why logged URLs still look complete.)
    ignore: (req) => {
      const originalUrl: string = req.originalUrl ?? req.url ?? '';
      const path = originalUrl.split('?')[0];
      return path === '/api/health' || path === '/api/health/live';
    },
  };

  const options: Options = {
    level,
    timestamp: stdTimeFunctions.isoTime,
    // An explicit `base` replaces pino's default bindings, so pid/hostname have
    // to be restated here to keep them in production output.
    base: {
      service: serviceName,
      env: process.env.NODE_ENV ?? '',
      pid: process.pid,
      hostname: hostname(),
    },
    redact: { paths: REDACT_PATHS, censor: '[REDACTED]' },
    // Resolved from the request (cached on it), never from `cls.getId()`:
    // pino-http calls customProps twice — once in `loggingMiddleware` for
    // request-scoped business logs, once in `onResFinished` for the access log.
    // The second call runs on the `finish` event, where the CLS
    // AsyncLocalStorage context is not guaranteed to still be live. Reading the
    // id off the request makes both evaluations agree and removes any dependency
    // on the CLS middleware being registered before the pino middleware.
    customProps: (req) => ({ requestId: resolveRequestId(req) }),
    // Keeps pino's own `req.id` identical to the `requestId` field.
    genReqId: (req) => resolveRequestId(req),
    transport:
      !isProduction && !destination
        ? {
            target: 'pino-pretty',
            options: {
              colorize: true,
              singleLine: true,
              translateTime: 'SYS:standard',
              ignore: 'pid,hostname',
            },
          }
        : undefined,
    formatters: {
      level: (label) => ({ level: label }),
    },
    hooks: {
      logMethod(inputArgs, method) {
        if (isProduction && !isDebugMode) {
          for (const arg of inputArgs) {
            if (typeof arg === 'object' && arg !== null && 'context' in arg) {
              const context = (arg as Record<string, unknown>)['context'];
              if (typeof context === 'string' && CONTEXTS_TO_IGNORE.includes(context)) {
                return;
              }
            }
          }
        }
        return method.apply(this, inputArgs);
      },
    },
    serializers: {
      req: (req) => ({
        method: req.method,
        url: redactSensitiveUrl(req.url),
        ip: req.ip || req.remoteAddress,
        userAgent: req.headers?.['user-agent'],
      }),
      res: (res) => ({
        statusCode: res.statusCode,
      }),
      // Real Errors keep pino's standard {type,message,stack} treatment; objects
      // we shaped ourselves (AllExceptionsFilter's 4xx payload) pass through
      // untouched, so a deliberately stack-free err stays stack-free.
      //
      // Two call paths reach this, and they hand over different things:
      //
      //  - Out of request, via PinoLogger's own pino instance: the raw value.
      //  - In request, via pino-http: pino-http *wraps* rather than replaces a
      //    custom err serializer (`pino-http/logger.js:35` ->
      //    `wrapErrorSerializer`, i.e. `ours(stdErrSerializer(err))`), so the
      //    standard serializer has already run. Because `isErrorLike` is only
      //    `typeof err.message === 'string'`, it rebuilds our plain object on
      //    pinoErrProto — overwriting `type` with `'Object'` and adding
      //    `stack: ''`. It also stashes the untouched original on a
      //    non-enumerable `raw`, which is the only way back to it.
      //
      // Hence: recover `raw` when it is not an Error, else defer to the standard
      // shape. Note `wrapSerializers: false` would also stop the rewriting, but
      // it unwraps the req serializer too — that one currently receives the
      // std-serialized request (`ip` undefined, `remoteAddress` set), and
      // unwrapping would flip the logged IP to `req.ip`, i.e. the
      // X-Forwarded-For client address under `trustProxy`. Out of scope here.
      err: (err) => {
        if (err instanceof Error) return stdSerializers.err(err);
        const raw = (err as { raw?: unknown })?.raw;
        if (raw && !(raw instanceof Error)) return raw;
        return err;
      },
    },
    customLogLevel: (_req, res, err) => {
      if (res.statusCode >= 500 || err) return 'error';
      if (res.statusCode >= 400) return 'warn';
      return 'info';
    },
    // Access logs are always on in production; other environments opt in via LOG_HTTP.
    autoLogging: isProduction || logHttp ? autoLogging : false,
  };

  return {
    // `Params`-level flag (not a pinoHttp option): without it PinoLogger.assign()
    // skips the response logger and the access log loses workspaceId/userId.
    assignResponse: true,
    pinoHttp: destination ? [options, destination] : options,
  };
}
