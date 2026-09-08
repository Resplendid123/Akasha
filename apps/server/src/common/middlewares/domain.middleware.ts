import { Injectable, NestMiddleware, NotFoundException } from '@nestjs/common';
import { FastifyRequest, FastifyReply } from 'fastify';
import { PinoLogger } from 'nestjs-pino';
import { EnvironmentService } from '../../integrations/environment/environment.service';
import { WorkspaceRepo } from '@akasha/db/repos/workspace/workspace.repo';

@Injectable()
export class DomainMiddleware implements NestMiddleware {
  constructor(
    private workspaceRepo: WorkspaceRepo,
    private environmentService: EnvironmentService,
    private pinoLogger: PinoLogger,
  ) {}

  /**
   * Puts `workspaceId` on every subsequent log line of this request, including
   * the access log. Normalized to `''` because the log schema forbids `null`
   * (docs/plans/log-standardization-plan.md §3) — the request property itself
   * keeps its existing `null` contract for business code.
   *
   * `assign()` throws when called outside the pino ALS context; a middleware
   * always runs inside it, but the guard stays so log enrichment can never fail
   * a request.
   */
  private assignWorkspaceId(workspaceId: string | null) {
    try {
      this.pinoLogger.assign({ workspaceId: workspaceId ?? '' });
    } catch {
      // ignored on purpose
    }
  }
  async use(
    req: FastifyRequest['raw'],
    res: FastifyReply['raw'],
    next: () => void,
  ) {
    if (this.environmentService.isSelfHosted()) {
      const workspace = await this.workspaceRepo.findFirst();
      if (!workspace) {
        //throw new NotFoundException('Workspace not found');
        (req as any).workspaceId = null;
        this.assignWorkspaceId(null);
        return next();
      }

      // TODO: unify
      (req as any).workspaceId = workspace.id;
      (req as any).workspace = workspace;
      this.assignWorkspaceId(workspace.id);
    } else if (this.environmentService.isCloud()) {
      const header = req.headers.host;
      const subdomain = header.split('.')[0];

      const workspace = await this.workspaceRepo.findByHostname(subdomain);

      if (!workspace) {
        (req as any).workspaceId = null;
        this.assignWorkspaceId(null);
        return next();
      }

      (req as any).workspaceId = workspace.id;
      (req as any).workspace = workspace;
      this.assignWorkspaceId(workspace.id);
    }

    next();
  }
}
