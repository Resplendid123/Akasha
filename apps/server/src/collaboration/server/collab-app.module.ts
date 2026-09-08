import { Module } from '@nestjs/common';
import { AppController } from '../../app.controller';
import { AppService } from '../../app.service';
import { EnvironmentModule } from '../../integrations/environment/environment.module';
import { EnvironmentService } from '../../integrations/environment/environment.service';
import { CollaborationModule } from '../collaboration.module';
import { DatabaseModule } from '@akasha/db/database.module';
import { QueueModule } from '../../integrations/queue/queue.module';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { HealthModule } from '../../integrations/health/health.module';
import { CollaborationController } from './collaboration.controller';
import { LoggerModule } from '../../common/logger/logger.module';
import { SERVICE_NAME_COLLAB } from '../../common/logger/log-service-name';
import { resolveRequestId } from '../../common/logger/request-id';
import { ClsModule } from 'nestjs-cls';
import { RedisModule } from '@nestjs-labs/nestjs-ioredis';
import { RedisConfigService } from '../../integrations/redis/redis-config.service';
import { CaslModule } from '../../core/casl/casl.module';
import { CacheModule } from '@nestjs/cache-manager';
import KeyvRedis from '@keyv/redis';

@Module({
  imports: [
    // Must stay ahead of LoggerModule so the CLS middleware is registered first.
    ClsModule.forRoot({
      global: true,
      middleware: {
        mount: true,
        // Required: defaults to false, and without it idGenerator is never called.
        generateId: true,
        idGenerator: (req) => resolveRequestId(req),
        // Under Fastify this middleware receives the *native* ServerResponse,
        // not a FastifyReply, so only setHeader() exists here.
        setup: (cls, req, res) => {
          res.setHeader('x-request-id', cls.getId());
        },
      },
    }),
    LoggerModule.forRoot(SERVICE_NAME_COLLAB),
    DatabaseModule,
    EnvironmentModule,
    CaslModule,
    CollaborationModule,
    QueueModule,
    HealthModule,
    EventEmitterModule.forRoot(),
    RedisModule.forRootAsync({
      useClass: RedisConfigService,
    }),
    CacheModule.registerAsync({
      isGlobal: true,
      useFactory: async (environmentService: EnvironmentService) => {
        const redisUrl = environmentService.getRedisUrl();

        return {
          ttl: 5 * 1000,
          stores: [new KeyvRedis(redisUrl)],
        };
      },
      inject: [EnvironmentService],
    }),
  ],
  controllers: [
    AppController,
    ...(process.env.COLLAB_SHOW_STATS?.toLowerCase() === 'true'
      ? [CollaborationController]
      : []),
  ],
  providers: [AppService],
})
export class CollabAppModule {}
