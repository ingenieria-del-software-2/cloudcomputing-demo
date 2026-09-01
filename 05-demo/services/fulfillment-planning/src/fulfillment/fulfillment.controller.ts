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
import { FulfillmentService } from './fulfillment.service';
import { OrderConfirmedEventDto } from './order-confirmed-event.dto';

@Controller()
export class FulfillmentController {
  constructor(private readonly fulfillment: FulfillmentService) {}

  @Post('/internal/events')
  async acceptEvent(
    @Body() event: OrderConfirmedEventDto,
    @Headers('x-request-id') requestId: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ) {
    if (this.fulfillment.shouldQueueInternalEvents()) {
      const result = await this.fulfillment.enqueueOrderConfirmedEvent({
        event,
        requestId: requestId ?? event.event_id,
      });
      response.status(HttpStatus.ACCEPTED);
      return result;
    }

    const result = await this.fulfillment.handleOrderConfirmed({
      event,
      requestId: requestId ?? event.event_id,
    });
    response.status(result.duplicate ? HttpStatus.OK : HttpStatus.ACCEPTED);
    return result;
  }

  @Get('/fulfillment/orders/:order_id')
  async getOrderCommitment(@Param('order_id') orderId: string) {
    const commitment = await this.fulfillment.findCommitmentByOrderId(orderId);

    if (!commitment) {
      throw new NotFoundException({
        status: 404,
        code: 'FULFILLMENT_COMMITMENT_NOT_FOUND',
        message: 'fulfillment commitment not found',
      });
    }

    return commitment;
  }

  @Get('/inventory/:seller_sku')
  async getInventory(@Param('seller_sku') sellerSku: string) {
    const item = await this.fulfillment.findInventoryItem(sellerSku);

    if (!item) {
      throw new NotFoundException({
        status: 404,
        code: 'INVENTORY_ITEM_NOT_FOUND',
        message: 'inventory item not found',
      });
    }

    return item;
  }
}
