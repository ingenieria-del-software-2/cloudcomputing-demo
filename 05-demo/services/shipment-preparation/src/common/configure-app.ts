import {
  BadRequestException,
  INestApplication,
  ValidationError,
  ValidationPipe,
} from '@nestjs/common';

export function configureApp(app: INestApplication): void {
  app.enableShutdownHooks();
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      exceptionFactory: (errors) =>
        new BadRequestException({
          status: 400,
          code: 'INVALID_REQUEST',
          message: firstValidationMessage(errors),
        }),
    }),
  );
}

function firstValidationMessage(errors: ValidationError[]): string {
  for (const error of errors) {
    const constraint = Object.values(error.constraints ?? {})[0];

    if (constraint) {
      return constraint;
    }
  }

  return 'request validation failed';
}
