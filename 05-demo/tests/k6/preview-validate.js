import { checkAccepted, postTransaction } from './lib/transactions.js';

export const options = {
  vus: 1,
  iterations: 1,
  summaryTrendStats: ['min', 'avg', 'p(50)', 'p(90)', 'p(99)', 'p(99.9)', 'max'],
  thresholds: {
    checks: ['rate==1'],
    http_req_failed: ['rate<0.01'],
    http_req_duration: ['p(99)<1000'],
    json_parse_error: ['rate==0'],
    non_json_response: ['rate==0'],
  },
};

export default function () {
  const stable = postTransaction({ description: 'k6 preview stable' });
  checkAccepted(stable, 'v1');

  const preview = postTransaction({
    description: 'k6 preview v2',
    headers: {
      'x-release-track': 'preview',
    },
  });
  checkAccepted(preview, 'v2');
}
