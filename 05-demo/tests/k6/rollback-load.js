import { sleep } from 'k6';
import { Counter, Rate } from 'k6/metrics';
import {
  acceptedOr500Or503,
  checkAccepted,
  checkStatus,
  postTransaction,
} from './lib/transactions.js';

const rate = Number(__ENV.LOAD_RATE || 10);
const duration = __ENV.LOAD_DURATION || '90s';
const recoverySleepSeconds = Number(__ENV.RECOVERY_SLEEP_SECONDS || 45);
const preAllocatedVUs = Number(__ENV.LOAD_PRE_ALLOCATED_VUS || 20);
const maxVUs = Number(__ENV.LOAD_MAX_VUS || 50);

let loggedStableTraffic = false;
let loggedCandidateFailure = false;

export const recoverySuccess = new Rate('recovery_success');
export const rollbackLoad202Responses = new Counter('rollback_load_202_responses');
export const rollbackLoad500Responses = new Counter('rollback_load_500_responses');
export const rollbackOutOfContractStatus = new Rate('rollback_out_of_contract_status');

export const options = {
  scenarios: {
    rollback_load: {
      executor: 'constant-arrival-rate',
      exec: 'rollbackLoad',
      rate,
      timeUnit: '1s',
      duration,
      preAllocatedVUs,
      maxVUs,
    },
    final_recovery_check: {
      executor: 'shared-iterations',
      exec: 'finalRecoveryCheck',
      vus: 1,
      iterations: 1,
      startTime: duration,
      maxDuration: '1m',
    },
  },
  summaryTrendStats: ['min', 'avg', 'p(50)', 'p(90)', 'p(99)', 'p(99.9)', 'max'],
  thresholds: {
    checks: ['rate>0.99'],
    http_req_failed: ['rate<0.01'],
    json_parse_error: ['rate==0'],
    non_json_response: ['rate==0'],
    recovery_success: ['rate==1'],
    rollback_load_202_responses: ['count>0'],
    rollback_load_500_responses: ['count>0'],
    rollback_out_of_contract_status: ['rate==0'],
  },
};

const isMeshTransition503 = (res) =>
  res.status === 503 && String(res.body || '').includes('no healthy upstream');

export function rollbackLoad() {
  const tx = postTransaction({
    description: 'k6 rollback load',
    allowNonJson: isMeshTransition503,
    responseCallback: acceptedOr500Or503,
  });
  const meshTransition503 = isMeshTransition503(tx.res);
  const expectedStatus = [202, 500].includes(tx.res.status) || meshTransition503;

  if (tx.res.status === 202) {
    rollbackLoad202Responses.add(1);

    if (!loggedStableTraffic) {
      console.log('[rollback] stable traffic observed: HTTP 202');
      loggedStableTraffic = true;
    }
  }

  if (tx.res.status === 500) {
    rollbackLoad500Responses.add(1);

    if (!loggedCandidateFailure) {
      console.warn(
        '[rollback] expected candidate failure observed: HTTP 500 from broken v2',
      );
      loggedCandidateFailure = true;
    }
  }

  rollbackOutOfContractStatus.add(expectedStatus ? 0 : 1, {
    status: String(tx.res.status),
  });

  checkStatus(
    tx,
    expectedStatus ? [tx.res.status] : [202, 500],
    'load status is 202, 500, or bounded mesh 503',
  );
  sleep(0.1);
}

export function finalRecoveryCheck() {
  if (recoverySleepSeconds > 0) {
    sleep(recoverySleepSeconds);
  }

  const passed = checkAccepted(
    postTransaction({ description: 'k6 rollback final recovery' }),
    'v1',
  );
  recoverySuccess.add(passed);

  if (passed) {
    console.log('[rollback] recovery verified: Gateway is back on v1');
  }
}
