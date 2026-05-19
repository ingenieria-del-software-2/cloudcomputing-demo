type OrderCreatedResponse = {
  order_id: string;
  payment_id: string;
  status: string;
  duplicate: boolean;
  version: string;
};

type TrackingResponse = {
  order_id: string;
  buyer_id: string;
  visible_status: string;
  correlation_id: string;
  estimated_delivery_date?: string;
  timeline: Array<{
    status: string;
    event_name: string;
    correlation_id: string;
  }>;
};

const orderManagementUrl =
  process.env.ORDER_MANAGEMENT_URL ?? 'http://localhost:3010';
const buyerTrackingUrl =
  process.env.BUYER_ORDER_TRACKING_URL ?? 'http://localhost:3040';

jest.setTimeout(60000);

describe('full order-to-buyer-tracking saga', () => {
  it('makes the buyer-visible tracking state reach READY_TO_DISPATCH', async () => {
    const suffix = Date.now();
    const paymentId = `pay_full_saga_${suffix}`;
    const buyerId = `buyer_full_saga_${suffix}`;
    const correlationId = `checkout_full_saga_${suffix}`;

    const order = await postPaymentApproved({
      paymentId,
      buyerId,
      correlationId,
    });

    expect(order).toMatchObject({
      payment_id: paymentId,
      status: 'ORDER_CONFIRMED',
      duplicate: false,
    });

    const tracking = await waitForTrackingStatus(
      order.order_id,
      'READY_TO_DISPATCH',
    );

    expect(tracking).toMatchObject({
      order_id: order.order_id,
      buyer_id: buyerId,
      visible_status: 'READY_TO_DISPATCH',
      correlation_id: correlationId,
    });
    expect(tracking.estimated_delivery_date).toBeDefined();
    expect(tracking.timeline.map((entry) => entry.status)).toEqual([
      'ORDER_CONFIRMED',
      'FULFILLMENT_COMMITTED',
      'READY_TO_DISPATCH',
    ]);
    expect(
      tracking.timeline.every(
        (entry) => entry.correlation_id === correlationId,
      ),
    ).toBe(true);

    const buyerOrders = await getJson<{ orders: TrackingResponse[] }>(
      `${buyerTrackingUrl}/buyers/${buyerId}/orders`,
    );
    expect(buyerOrders.orders).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          order_id: order.order_id,
          visible_status: 'READY_TO_DISPATCH',
        }),
      ]),
    );

    const metrics = await getText(`${buyerTrackingUrl}/metrics`);
    expect(metrics).toContain('buyer_tracking_freshness_seconds');
    expect(metrics).toContain('buyer_tracking_freshness_p95');
    expect(metrics).toContain('critical_order_journey_under_60s_ratio');
    expect(metrics).toContain('event_backlog_depth');
    expect(metrics).toContain('event_dlq_depth');
    expect(metrics).toContain('dynamodb_request_duration_seconds');
  });
});

async function postPaymentApproved(input: {
  paymentId: string;
  buyerId: string;
  correlationId: string;
}): Promise<OrderCreatedResponse> {
  const response = await fetch(
    `${orderManagementUrl}/internal/payments/approved`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-correlation-id': input.correlationId,
        'x-request-id': `req_${input.paymentId}`,
      },
      body: JSON.stringify({
        payment_id: input.paymentId,
        cart_id: `cart_${input.paymentId}`,
        buyer_id: input.buyerId,
        seller_id: 'seller_445566',
        site_id: 'MLA',
        currency: 'ARS',
        gross_amount: 12999.99,
        payment_approved_at: new Date().toISOString(),
        items: [
          {
            item_id: 'CFB-CARPINCHO-USB',
            seller_sku: 'CARPINCHO-USB-C',
            quantity: 1,
            unit_price: 12999.99,
          },
        ],
      }),
    },
  );

  if (response.status !== 201) {
    throw new Error(
      `payment approval failed: ${response.status} ${await response.text()}`,
    );
  }

  return (await response.json()) as OrderCreatedResponse;
}

async function waitForTrackingStatus(
  orderId: string,
  expectedStatus: string,
): Promise<TrackingResponse> {
  const deadline = Date.now() + 45000;
  let lastBody = '';

  while (Date.now() < deadline) {
    const response = await fetch(
      `${buyerTrackingUrl}/orders/${orderId}/tracking`,
    );

    if (response.status === 200) {
      const tracking = (await response.json()) as TrackingResponse;

      if (tracking.visible_status === expectedStatus) {
        return tracking;
      }

      lastBody = JSON.stringify(tracking);
    } else {
      lastBody = await response.text();
    }

    await sleep(500);
  }

  throw new Error(
    `tracking ${orderId} did not reach ${expectedStatus}. Last response: ${lastBody}`,
  );
}

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(
      `GET ${url} failed: ${response.status} ${await response.text()}`,
    );
  }

  return (await response.json()) as T;
}

async function getText(url: string): Promise<string> {
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(
      `GET ${url} failed: ${response.status} ${await response.text()}`,
    );
  }

  return response.text();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
