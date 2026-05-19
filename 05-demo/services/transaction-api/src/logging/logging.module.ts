import { Module } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { hostname } from 'node:os';
import { StructuredLoggerService } from './structured-logger.service';

@Module({
  imports: [
    LoggerModule.forRoot({
      pinoHttp: {
        base: {
          pid: process.pid,
          hostname: hostname(),
          service: 'transaction-api',
        },
        genReqId: (request: IncomingMessage, response: ServerResponse) => {
          const requestId =
            request.headers['x-request-id'] ?? `req_${randomUUID()}`;
          const normalizedRequestId = Array.isArray(requestId)
            ? (requestId[0] ?? `req_${randomUUID()}`)
            : requestId;

          request.headers['x-request-id'] = normalizedRequestId;
          response.setHeader('x-request-id', normalizedRequestId);
          return normalizedRequestId;
        },
        autoLogging: {
          ignore: (request: IncomingMessage) => request.url === '/metrics',
        },
        quietReqLogger: true,
        redact: [
          'req.headers.authorization',
          'req.headers.cookie',
          'req.headers.idempotency-key',
          'res.headers.set-cookie',
        ],
      },
    }),
  ],
  providers: [StructuredLoggerService],
  exports: [StructuredLoggerService],
})
export class LoggingModule {}
