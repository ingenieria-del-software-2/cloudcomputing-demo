import { check } from "k6";
import http from "k6/http";
import { Counter, Rate } from "k6/metrics";

const targetUrl = __ENV.TARGET_URL || "http://127.0.0.1:8080";

const jsonHeaders = { "Content-Type": "application/json" };
const transactionName = "POST /transactions";

export const accepted = http.expectedStatuses(202);
export const acceptedOr503 = http.expectedStatuses(202, 503);
export const acceptedOr500Or503 = http.expectedStatuses(202, 500, 503);
export const txResponses = new Counter("transaction_responses_total");
export const nonJsonResponses = new Rate("non_json_response");
export const jsonParseErrors = new Rate("json_parse_error");

const parseJson = (res) => {
  const contentType = res.headers["Content-Type"] || "";

  if (!contentType.includes("application/json")) {
    return { body: {}, nonJson: true, parseError: false };
  }

  try {
    return { body: res.json(), nonJson: false, parseError: false };
  } catch (error) {
    return {
      body: {},
      error: String(error),
      nonJson: false,
      parseError: true,
    };
  }
};

const diagnosticBody = (body) =>
  String(body || "")
    .replace(/\s+/g, " ")
    .slice(0, 200);

export function postTransaction({
  description = "k6 transaction",
  allowNonJson = () => false,
  headers,
  key = `k6-${crypto.randomUUID()}`,
  responseCallback = accepted,
} = {}) {
  const res = http.post(
    `${targetUrl}/transactions`,
    JSON.stringify({
      amount: 100,
      currency: "ARS",
      description,
    }),
    {
      responseCallback,
      headers: {
        ...jsonHeaders,
        "Idempotency-Key": key,
        ...headers,
      },
      tags: { name: transactionName },
    },
  );

  const parsed = parseJson(res);
  const allowedNonJson = parsed.nonJson && allowNonJson(res);
  const body = parsed.body;
  const responseTags = {
    name: transactionName,
    status: String(res.status),
  };

  nonJsonResponses.add(parsed.nonJson && !allowedNonJson ? 1 : 0, responseTags);
  jsonParseErrors.add(parsed.parseError ? 1 : 0, responseTags);

  if ((parsed.nonJson && !allowedNonJson) || parsed.parseError) {
    console.error(
      JSON.stringify({
        body: diagnosticBody(res.body),
        content_type: res.headers["Content-Type"] || "",
        error: parsed.error,
        event: parsed.nonJson ? "non_json_response" : "json_parse_error",
        status: res.status,
      }),
    );
  }

  txResponses.add(1, {
    status: String(res.status),
    version: body.version || "unknown",
  });

  return { res, body };
}

export function checkAccepted(tx, expectedVersion) {
  return check(tx, {
    "status is 202": ({ res }) => res.status === 202,
    "receipt is queued": ({ body }) => body.receipt_status === "queued",
    "version is present": ({ body }) => typeof body.version === "string",
    ...(expectedVersion && {
      [`version is ${expectedVersion}`]: ({ body }) =>
        body.version === expectedVersion,
    }),
  });
}

export function checkStatus(tx, allowedStatuses, name = "status is allowed") {
  return check(tx, {
    [name]: ({ res }) => allowedStatuses.includes(res.status),
  });
}
