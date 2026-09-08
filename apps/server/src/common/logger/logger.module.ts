import { DynamicModule, Module } from '@nestjs/common';
import { LoggerModule as PinoLoggerModule } from 'nestjs-pino';
import { createPinoConfig } from './pino.config';

@Module({})
export class LoggerModule {
  /**
   * The service name is an explicit argument rather than an env lookup because
   * module decorators are evaluated at import time, which makes env-var timing
   * fragile across the two entrypoints.
   */
  static forRoot(serviceName: string): DynamicModule {
    return {
      module: LoggerModule,
      imports: [PinoLoggerModule.forRoot(createPinoConfig(serviceName))],
      exports: [PinoLoggerModule],
    };
  }
}
