import { sleep } from 'k6';
import http from 'k6/http';
import { checkAccepted, postTransaction } from './lib/transactions.js';

const expectedVersion = __ENV.EXPECTED_VERSION || 'v1';
const attempts = Math.max(1, Number(__ENV.VALIDATE_ATTEMPTS || 1));
const sleepSeconds = Math.max(0, Number(__ENV.VALIDATE_SLEEP_SECONDS || 1));

const retryableStatuses = http.expectedStatuses(202, 404, 500, 503);

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

const isAccepted = ({ res, body }) =>
  res.status === 202 &&
  body.receipt_status === 'queued' &&
  body.version === expectedVersion;

const isRetryableNonJson = (res, isLastAttempt) =>
  !isLastAttempt && [404, 500, 503].includes(res.status);

export default function () {
  let tx;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const isLastAttempt = attempt === attempts;

    tx = postTransaction({
      allowNonJson: (res) => isRetryableNonJson(res, isLastAttempt),
      description: `k6 validate ${expectedVersion}`,
      responseCallback: isLastAttempt ? undefined : retryableStatuses,
    });

    if (isAccepted(tx)) {
      checkAccepted(tx, expectedVersion);
      return;
    }

    if (!isLastAttempt) {
      sleep(sleepSeconds);
    }
  }

  checkAccepted(tx, expectedVersion);
}
