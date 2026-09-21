import { Module } from '@nestjs/common';
import { PageVisitController } from './page-visit.controller';
import { PageVisitService } from './page-visit.service';

@Module({
  controllers: [PageVisitController],
  providers: [PageVisitService],
})
export class PageVisitModule {}
