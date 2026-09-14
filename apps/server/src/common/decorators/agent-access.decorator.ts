import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { getAgentAccessContext } from '../auth/agent-access-context';

export const AgentAccess = createParamDecorator(
  (_data: unknown, context: ExecutionContext) =>
    getAgentAccessContext(context.switchToHttp().getRequest()),
);
