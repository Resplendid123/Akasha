/**
 * Process identity for the `service` log field (see docs/plans/log-standardization-plan.md §3).
 *
 * Both the main API and the collaboration server share one pino config, so the
 * service name is passed explicitly into `createPinoConfig()`. The env var is a
 * fallback for shared code that runs before / outside DI (bootstrap-logger).
 */
export const SERVICE_NAME_SERVER = 'akasha-server';
export const SERVICE_NAME_COLLAB = 'akasha-collab';

export function resolveServiceName(
  env: NodeJS.ProcessEnv = process.env,
): string {
  const fromEnv = env.SERVICE_NAME?.trim();
  return fromEnv && fromEnv.length > 0 ? fromEnv : SERVICE_NAME_SERVER;
}
