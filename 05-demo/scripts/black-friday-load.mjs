#!/usr/bin/env node

const DEFAULT_SKUS = [
  {
    sellerSku: "CARPINCHO-USB-C",
    itemId: "CFB-CARPINCHO-USB",
    unitPrice: 12999.99,
    quantity: 1,
    weight: 5,
  },
  {
    sellerSku: "MATE-STANLEY-NO-OFICIAL",
    itemId: "CFB-MATE-STANLEY",
    unitPrice: 52999.99,
    quantity: 1,
    weight: 3,
  },
  {
    sellerSku: "TECLADO-MECANICO-RUIDOSO",
    itemId: "CFB-TECLADO-MECANICO",
    unitPrice: 39999.99,
    quantity: 1,
    weight: 2,
  },
];

const args = parseArgs(process.argv.slice(2));

if (args.help) {
  printHelp();
  process.exit(0);
}

const config = {
  orderManagementUrl: stringOption(
    args.url,
    process.env.ORDER_MANAGEMENT_URL,
    "http://localhost:3010",
  ),
  totalAttempts: integerOption(
    args.orders,
    process.env.BLACK_FRIDAY_ORDERS,
    20,
  ),
  concurrency: integerOption(
    args.concurrency,
    process.env.BLACK_FRIDAY_CONCURRENCY,
    5,
  ),
  duplicateRate: rateOption(
    args.duplicateRate,
    process.env.BLACK_FRIDAY_DUPLICATE_RATE,
    0.15,
  ),
  skus: parseSkus(args.skus ?? process.env.BLACK_FRIDAY_SKUS),
  seed: stringOption(args.seed, process.env.BLACK_FRIDAY_SEED, `${Date.now()}`),
  dryRun: Boolean(args.dryRun),
};

validateConfig(config);

const attempts = buildAttempts(config);

if (config.dryRun) {
  console.log(
    JSON.stringify(
      {
        dry_run: true,
        config: printableConfig(config),
        attempts: attempts.map((attempt) => ({
          payment_id: attempt.payload.payment_id,
          seller_sku: attempt.payload.items[0]?.seller_sku,
          duplicate: attempt.duplicate,
        })),
      },
      null,
      2,
    ),
  );
  process.exit(0);
}

const startedAt = Date.now();
const results = await runLoad(config, attempts);
const durationSeconds = (Date.now() - startedAt) / 1000;

console.log(
  JSON.stringify(
    {
      config: printableConfig(config),
      duration_seconds: Number(durationSeconds.toFixed(3)),
      attempts: attempts.length,
      unique_payments: new Set(
        attempts.map((attempt) => attempt.payload.payment_id),
      ).size,
      duplicates: attempts.filter((attempt) => attempt.duplicate).length,
      status_counts: countBy(results, (result) => `${result.status}`),
      outcome_counts: countBy(results, (result) => result.outcome),
      failures: results
        .filter((result) => result.outcome === "failed")
        .slice(0, 10),
    },
    null,
    2,
  ),
);

if (results.some((result) => result.outcome === "failed")) {
  process.exitCode = 1;
}

async function runLoad(config, attempts) {
  const results = [];
  let cursor = 0;

  await Promise.all(
    Array.from(
      { length: Math.min(config.concurrency, attempts.length) },
      async () => {
        while (cursor < attempts.length) {
          const index = cursor;
          cursor += 1;
          results[index] = await sendAttempt(config, attempts[index]);
        }
      },
    ),
  );

  return results;
}

async function sendAttempt(config, attempt) {
  try {
    const response = await fetch(
      `${config.orderManagementUrl}/internal/payments/approved`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-correlation-id": attempt.correlationId,
          "x-request-id": attempt.requestId,
        },
        body: JSON.stringify(attempt.payload),
      },
    );
    const body = await response.text();
    const outcome =
      response.status === 200 || response.status === 201
        ? "accepted"
        : "failed";

    return {
      payment_id: attempt.payload.payment_id,
      duplicate: attempt.duplicate,
      status: response.status,
      outcome,
      body: outcome === "failed" ? body.slice(0, 500) : undefined,
    };
  } catch (error) {
    return {
      payment_id: attempt.payload.payment_id,
      duplicate: attempt.duplicate,
      status: "network_error",
      outcome: "failed",
      body: error instanceof Error ? error.message : "unknown error",
    };
  }
}

function buildAttempts(config) {
  const uniqueCount = Math.max(
    1,
    Math.round(config.totalAttempts * (1 - config.duplicateRate)),
  );
  const random = seededRandom(config.seed);
  const uniqueAttempts = Array.from({ length: uniqueCount }, (_, index) => {
    const sku = weightedPick(config.skus, random);
    const paymentId = `pay_bf_${config.seed}_${index + 1}`;
    const correlationId = `checkout_bf_${config.seed}_${index + 1}`;

    return {
      duplicate: false,
      correlationId,
      requestId: `req_${paymentId}_1`,
      payload: {
        payment_id: paymentId,
        cart_id: `cart_bf_${config.seed}_${index + 1}`,
        buyer_id: `buyer_bf_${config.seed}_${(index % 10) + 1}`,
        seller_id: "seller_445566",
        site_id: "MLA",
        currency: "ARS",
        gross_amount: Number((sku.unitPrice * sku.quantity).toFixed(2)),
        payment_approved_at: new Date().toISOString(),
        items: [
          {
            item_id: sku.itemId,
            seller_sku: sku.sellerSku,
            quantity: sku.quantity,
            unit_price: sku.unitPrice,
          },
        ],
      },
    };
  });
  const attempts = [...uniqueAttempts];

  while (attempts.length < config.totalAttempts) {
    const original =
      uniqueAttempts[Math.floor(random() * uniqueAttempts.length)];
    const duplicateNumber =
      attempts.filter(
        (attempt) => attempt.payload.payment_id === original.payload.payment_id,
      ).length + 1;
    attempts.push({
      ...original,
      duplicate: true,
      requestId: `req_${original.payload.payment_id}_${duplicateNumber}`,
    });
  }

  return shuffle(attempts, random);
}

function parseArgs(argv) {
  const parsed = {};

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--help" || arg === "-h") {
      parsed.help = true;
      continue;
    }

    if (arg === "--dry-run") {
      parsed.dryRun = true;
      continue;
    }

    const [rawKey, inlineValue] = arg.split("=", 2);
    if (!rawKey.startsWith("--")) {
      throw new Error(`unexpected argument: ${arg}`);
    }

    const key = rawKey
      .slice(2)
      .replace(/-([a-z])/g, (_, char) => char.toUpperCase());
    parsed[key] = inlineValue ?? argv[index + 1];

    if (inlineValue === undefined) {
      index += 1;
    }
  }

  return parsed;
}

function parseSkus(value) {
  if (!value) {
    return DEFAULT_SKUS;
  }

  return value.split(",").map((entry) => {
    const [sellerSku, weight, quantity, unitPrice, itemId] = entry.split(":");

    if (!sellerSku) {
      throw new Error(`invalid SKU entry: ${entry}`);
    }

    return {
      sellerSku,
      weight: positiveNumber(weight, 1),
      quantity: Math.max(1, Math.floor(positiveNumber(quantity, 1))),
      unitPrice: positiveNumber(unitPrice, 1000),
      itemId: itemId || sellerSku,
    };
  });
}

function validateConfig(config) {
  if (config.totalAttempts < 1) {
    throw new Error("orders must be greater than 0");
  }

  if (config.concurrency < 1) {
    throw new Error("concurrency must be greater than 0");
  }

  if (!URL.canParse(config.orderManagementUrl)) {
    throw new Error(
      `invalid ORDER_MANAGEMENT_URL: ${config.orderManagementUrl}`,
    );
  }
}

function integerOption(cliValue, envValue, fallback) {
  const value = Number(cliValue ?? envValue ?? fallback);
  return Number.isFinite(value) ? Math.max(1, Math.floor(value)) : fallback;
}

function rateOption(cliValue, envValue, fallback) {
  const value = Number(cliValue ?? envValue ?? fallback);
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : fallback;
}

function stringOption(cliValue, envValue, fallback) {
  return `${cliValue ?? envValue ?? fallback}`;
}

function positiveNumber(value, fallback) {
  const parsed = Number(value ?? fallback);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function weightedPick(items, random) {
  const totalWeight = items.reduce((sum, item) => sum + item.weight, 0);
  let cursor = random() * totalWeight;

  for (const item of items) {
    cursor -= item.weight;
    if (cursor <= 0) {
      return item;
    }
  }

  return items.at(-1);
}

function shuffle(items, random) {
  const copy = [...items];

  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [copy[index], copy[swapIndex]] = [copy[swapIndex], copy[index]];
  }

  return copy;
}

function seededRandom(seed) {
  let state = 0;

  for (const char of seed) {
    state = (state * 31 + char.charCodeAt(0)) >>> 0;
  }

  return () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

function countBy(items, keyFn) {
  return items.reduce((counts, item) => {
    const key = keyFn(item);
    counts[key] = (counts[key] ?? 0) + 1;
    return counts;
  }, {});
}

function printableConfig(config) {
  return {
    order_management_url: config.orderManagementUrl,
    total_attempts: config.totalAttempts,
    concurrency: config.concurrency,
    duplicate_rate: config.duplicateRate,
    seed: config.seed,
    skus: config.skus.map((sku) => ({
      seller_sku: sku.sellerSku,
      weight: sku.weight,
      quantity: sku.quantity,
      unit_price: sku.unitPrice,
      item_id: sku.itemId,
    })),
  };
}

function printHelp() {
  console.log(`Usage: node scripts/black-friday-load.mjs [options]

Options:
  --url <url>                order-management base URL. Default: ORDER_MANAGEMENT_URL or http://localhost:3010
  --orders <n>               payment attempts, including duplicates. Default: BLACK_FRIDAY_ORDERS or 20
  --concurrency <n>          parallel requests. Default: BLACK_FRIDAY_CONCURRENCY or 5
  --duplicate-rate <0..1>    fraction of attempts that reuse payment_id. Default: BLACK_FRIDAY_DUPLICATE_RATE or 0.15
  --skus <spec>              comma-separated SELLER_SKU:weight:quantity:unit_price:item_id entries
  --seed <value>             deterministic run id. Default: BLACK_FRIDAY_SEED or current timestamp
  --dry-run                  print generated attempts without sending HTTP

Example:
  node scripts/black-friday-load.mjs --orders 50 --concurrency 10 --duplicate-rate 0.15 \\
    --skus MATE-STANLEY-NO-OFICIAL:6:1:52999.99:CFB-MATE,CARPINCHO-USB-C:4:1:12999.99:CFB-CARPINCHO
`);
}
