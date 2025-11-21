// benchmark.ts - Compare AsyncJson worker pool vs blocking JSON operations
import { AsyncJson } from "../AsyncJson.ts";
import {
  getDefaultWorkerCounts,
  getObjSizeEstimateInMB,
} from "./benchUtils.ts";

interface BenchmarkResult {
  name: string;
  operations: number;
  durationMs: number;
  opsPerSecond: number;
  avgLatencyMs: number;
}

// Generate test data of various sizes
function generateSmallObject() {
  return { id: 1, name: "test", active: true };
}

function generateMediumObject() {
  return {
    users: Array.from({ length: 1000 }, (_, i) => ({
      id: i,
      name: `User ${i}`,
      email: `user${i}@example.com`,
      active: i % 2 === 0,
      metadata: { created: new Date().toISOString(), role: "user" },
    })),
  };
}

function generateLargeObject() {
  return {
    data: Array.from({ length: 10000 }, (_, i) => ({
      id: i,
      value: Math.random(),
      timestamp: Date.now(),
      nested: {
        a: i * 2,
        b: i * 3,
        c: `string_${i}`,
      },
    })),
  };
}

function generateVeryLargeObject() {
  return {
    data: Array.from({ length: 100000 }, (_, i) => ({
      id: i,
      value: Math.random(),
      timestamp: Date.now(),
      nested: {
        a: i * 2,
        b: i * 3,
        c: `string_${i}`,
      },
    })),
  };
}

// Blocking JSON operations
async function benchmarkBlocking(
  operation: "parse" | "stringify",
  testData: any,
  iterations: number,
): Promise<BenchmarkResult> {
  const startTime = performance.now();

  if (operation === "parse") {
    const jsonString = JSON.stringify(testData);
    for (let i = 0; i < iterations; i++) {
      JSON.parse(jsonString);
    }
  } else {
    for (let i = 0; i < iterations; i++) {
      JSON.stringify(testData);
    }
  }

  const durationMs = performance.now() - startTime;
  const opsPerSecond = (iterations / durationMs) * 1000;
  const avgLatencyMs = durationMs / iterations;

  return {
    name: `Blocking ${operation}`,
    operations: iterations,
    durationMs,
    opsPerSecond,
    avgLatencyMs,
  };
}

// AsyncJson operations
async function benchmarkAsyncJson(
  operation: "parse" | "stringify",
  testData: any,
  iterations: number,
  workerCount: number,
): Promise<BenchmarkResult> {
  const asyncJson = new AsyncJson(workerCount);
  const startTime = performance.now();

  try {
    if (operation === "parse") {
      const jsonString = JSON.stringify(testData);
      const promises = Array.from({ length: iterations }, () =>
        asyncJson.parse(jsonString),
      );
      await Promise.all(promises);
    } else {
      const promises = Array.from({ length: iterations }, () =>
        asyncJson.stringify(testData),
      );
      await Promise.all(promises);
    }

    const durationMs = performance.now() - startTime;
    const opsPerSecond = (iterations / durationMs) * 1000;
    const avgLatencyMs = durationMs / iterations;

    return {
      name: `AsyncJson (${workerCount} worker${workerCount > 1 ? "s" : ""}) ${operation}`,
      operations: iterations,
      durationMs,
      opsPerSecond,
      avgLatencyMs,
    };
  } finally {
    await asyncJson.close();
  }
}

// Sequential benchmark (one at a time)
async function benchmarkSequential(
  operation: "parse" | "stringify",
  testData: any,
  iterations: number,
  workerCount: number,
): Promise<BenchmarkResult> {
  const asyncJson = new AsyncJson(workerCount);
  const startTime = performance.now();

  try {
    if (operation === "parse") {
      const jsonString = JSON.stringify(testData);
      for (let i = 0; i < iterations; i++) {
        await asyncJson.parse(jsonString);
      }
    } else {
      for (let i = 0; i < iterations; i++) {
        await asyncJson.stringify(testData);
      }
    }

    const durationMs = performance.now() - startTime;
    const opsPerSecond = (iterations / durationMs) * 1000;
    const avgLatencyMs = durationMs / iterations;

    return {
      name: `AsyncJson Sequential (${workerCount} worker${workerCount > 1 ? "s" : ""}) ${operation}`,
      operations: iterations,
      durationMs,
      opsPerSecond,
      avgLatencyMs,
    };
  } finally {
    await asyncJson.close();
  }
}

export async function collectResults(
  operation: "parse" | "stringify",
  testData: any,
  iterations: number,
  workerCounts: number[],
): Promise<BenchmarkResult[]> {
  const results: BenchmarkResult[] = [];
  results.push(await benchmarkBlocking(operation, testData, iterations));

  for (const workers of workerCounts) {
    results.push(
      await benchmarkAsyncJson(operation, testData, iterations, workers),
    );
  }

  return results;
}

export async function runStandardScenario(
  label: string,
  testData: any,
  iterations: number,
  workerCounts: number[],
) {
  const stringifyResults = await collectResults(
    "stringify",
    testData,
    iterations,
    workerCounts,
  );
  printResults(`${label} Stringify Results`, stringifyResults);

  const parseResults = await collectResults(
    "parse",
    testData,
    iterations,
    workerCounts,
  );
  printResults(`${label} Parse Results`, parseResults);
}

function printResults(title: string, results: BenchmarkResult[]) {
  console.log(`\n${"=".repeat(80)}`);
  console.log(title);
  console.log("=".repeat(80));
  console.log(
    "Test Name".padEnd(40),
    "Ops".padStart(8),
    "Time(ms)".padStart(10),
    "Ops/sec".padStart(12),
    "Avg(ms)".padStart(10),
  );
  console.log("-".repeat(80));

  results.forEach((result) => {
    console.log(
      result.name.padEnd(40),
      result.operations.toString().padStart(8),
      result.durationMs.toFixed(2).padStart(10),
      result.opsPerSecond.toFixed(2).padStart(12),
      result.avgLatencyMs.toFixed(4).padStart(10),
    );
  });

  // Find fastest
  const fastest = results.reduce((prev, curr) =>
    curr.opsPerSecond > prev.opsPerSecond ? curr : prev,
  );

  console.log("-".repeat(80));
  console.log(
    `Fastest: ${fastest.name} (${fastest.opsPerSecond.toFixed(2)} ops/sec)`,
  );

  // Show relative performance
  console.log("\nRelative Performance:");
  results.forEach((result) => {
    const ratio = (result.opsPerSecond / fastest.opsPerSecond) * 100;
    const bar = "█".repeat(Math.floor(ratio / 2));
    console.log(`${result.name.padEnd(40)} ${bar} ${ratio.toFixed(1)}%`);
  });
}

function listWorkerCounts(): number[] {
  const env = process.env.WORKER_COUNTS;
  if (env) {
    return env
      .split(",")
      .map((n) => Number(n.trim()))
      .filter((n) => Number.isFinite(n) && n >= 1)
      .map((n) => Math.trunc(n));
  }

  return getDefaultWorkerCounts();
}

async function runBenchmarks() {
  console.log("AsyncJson Worker Pool Benchmark");
  console.log("================================\n");
  console.log("Warming up...");

  // Warmup
  const warmupJson = new AsyncJson(2);
  await warmupJson.parse('{"warmup": true}');
  await warmupJson.stringify({ warmup: true });
  await warmupJson.close();

  console.log("Warmup complete. Starting benchmarks...\n");

  const iterations = 1000;
  const workerCounts = listWorkerCounts();
  console.log(`Using worker counts: ${workerCounts.join(", ")}`);

  // Small objects
  const smallObj = generateSmallObject();

  console.log("\n📊 Test 1: Small Objects (~50 bytes, 1000 operations)");
  await runStandardScenario("Small Object", smallObj, iterations, workerCounts);

  // Medium objects
  const mediumObj = generateMediumObject();
  const mediumObjSize = getObjSizeEstimateInMB(mediumObj);

  console.log(
    `\n📊 Test 2: Medium Objects (${mediumObjSize}, 1000 operations)`,
  );
  await runStandardScenario(
    "Medium Object",
    mediumObj,
    iterations,
    workerCounts,
  );

  // Large objects
  const largeObj = generateLargeObject();
  const largeObjSize = getObjSizeEstimateInMB(largeObj);

  console.log(`\n📊 Test 3: Large Objects (${largeObjSize}, 1000 operations)`);
  await runStandardScenario("Large Object", largeObj, iterations, workerCounts);

  // Very large objects (~10MB)
  const veryLargeObj = generateVeryLargeObject();
  const veryLargeObjSize = getObjSizeEstimateInMB(veryLargeObj);
  const veryLargeIterations = 100;

  console.log(
    `\n📊 Test 4: Very Large Objects (${veryLargeObjSize}, ${veryLargeIterations} operations)`,
  );
  await runStandardScenario(
    "Very Large Object",
    veryLargeObj,
    veryLargeIterations,
    workerCounts,
  );

  // Sequential vs Concurrent
  console.log(
    "\n📊 Test 5: Sequential vs Concurrent (Medium objects, 1000 operations)",
  );
  const seqConcResults: BenchmarkResult[] = [];

  seqConcResults.push(
    await benchmarkBlocking("stringify", mediumObj, iterations),
  );
  for (const workers of workerCounts) {
    seqConcResults.push(
      await benchmarkSequential("stringify", mediumObj, iterations, workers),
    );
  }

  for (const workers of workerCounts) {
    seqConcResults.push(
      await benchmarkAsyncJson("stringify", mediumObj, iterations, workers),
    );
  }

  printResults("Sequential vs Concurrent Results", seqConcResults);

  console.log(
    "\n📊 Test 6: Sequential vs Concurrent PARSE (Medium objects, 1000 operations)",
  );
  const seqConcParseResults: BenchmarkResult[] = [];

  seqConcParseResults.push(
    await benchmarkBlocking("parse", mediumObj, iterations),
  );
  for (const workers of workerCounts) {
    seqConcParseResults.push(
      await benchmarkSequential("parse", mediumObj, iterations, workers),
    );
  }

  for (const workers of workerCounts) {
    seqConcParseResults.push(
      await benchmarkAsyncJson("parse", mediumObj, iterations, workers),
    );
  }

  printResults("Sequential vs Concurrent Parse Results", seqConcParseResults);

  console.log("\n✅ Benchmark complete!");
}

runBenchmarks().catch(console.error);
