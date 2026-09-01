import { Global, Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { ConfigFaultInjector, FaultInjector } from './config-fault.injector';
import { FaultInjectionInterceptor } from './fault-injection.interceptor';

@Global()
@Module({
  providers: [
    {
      provide: FaultInjector,
      useClass: ConfigFaultInjector,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: FaultInjectionInterceptor,
    },
  ],
  exports: [FaultInjector],
})
export class FaultInjectionModule {}
