import {
  Body,
  Controller,
  Get,
  Headers,
  HttpStatus,
  NotFoundException,
  Param,
  Post,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { FulfillmentFailedEventDto } from './fulfillment-failed-event.dto';
import { OrderService } from './order.service';
import { PaymentApprovedDto } from './payment-approved.dto';

@Controller()
export class OrderController {
  constructor(private readonly orders: OrderService) {}

  @Post('/internal/payments/approved')
  async approvePayment(
    @Body() body: PaymentApprovedDto,
    @Headers('x-request-id') requestId: string,
    @Headers('x-correlation-id') correlationId: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.orders.approvePayment({
      body,
      requestId,
      correlationId,
    });
    response.status(result.duplicate ? HttpStatus.OK : HttpStatus.CREATED);
    return result;
  }

  @Post('/internal/fulfillment/failed')
  async cancelAfterFulfillmentFailed(
    @Body() body: FulfillmentFailedEventDto,
    @Headers('x-request-id') requestId: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.orders.cancelAfterFulfillmentFailed({
      event: body,
      requestId: requestId ?? body.event_id,
    });
    response.status(result.duplicate ? HttpStatus.OK : HttpStatus.ACCEPTED);
    return result;
  }

  @Get('/orders/:order_id')
  async getOrder(@Param('order_id') orderId: string) {
    const order = await this.orders.findByOrderId(orderId);

    if (!order) {
      throw new NotFoundException({
        status: 404,
        code: 'ORDER_NOT_FOUND',
        message: 'order not found',
      });
    }

    return order;
  }
}
