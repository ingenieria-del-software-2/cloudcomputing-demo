import { sleep } from 'k6';
import { Counter } from 'k6/metrics';
import {
  acceptedOr503,
  checkAccepted,
  postTransaction,
} from './lib/transactions.js';

const rate = Number(__ENV.LOAD_RATE || 10);
const duration = __ENV.LOAD_DURATION || '60s';
const preAllocatedVUs = Number(__ENV.LOAD_PRE_ALLOCATED_VUS || 20);
const maxVUs = Number(__ENV.LOAD_MAX_VUS || 50);

export const canaryPromotionResponses = new Counter(
  'canary_promotion_responses',
);

const isMeshPromotion503 = (res) =>
  res.status === 503 &&
  String(res.body || '').includes(
    'upstream connect error or disconnect/reset before headers',
  );

export const options = {
  scenarios: {
    promotion: {
      executor: 'constant-arrival-rate',
      rate,
      timeUnit: '1s',
      duration,
      preAllocatedVUs,
      maxVUs,
    },
  },
  summaryTrendStats: ['min', 'avg', 'p(50)', 'p(90)', 'p(99)', 'p(99.9)', 'max'],
  thresholds: {
    checks: ['rate>0.99'],
    http_req_failed: ['rate<0.01'],
    http_req_duration: ['p(99)<1500'],
    json_parse_error: ['rate==0'],
    non_json_response: ['rate==0'],
    'canary_promotion_responses{version:v2}': ['count>0'],
  },
};

export default function () {
  const tx = postTransaction({
    description: 'k6 canary promotion load',
    allowNonJson: isMeshPromotion503,
    responseCallback: acceptedOr503,
  });
  checkAccepted(tx);

  canaryPromotionResponses.add(1, {
    version: tx.body.version || 'unknown',
  });

  sleep(0.1);
}
