import { SetMetadata } from '@nestjs/common';
import { AgentCapability } from '../auth/agent-capability';

export const AGENT_CAPABILITY = 'agentCapability';

export const AgentCallable = (capability: AgentCapability) =>
  SetMetadata(AGENT_CAPABILITY, capability);
