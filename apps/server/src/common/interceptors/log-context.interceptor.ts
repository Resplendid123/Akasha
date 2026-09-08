import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { PinoLogger } from 'nestjs-pino';

/**
 * Adds `userId` to every log line of the current request (see
 * docs/plans/log-standardization-plan.md §4.2.1).
 *
 * A single global interceptor is used instead of injecting into each auth guard
 * (jwt-auth / sso-arch-auth / iself-agent-auth / setup.guard): interceptors run
 * after guards but before the handler, which is the one shared point where the
 * user is already resolved. The trade-off is that logs emitted *inside* the
 * guards (e.g. authentication failures) still have an empty `userId` — accepted
 * in §4.5, and those lines remain correlatable via `requestId`.
 */
@Injectable()
export class LogContextInterceptor implements NestInterceptor {
  constructor(private readonly logger: PinoLogger) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    // Global interceptors do run for ws handlers, which have no pino ALS store —
    // assign() would throw there.
    if (context.getType() !== 'http') {
      return next.handle();
    }

    const request = context.switchToHttp().getRequest();
    const userId = request.user?.user?.id;

    if (userId) {
      try {
        this.logger.assign({ userId });
      } catch {
        // Log enrichment must never fail a request.
      }
    }

    return next.handle();
  }
}
