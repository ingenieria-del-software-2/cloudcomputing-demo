#!/usr/bin/env node

import {
  Worker,
  isMainThread,
  parentPort,
  workerData,
} from "node:worker_threads";

if (!isMainThread) {
  const deadline = Date.now() + workerData.durationMs;
  let iterations = 0;
  let value = 17;

  while (Date.now() < deadline) {
    for (let index = 0; index < 100000; index += 1) {
      value = Math.imul(value ^ index, 1664525) + 1013904223;
    }
    iterations += 1;
  }

  parentPort?.postMessage({ iterations, value });
  process.exit(0);
}

const args = parseArgs(process.argv.slice(2));

if (args.help) {
  printHelp();
  process.exit(0);
}

const config = {
  durationSeconds: integerOption(
    args.duration,
    process.env.CPU_NOISE_DURATION,
    30,
  ),
  workers: integerOption(args.workers, process.env.CPU_NOISE_WORKERS, 1),
};

const startedAt = Date.now();
console.log(
  JSON.stringify({
    cpu_noise: "started",
    duration_seconds: config.durationSeconds,
    workers: config.workers,
  }),
);

const results = await Promise.all(
  Array.from({ length: config.workers }, () =>
    runWorker(config.durationSeconds),
  ),
);
const durationSeconds = (Date.now() - startedAt) / 1000;

console.log(
  JSON.stringify({
    cpu_noise: "completed",
    duration_seconds: Number(durationSeconds.toFixed(3)),
    workers: config.workers,
    iterations: results.reduce((sum, result) => sum + result.iterations, 0),
  }),
);

function runWorker(durationSeconds) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL(import.meta.url), {
      workerData: { durationMs: durationSeconds * 1000 },
    });

    worker.once("message", resolve);
    worker.once("error", reject);
    worker.once("exit", (code) => {
      if (code !== 0) {
        reject(new Error(`cpu noise worker exited with ${code}`));
      }
    });
  });
}

function parseArgs(argv) {
  const parsed = {};

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--help" || arg === "-h") {
      parsed.help = true;
      continue;
    }

    const [rawKey, inlineValue] = arg.split("=", 2);
    if (!rawKey.startsWith("--")) {
      throw new Error(`unexpected argument: ${arg}`);
    }

    const key = rawKey.slice(2);
    parsed[key] = inlineValue ?? argv[index + 1];

    if (inlineValue === undefined) {
      index += 1;
    }
  }

  return parsed;
}

function integerOption(cliValue, envValue, fallback) {
  const value = Number(cliValue ?? envValue ?? fallback);
  return Number.isFinite(value) ? Math.max(1, Math.floor(value)) : fallback;
}

function printHelp() {
  console.log(`Usage: node scripts/cpu-noise.mjs [options]

Options:
  --duration <seconds>  Bounded CPU-noise duration. Default: CPU_NOISE_DURATION or 30
  --workers <n>         Worker threads to burn CPU. Default: CPU_NOISE_WORKERS or 1

Example:
  node scripts/cpu-noise.mjs --duration 20 --workers 1
`);
}
