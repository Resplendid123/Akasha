import { Cache } from 'cache-manager';
import { Logger, LoggerService } from '@nestjs/common';

export async function withCache<T>(
  cacheManager: Cache,
  key: string,
  ttlMs: number,
  fn: () => Promise<T>,
  logger: LoggerService = new Logger('withCache'),
): Promise<T> {
  try {
    const cached = await cacheManager.get<{ v: T }>(key);
    if (cached !== undefined && cached !== null) {
      return cached.v;
    }
  } catch (err) {
    logger.warn(
      { key, op: 'get', err },
      'Cache read failed, falling back to source',
    );
  }

  const value = await fn();

  try {
    await cacheManager.set(key, { v: value }, ttlMs);
  } catch (err) {
    logger.warn({ key, op: 'set', err }, 'Cache write failed');
  }

  return value;
}
