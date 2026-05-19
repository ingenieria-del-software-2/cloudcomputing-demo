import {
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CreateTransactionUseCase } from './application/create-transaction.use-case';
import { CreateTransactionDto } from './dto/create-transaction.dto';

@Controller('transactions')
export class TransactionController {
  constructor(
    private readonly createTransaction: CreateTransactionUseCase,
    private readonly config: ConfigService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  async create(
    @Body() body: CreateTransactionDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Headers('x-request-id') requestId: string,
  ) {
    return this.createTransaction.execute({
      body,
      idempotencyKey,
      requestId,
      version: this.version(),
    });
  }

  private version(): string {
    return this.config.get<string>('SERVICE_VERSION', 'v1');
  }
}
