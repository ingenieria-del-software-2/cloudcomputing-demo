import { INestApplication } from '@nestjs/common';

export function configureApp(app: INestApplication): void {
  app.enableShutdownHooks();
}
