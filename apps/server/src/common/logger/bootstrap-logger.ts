import { writeSync } from 'node:fs';
import { hostname } from 'node:os';
import { resolveServiceName } from './log-service-name';

/**
 * Structured logging for code that runs before (or outside) the DI container,
 * where nestjs-pino is not available: bootstrap catch blocks, env validation,
 * early module loading.
 *
 * Emits the same JSON shape as the pino pipeline (docs/plans/log-standardization-plan.md §3)
 * to stdout so Vector can parse every line with `parse_json` and no line needs a
 * regex fallback. Empty-string defaults for requestId/workspaceId/userId keep the
 * ClickHouse columns non-Nullable.
 */
type BootstrapLogLevel = 'debug' | 'info' | 'warn' | 'error' | 'fatal';

export type BootstrapLogFields = {
  context: string;
  msg: string;
  err?: unknown;
  [key: string]: unknown;
};

function serializeError(err: unknown): Record<string, unknown> | undefined {
  if (err === undefined || err === null) return undefined;
  if (err instanceof Error) {
    return {
      type: err.constructor?.name ?? 'Error',
      message: err.message,
      stack: err.stack,
    };
  }
  return { type: typeof err, message: String(err) };
}

/** Never let a logging call throw: circular refs / BigInt must not mask the real error. */
function safeStringify(value: Record<string, unknown>): string {
  try {
    return JSON.stringify(value);
  } catch {
    const seen = new WeakSet<object>();
    return JSON.stringify(value, (_key, val) => {
      if (typeof val === 'bigint') return String(val);
      if (typeof val === 'object' && val !== null) {
        if (seen.has(val)) return '[Circular]';
        seen.add(val);
      }
      return val;
    });
  }
}

function emit(level: BootstrapLogLevel, fields: BootstrapLogFields): void {
  const { context, msg, err, ...rest } = fields;
  const line: Record<string, unknown> = {
    time: new Date().toISOString(),
    level,
    msg,
    context,
    service: resolveServiceName(),
    env: process.env.NODE_ENV ?? '',
    requestId: '',
    workspaceId: '',
    userId: '',
    pid: process.pid,
    hostname: hostname(),
    ...rest,
  };

  const serializedError = serializeError(err);
  if (serializedError) line.err = serializedError;

  const payload = `${safeStringify(line)}\n`;

  // fd 1 (stdout) for every level: Vector collects the container's stdout stream,
  // and splitting across stderr would reorder lines relative to pino's output.
  //
  // writeSync, not process.stdout.write: every caller here is on a failure path
  // that ends in `process.exit()`, and stdout is a pipe in containers. Buffered
  // writes are dropped when the process exits before the pipe drains — measured
  // at 16 of 1000 lines surviving against a slow consumer, i.e. exactly the
  // startup diagnostics we need would be the part that goes missing.
  try {
    writeSync(1, payload);
  } catch {
    // EAGAIN on a non-blocking pipe, or a closed fd 1. A logging call must never
    // be the reason a shutdown path fails, so fall back and accept the risk.
    process.stdout.write(payload);
  }
}

export const bootstrapLogger = {
  debug: (fields: BootstrapLogFields) => emit('debug', fields),
  info: (fields: BootstrapLogFields) => emit('info', fields),
  warn: (fields: BootstrapLogFields) => emit('warn', fields),
  error: (fields: BootstrapLogFields) => emit('error', fields),
  fatal: (fields: BootstrapLogFields) => emit('fatal', fields),
};
