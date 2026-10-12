import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AuthUser } from '../../common/decorators/auth-user.decorator';
import { AuthWorkspace } from '../../common/decorators/auth-workspace.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { User, Workspace } from '@akasha/db/types/entity.types';
import WorkspaceAbilityFactory from '../casl/abilities/workspace-ability.factory';
import {
  WorkspaceCaslAction,
  WorkspaceCaslSubject,
} from '../casl/interfaces/workspace-ability.type';
import { AnalyticsService } from './analytics.service';
import {
  AnalyticsOverviewQueryDto,
  TrackPageViewDto,
} from './dto/analytics.dto';

@UseGuards(JwtAuthGuard)
@Controller('analytics')
export class AnalyticsController {
  constructor(
    private readonly analyticsService: AnalyticsService,
    private readonly workspaceAbility: WorkspaceAbilityFactory,
  ) {}

  @HttpCode(HttpStatus.NO_CONTENT)
  @Post('track')
  async track(
    @Body() dto: TrackPageViewDto,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ): Promise<void> {
    await this.analyticsService.trackPageView(dto, user, workspace);
  }

  @HttpCode(HttpStatus.OK)
  @Get('overview')
  async overview(
    @Query() query: AnalyticsOverviewQueryDto,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    const ability = this.workspaceAbility.createForUser(user, workspace);
    if (
      ability.cannot(WorkspaceCaslAction.Manage, WorkspaceCaslSubject.Settings)
    ) {
      throw new ForbiddenException();
    }

    return this.analyticsService.getOverview({
      workspace,
      range: query.range ?? '30d',
      spaceId: query.spaceId,
    });
  }
}
