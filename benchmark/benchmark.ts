// benchmark.ts - Compare AsyncJson worker pool vs blocking JSON operations
import { AsyncJson } from "../AsyncJson.ts";
import { getDefaultWorkerCounts } from "./benchUtils.ts";

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
  const smallResults: BenchmarkResult[] = [];

  smallResults.push(await benchmarkBlocking("stringify", smallObj, iterations));
  for (const workers of workerCounts) {
    smallResults.push(
      await benchmarkAsyncJson("stringify", smallObj, iterations, workers),
    );
  }

  printResults("Small Object Stringify Results", smallResults);

  const smallParseResults: BenchmarkResult[] = [];
  smallParseResults.push(
    await benchmarkBlocking("parse", smallObj, iterations),
  );
  for (const workers of workerCounts) {
    smallParseResults.push(
      await benchmarkAsyncJson("parse", smallObj, iterations, workers),
    );
  }

  printResults("Small Object Parse Results", smallParseResults);

  // Medium objects
  const mediumObj = generateMediumObject();

  console.log("\n📊 Test 2: Medium Objects (~100KB, 1000 operations)");
  const mediumResults: BenchmarkResult[] = [];

  mediumResults.push(
    await benchmarkBlocking("stringify", mediumObj, iterations),
  );
  for (const workers of workerCounts) {
    mediumResults.push(
      await benchmarkAsyncJson("stringify", mediumObj, iterations, workers),
    );
  }

  printResults("Medium Object Stringify Results", mediumResults);

  const mediumParseResults: BenchmarkResult[] = [];
  mediumParseResults.push(
    await benchmarkBlocking("parse", mediumObj, iterations),
  );
  for (const workers of workerCounts) {
    mediumParseResults.push(
      await benchmarkAsyncJson("parse", mediumObj, iterations, workers),
    );
  }

  printResults("Medium Object Parse Results", mediumParseResults);

  // Large objects
  const largeObj = generateLargeObject();

  console.log("\n📊 Test 3: Large Objects (~1MB, 1000 operations)");
  const largeResults: BenchmarkResult[] = [];

  largeResults.push(await benchmarkBlocking("stringify", largeObj, iterations));
  for (const workers of workerCounts) {
    largeResults.push(
      await benchmarkAsyncJson("stringify", largeObj, iterations, workers),
    );
  }

  printResults("Large Object Stringify Results", largeResults);

  const largeParseResults: BenchmarkResult[] = [];
  largeParseResults.push(
    await benchmarkBlocking("parse", largeObj, iterations),
  );
  for (const workers of workerCounts) {
    largeParseResults.push(
      await benchmarkAsyncJson("parse", largeObj, iterations, workers),
    );
  }

  printResults("Large Object Parse Results", largeParseResults);

  // Sequential vs Concurrent
  console.log(
    "\n📊 Test 4: Sequential vs Concurrent (Medium objects, 1000 operations)",
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
    "\n📊 Test 5: Sequential vs Concurrent PARSE (Medium objects, 1000 operations)",
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
