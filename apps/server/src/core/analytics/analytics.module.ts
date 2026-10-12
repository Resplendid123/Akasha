import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { AnalyticsController } from './analytics.controller';
import { AnalyticsService } from './analytics.service';
import { AgentOpInterceptor } from './agent-op.interceptor';

@Module({
  controllers: [AnalyticsController],
  providers: [
    AnalyticsService,
    { provide: APP_INTERCEPTOR, useClass: AgentOpInterceptor },
  ],
})
export class AnalyticsModule {}
