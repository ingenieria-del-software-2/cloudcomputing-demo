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
import { FulfillmentCommitmentEventDto } from './fulfillment-commitment-event.dto';
import { ShipmentService } from './shipment.service';

@Controller()
export class ShipmentController {
  constructor(private readonly shipments: ShipmentService) {}

  @Post('/internal/events')
  async acceptEvent(
    @Body() event: FulfillmentCommitmentEventDto,
    @Headers('x-request-id') requestId: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.shipments.handleCommitmentConfirmed({
      event,
      requestId: requestId ?? event.event_id,
    });
    response.status(result.duplicate ? HttpStatus.OK : HttpStatus.ACCEPTED);
    return result;
  }

  @Get('/shipments/:shipment_id')
  async getShipment(@Param('shipment_id') shipmentId: string) {
    const shipment = await this.shipments.findShipmentById(shipmentId);

    if (!shipment) {
      throw new NotFoundException({
        status: 404,
        code: 'SHIPMENT_NOT_FOUND',
        message: 'shipment not found',
      });
    }

    return shipment;
  }

  @Get('/shipments/:shipment_id/documents')
  async getShipmentDocuments(@Param('shipment_id') shipmentId: string) {
    const shipment = await this.shipments.findShipmentById(shipmentId);

    if (!shipment) {
      throw new NotFoundException({
        status: 404,
        code: 'SHIPMENT_NOT_FOUND',
        message: 'shipment not found',
      });
    }

    const documents =
      await this.shipments.findDocumentsByShipmentId(shipmentId);
    this.shipments.recordDocumentAccess(documents);

    return {
      shipment_id: shipmentId,
      documents,
    };
  }
}
