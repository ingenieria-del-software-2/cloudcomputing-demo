import { Controller, Get, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Response } from 'express';
import { MetricsService } from '../metrics/metrics.service';
import { ReadinessService } from './readiness.service';

@Controller()
export class OperationalController {
  constructor(
    private readonly metrics: MetricsService,
    private readonly config: ConfigService,
    private readonly readiness: ReadinessService,
  ) {}

  @Get('healthz')
  getHealth() {
    return { status: 'ok' };
  }

  @Get('health')
  getLegacyHealth() {
    return { status: 'ok' };
  }

  @Get('readyz')
  async getReady(@Res({ passthrough: true }) response: Response) {
    const readiness = await this.readiness.check();

    if (readiness.status === 'not_ready') {
      response.status(503);
    }

    return readiness;
  }

  @Get('version')
  getVersion() {
    return {
      service: 'order-management',
      version: this.config.get<string>('SERVICE_VERSION', 'v1'),
      commit: this.config.get<string>('GIT_COMMIT', 'local'),
    };
  }

  @Get('metrics')
  async getMetrics(@Res() response: Response): Promise<void> {
    response.setHeader('Content-Type', this.metrics.contentType);
    response.send(await this.metrics.render());
  }
}
