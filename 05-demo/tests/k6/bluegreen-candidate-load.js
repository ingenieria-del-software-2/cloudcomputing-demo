import { sleep } from 'k6';
import { Counter } from 'k6/metrics';
import { checkAccepted, postTransaction } from './lib/transactions.js';

const rate = Number(__ENV.LOAD_RATE || 10);
const duration = __ENV.LOAD_DURATION || '270s';
const preAllocatedVUs = Number(__ENV.LOAD_PRE_ALLOCATED_VUS || 20);
const maxVUs = Number(__ENV.LOAD_MAX_VUS || 50);

export const bluegreenCandidateResponses = new Counter(
  'bluegreen_candidate_responses',
);

export const options = {
  scenarios: {
    candidate: {
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
    'bluegreen_candidate_responses{version:v2}': ['count>0'],
  },
};

export default function () {
  const tx = postTransaction({ description: 'k6 bluegreen candidate load' });
  checkAccepted(tx, 'v2');

  bluegreenCandidateResponses.add(1, {
    version: tx.body.version || 'unknown',
  });

  sleep(0.1);
}
