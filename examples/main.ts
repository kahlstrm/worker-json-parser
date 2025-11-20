// main.ts
import { AsyncJson } from "../AsyncJson.ts";

// Define a type for our expected data
interface MyData {
  name: string;
  age: number;
}

// --- Example Data ---
const goodJson = '{"name": "Alice", "age": 30}';
const badJson = `{"name": "Bob", "age": 'fourty-two'}`; // <-- This will fail JSON.parse
const largeObject = {
  id: 1,
  data: Array(10000).fill(Math.random()),
  nested: { key: "value" },
};

async function main() {
  const json = new AsyncJson(1); // Uses default number of threads
  console.log(`🚀 Starting JSON pool with ${json.numThreads} threads...`);

  const tasks = [
    // Parse tasks
    json.parse(goodJson),
    json.parse(badJson),

    // Stringify tasks
    json.stringify(largeObject),
    json.stringify({ id: 123, status: "ok" }),
  ];

  const results = await Promise.allSettled(tasks);
  console.log("\n--- All Tasks Settled ---");

  // Type-safe handling of parse results
  const parseResult = results[0];
  if (parseResult.status === "fulfilled") {
    // We cast the 'unknown' result to our expected type
    const data = parseResult.value as MyData;
    console.log(`✅ Task 0 (success): Parsed name: ${data.name}`);
  }

  // Generic logging for other results
  results.slice(1).forEach((result, i) => {
    if (result.status === "fulfilled") {
      const value = result.value;
      const summary =
        typeof value === "string"
          ? `${value.length} chars`
          : value && typeof value === "object"
            ? `${Object.keys(value as Record<string, unknown>).length} keys`
            : String(value);
      console.log(`✅ Task ${i + 1} (success):`, summary);
    } else {
      console.error(`❌ Task ${i + 1} (failed):`, result.reason.message);
    }
  });

  await json.close();
  console.log("\n--- JSON Pool Closed ---");
}

main().catch(console.error);
