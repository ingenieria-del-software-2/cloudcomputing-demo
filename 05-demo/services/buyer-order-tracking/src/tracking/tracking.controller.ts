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
import { TrackingEventDto } from './tracking-event.dto';
import { TrackingService } from './tracking.service';

@Controller()
export class TrackingController {
  constructor(private readonly tracking: TrackingService) {}

  @Post('/internal/events')
  async acceptEvent(
    @Body() event: TrackingEventDto,
    @Headers('x-request-id') requestId: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ) {
    if (this.tracking.shouldQueueInternalEvents()) {
      const result = await this.tracking.enqueueTrackingEvent({
        event,
        requestId: requestId ?? event.event_id,
      });
      response.status(HttpStatus.ACCEPTED);
      return result;
    }

    const result = await this.tracking.handleEvent({
      event,
      requestId: requestId ?? event.event_id,
    });
    response.status(result.duplicate ? HttpStatus.OK : HttpStatus.ACCEPTED);
    return result;
  }

  @Get('/orders/:order_id/tracking')
  async getOrderTracking(@Param('order_id') orderId: string) {
    const record = await this.tracking.findTrackingByOrderId(orderId);

    if (!record) {
      throw new NotFoundException({
        status: 404,
        code: 'TRACKING_NOT_FOUND',
        message: 'tracking not found',
      });
    }

    return record;
  }

  @Get('/buyers/:buyer_id/orders')
  async getBuyerOrders(@Param('buyer_id') buyerId: string) {
    return {
      buyer_id: buyerId,
      orders: await this.tracking.findOrdersByBuyerId(buyerId),
    };
  }
}
