import { Global, Module } from '@nestjs/common';
import { PageAccessService } from './page-access.service';
import { AgentAccessService } from './agent-access.service';
import { ApiKeyRepo } from '@akasha/db/repos/api-key/api-key.repo';

@Global()
@Module({
  providers: [PageAccessService, AgentAccessService, ApiKeyRepo],
  exports: [PageAccessService, AgentAccessService],
})
export class PageAccessModule {}
