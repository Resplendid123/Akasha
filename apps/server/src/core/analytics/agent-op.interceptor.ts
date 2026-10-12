import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable, tap } from 'rxjs';
import { AnalyticsEventRepo } from '@akasha/db/repos/analytics/analytics-event.repo';
import { getAgentAccessContext } from '../../common/auth/agent-access-context';
import { AGENT_CAPABILITY } from '../../common/decorators/agent-callable.decorator';

/**
 * Records one agent_op event per REST call authenticated with an agent API
 * key. Runs after JwtAuthGuard, so `request.agentAccess` is already set;
 * human requests pass through untouched. Recording never affects the
 * response.
 */
@Injectable()
export class AgentOpInterceptor implements NestInterceptor {
  private readonly logger = new Logger(AgentOpInterceptor.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly analyticsEventRepo: AnalyticsEventRepo,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    if (context.getType() !== 'http') return next.handle();

    const request = context.switchToHttp().getRequest();
    const agentAccess = getAgentAccessContext(request);
    if (!agentAccess) return next.handle();

    const capability = this.reflector.getAllAndOverride<string>(
      AGENT_CAPABILITY,
      [context.getHandler(), context.getClass()],
    );
    const op = capability ?? 'other';

    const record = (outcome: 'ok' | 'error') => {
      this.analyticsEventRepo
        .insertAgentOp({
          workspaceId: agentAccess.workspace.id,
          agentUserId: agentAccess.agentUser.id,
          op,
          channel: 'api',
          apiKeyId: agentAccess.apiKeyId,
          delegatedUserId: agentAccess.delegatedUser?.id,
          outcome,
        })
        .catch((error) =>
          this.logger.warn(`Failed to record agent_op event: ${error}`),
        );
    };

    return next.handle().pipe(
      tap({
        next: () => record('ok'),
        error: () => record('error'),
      }),
    );
  }
}
