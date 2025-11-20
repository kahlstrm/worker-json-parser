// AsyncJson.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { AsyncJson } from "./AsyncJson";

describe("AsyncJson", () => {
  let asyncJson: AsyncJson;

  afterEach(async () => {
    if (asyncJson) {
      await asyncJson.close();
    }
  });

  describe("Basic Functionality", () => {
    beforeEach(() => {
      asyncJson = new AsyncJson(1);
    });

    it("should parse valid JSON string", async () => {
      const jsonString = '{"name": "Alice", "age": 30}';
      const result = await asyncJson.parse(jsonString);
      expect(result).toEqual({ name: "Alice", age: 30 });
    });

    it("should stringify an object", async () => {
      const obj = { name: "Bob", age: 25 };
      const result = await asyncJson.stringify(obj);
      expect(result).toBe('{"name":"Bob","age":25}');
    });

    it("should handle complex nested objects", async () => {
      const complex = {
        users: [
          { id: 1, name: "Alice" },
          { id: 2, name: "Bob" },
        ],
        meta: { count: 2, page: 1 },
      };
      const stringified = await asyncJson.stringify(complex);
      const parsed = await asyncJson.parse(stringified);
      expect(parsed).toEqual(complex);
    });

    it("should handle null values", async () => {
      const result = await asyncJson.parse("null");
      expect(result).toBe(null);
    });

    it("should handle arrays", async () => {
      const arr = [1, 2, 3, 4, 5];
      const stringified = await asyncJson.stringify(arr);
      const parsed = await asyncJson.parse(stringified);
      expect(parsed).toEqual(arr);
    });
  });

  describe("Error Handling", () => {
    beforeEach(() => {
      asyncJson = new AsyncJson(1);
    });

    it("should reject on invalid JSON parse", async () => {
      const invalidJson = '{"name": "Alice", "age": }';
      await expect(asyncJson.parse(invalidJson)).rejects.toThrow();
    });

    it("should reject on circular reference stringify", async () => {
      const circular: any = { name: "test" };
      circular.self = circular;
      await expect(asyncJson.stringify(circular)).rejects.toThrow();
    });

    it("should handle malformed JSON gracefully", async () => {
      const tests = [
        '{"unclosed": ',
        '}{',
        'undefined',
        '{"key": undefined}',
      ];

      for (const test of tests) {
        await expect(asyncJson.parse(test)).rejects.toThrow();
      }
    });
  });

  describe("Concurrent Operations", () => {
    beforeEach(() => {
      asyncJson = new AsyncJson(2);
    });

    it("should handle multiple parse operations concurrently", async () => {
      const operations = Array.from({ length: 10 }, (_, i) =>
        asyncJson.parse(`{"id": ${i}}`)
      );

      const results = await Promise.all(operations);
      results.forEach((result, i) => {
        expect(result).toEqual({ id: i });
      });
    });

    it("should handle multiple stringify operations concurrently", async () => {
      const operations = Array.from({ length: 10 }, (_, i) =>
        asyncJson.stringify({ id: i })
      );

      const results = await Promise.all(operations);
      results.forEach((result, i) => {
        expect(result).toBe(`{"id":${i}}`);
      });
    });

    it("should handle mixed parse and stringify operations", async () => {
      const operations = [
        asyncJson.parse('{"type": "parse1"}'),
        asyncJson.stringify({ type: "stringify1" }),
        asyncJson.parse('{"type": "parse2"}'),
        asyncJson.stringify({ type: "stringify2" }),
      ];

      const results = await Promise.all(operations);
      expect(results[0]).toEqual({ type: "parse1" });
      expect(results[1]).toBe('{"type":"stringify1"}');
      expect(results[2]).toEqual({ type: "parse2" });
      expect(results[3]).toBe('{"type":"stringify2"}');
    });

    it("should queue tasks when all workers are busy", async () => {
      // With 2 workers, create more tasks than workers
      const operations = Array.from({ length: 5 }, (_, i) =>
        asyncJson.parse(`{"id": ${i}}`)
      );

      const results = await Promise.all(operations);
      expect(results).toHaveLength(5);
      results.forEach((result, i) => {
        expect(result).toEqual({ id: i });
      });
    });
  });

  describe("Worker Pool Management", () => {
    it("should create specified number of workers", () => {
      asyncJson = new AsyncJson(4);
      expect(asyncJson.numThreads).toBe(4);
    });

    it("should default to 1 worker when not specified", () => {
      asyncJson = new AsyncJson();
      expect(asyncJson.numThreads).toBe(1);
    });

    it("should handle operations with single worker", async () => {
      asyncJson = new AsyncJson(1);
      const results = await Promise.all([
        asyncJson.parse('{"a": 1}'),
        asyncJson.parse('{"b": 2}'),
        asyncJson.parse('{"c": 3}'),
      ]);

      expect(results).toEqual([{ a: 1 }, { b: 2 }, { c: 3 }]);
    });

    it("should handle operations with many workers", async () => {
      asyncJson = new AsyncJson(8);
      const operations = Array.from({ length: 20 }, (_, i) =>
        asyncJson.parse(`{"id": ${i}}`)
      );

      const results = await Promise.all(operations);
      expect(results).toHaveLength(20);
    });

    it("should report pool stats accurately", async () => {
      asyncJson = new AsyncJson(1);

      // Busy the only worker
      const hanging = (asyncJson as any).__TEST_hangWorker__();
      await new Promise((r) => setTimeout(r, 5));

      const queued = asyncJson.parse('{"q":1}');

      await new Promise((r) => setTimeout(r, 5));
      const busyStats = asyncJson.stats();
      expect(busyStats.workers).toBe(1);
      expect(busyStats.idle).toBe(0);
      expect(busyStats.queue).toBe(1);

      const hangExpectation = expect(hanging).rejects.toThrow(
        "Worker pool is closing",
      );
      const queuedExpectation = expect(queued).rejects.toThrow(
        "Worker pool is closing",
      );

      await asyncJson.close();
      await hangExpectation;
      await queuedExpectation;

      const finalStats = asyncJson.stats();
      expect(finalStats.workers).toBe(0);
      expect(finalStats.idle).toBe(0);
      expect(finalStats.queue).toBe(0);
    });
  });

  describe("Cleanup and Resource Management", () => {
    it("should close pool successfully", async () => {
      asyncJson = new AsyncJson(2);
      await asyncJson.parse('{"test": true}');
      await expect(asyncJson.close()).resolves.not.toThrow();
    });

    it("should close empty pool", async () => {
      asyncJson = new AsyncJson(2);
      await expect(asyncJson.close()).resolves.not.toThrow();
    });

    it("should reject pending operations when closing", async () => {
      asyncJson = new AsyncJson(1);
      const operation = asyncJson.parse('{"test": true}');
      // Set up expectation BEFORE closing to attach rejection handler
      const expectation = expect(operation).rejects.toThrow("Worker pool is closing");
      await asyncJson.close();
      // FIXED: Pending operations are now rejected when pool closes
      await expectation;
    });

    it("should reject new parse requests after close", async () => {
      asyncJson = new AsyncJson(1);
      await asyncJson.close();

      await expect(asyncJson.parse("{}")).rejects.toThrow(
        "Worker pool is closing",
      );
    });

    it("should reject new stringify requests after close", async () => {
      asyncJson = new AsyncJson(1);
      await asyncJson.close();

      await expect(asyncJson.stringify({ ok: true })).rejects.toThrow(
        "Worker pool is closing",
      );
    });
  });

  describe("Edge Cases", () => {
    beforeEach(() => {
      asyncJson = new AsyncJson(2);
    });

    it("should handle empty string parse", async () => {
      await expect(asyncJson.parse("")).rejects.toThrow();
    });

    it("should handle empty object", async () => {
      const result = await asyncJson.stringify({});
      expect(result).toBe("{}");
    });

    it("should handle large objects", async () => {
      const large = {
        data: Array.from({ length: 10000 }, (_, i) => ({
          id: i,
          value: Math.random(),
        })),
      };

      const stringified = await asyncJson.stringify(large);
      const parsed = await asyncJson.parse(stringified);
      expect(parsed).toEqual(large);
    });

    it("should handle special characters", async () => {
      const special = {
        text: 'Hello "World" with \n newlines and \t tabs',
        emoji: "🚀🎉",
        unicode: "Hello 世界",
      };

      const stringified = await asyncJson.stringify(special);
      const parsed = await asyncJson.parse(stringified);
      expect(parsed).toEqual(special);
    });

    it("should handle number edge cases", async () => {
      const numbers = {
        zero: 0,
        negative: -42,
        float: 3.14159,
        large: Number.MAX_SAFE_INTEGER,
        small: Number.MIN_SAFE_INTEGER,
      };

      const stringified = await asyncJson.stringify(numbers);
      const parsed = await asyncJson.parse(stringified);
      expect(parsed).toEqual(numbers);
    });

    it("should handle boolean values", async () => {
      const bools = { isTrue: true, isFalse: false };
      const stringified = await asyncJson.stringify(bools);
      const parsed = await asyncJson.parse(stringified);
      expect(parsed).toEqual(bools);
    });
  });

  describe("Promise.allSettled scenarios", () => {
    beforeEach(() => {
      asyncJson = new AsyncJson(2);
    });

    it("should handle mix of successful and failed operations", async () => {
      const operations = [
        asyncJson.parse('{"valid": true}'),
        asyncJson.parse('invalid json'),
        asyncJson.stringify({ valid: true }),
        asyncJson.parse('{"another": "valid"}'),
      ];

      const results = await Promise.allSettled(operations);

      expect(results[0].status).toBe("fulfilled");
      expect(results[1].status).toBe("rejected");
      expect(results[2].status).toBe("fulfilled");
      expect(results[3].status).toBe("fulfilled");
    });
  });
});
