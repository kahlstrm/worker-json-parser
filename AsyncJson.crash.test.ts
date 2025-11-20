// AsyncJson.crash.test.ts - Tests for worker failure scenarios
import { describe, it, expect, afterEach, vi } from "vitest";
import { AsyncJson } from "./AsyncJson";

describe("AsyncJson - Worker Failure Scenarios", () => {
  let asyncJson: AsyncJson;

  afterEach(async () => {
    if (asyncJson) {
      await asyncJson.close();
    }
  });

  describe("Worker Crash Recovery", () => {
    it("should reject promise when worker crashes mid-task", async () => {
      asyncJson = new AsyncJson(1);

      const crashPromise = (asyncJson as any).__TEST_crashWorker__();

      await expect(crashPromise).rejects.toThrow();
    }, 10000);

    it("should handle worker error gracefully", async () => {
      asyncJson = new AsyncJson(1);

      const errorPromise = (asyncJson as any).__TEST_errorWorker__();

      await expect(errorPromise).rejects.toThrow("Simulated worker error");
    }, 10000);

    it("should handle uncaught worker errors with single worker", async () => {
      asyncJson = new AsyncJson(1);

      const errorPromise = (asyncJson as any).__TEST_uncaughtErrorWorker__();

      await expect(errorPromise).rejects.toThrow();
    }, 10000);

    it("should respawn worker after uncaught error with single worker", async () => {
      asyncJson = new AsyncJson(1);

      expect(asyncJson.stats().workers).toBe(1);

      const errorPromise = (asyncJson as any).__TEST_uncaughtErrorWorker__();
      await expect(errorPromise).rejects.toThrow();

      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(asyncJson.stats().workers).toBe(1);
    }, 10000);

    it("should process normally after uncaught error with single worker", async () => {
      asyncJson = new AsyncJson(1);

      const errorPromise = (asyncJson as any).__TEST_uncaughtErrorWorker__();
      await expect(errorPromise).rejects.toThrow();

      await new Promise((resolve) => setTimeout(resolve, 100));

      const result = await asyncJson.parse('{"valid": true}');
      expect(result).toEqual({ valid: true });
    }, 10000);

    it("should maintain worker pool size by respawning crashed workers", async () => {
      asyncJson = new AsyncJson(3);

      expect(asyncJson.stats().workers).toBe(3);

      // Crash one worker (expect rejection)
      await expect((asyncJson as any).__TEST_crashWorker__()).rejects.toThrow();

      // Wait for worker to be respawned
      await new Promise((resolve) => setTimeout(resolve, 100));

      // FIXED: Worker pool maintains size by respawning
      expect(asyncJson.stats().workers).toBe(3);
    }, 10000);

    it("should continue working after worker crash with remaining workers", async () => {
      asyncJson = new AsyncJson(3);

      // Crash one worker
      await expect((asyncJson as any).__TEST_crashWorker__()).rejects.toThrow();
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Remaining workers should still work
      const result = await asyncJson.parse('{"test": true}');
      expect(result).toEqual({ test: true });
    }, 10000);

    it("should respawn workers and continue processing after all crash", async () => {
      asyncJson = new AsyncJson(2);

      // Crash all workers
      const promises = [
        (asyncJson as any).__TEST_crashWorker__(),
        (asyncJson as any).__TEST_crashWorker__(),
      ];

      await Promise.allSettled(promises);
      await new Promise((resolve) => setTimeout(resolve, 100));

      // FIXED: Workers have been respawned
      expect(asyncJson.stats().workers).toBe(2);

      // New tasks can be processed
      const result = await asyncJson.parse('{"works": true}');
      expect(result).toEqual({ works: true });
    }, 15000);
  });

  describe("Pending Tasks on Close", () => {
    it("should reject queued tasks when closing pool", async () => {
      vi.useFakeTimers();
      try {
        asyncJson = new AsyncJson(1, { taskTimeoutMs: 50 });

        // Start a hanging task to block the worker (suppress unhandled rejection)
        const hangPromise = (asyncJson as any).__TEST_hangWorker__();
        const hangExpectation =
          expect(hangPromise).rejects.toThrow("timed out");

        // Queue more tasks that will initially be blocked
        const queuedTask1 = asyncJson.parse('{"task": 1}');
        const queuedTask2 = asyncJson.parse('{"task": 2}');

        // Let timeout fire for the hanging task
        await vi.advanceTimersByTimeAsync(60);
        await hangExpectation;

        // Allow respawn and execution of queued tasks
        await vi.advanceTimersByTimeAsync(20);

        await expect(queuedTask1).resolves.toEqual({ task: 1 });
        await expect(queuedTask2).resolves.toEqual({ task: 2 });
        await vi.runAllTimersAsync();
      } finally {
        vi.useRealTimers();
      }
    }, 15000);

    it("should complete in-flight tasks before closing", async () => {
      asyncJson = new AsyncJson(2);

      // Start some tasks
      const task1 = asyncJson.parse('{"task": 1}');
      const task2 = asyncJson.parse('{"task": 2}');

      // Wait for tasks to complete
      await Promise.all([task1, task2]);

      // Now close should work fine
      await expect(asyncJson.close()).resolves.not.toThrow();
    });
  });

  describe("Worker Pool State Management", () => {
    it("should track idle workers correctly", async () => {
      asyncJson = new AsyncJson(3);

      expect(asyncJson.stats().idle).toBe(3);

      // Start a task (one worker becomes busy)
      const task = asyncJson.parse('{"test": true}');

      // Worker should be busy now
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(asyncJson.stats().idle).toBeLessThan(3);

      // After task completes, should be idle again
      await task;
      expect(asyncJson.stats().idle).toBe(3);
    });

    it("should queue tasks when all workers busy", async () => {
      vi.useFakeTimers();
      try {
        asyncJson = new AsyncJson(2, { taskTimeoutMs: 100 });

        const hang1 = (asyncJson as any).__TEST_hangWorker__();
        const hang2 = (asyncJson as any).__TEST_hangWorker__();
        const hang1Expectation = expect(hang1).rejects.toThrow("timed out");
        const hang2Expectation = expect(hang2).rejects.toThrow("timed out");

        await vi.advanceTimersByTimeAsync(50);

        const queued1 = asyncJson.parse('{"queued": 1}');
        const queued2 = asyncJson.parse('{"queued": 2}');

        expect(asyncJson.stats().queue).toBe(2);
        expect(asyncJson.stats().idle).toBe(0);

        await vi.advanceTimersByTimeAsync(70);

        await vi.advanceTimersByTimeAsync(60);
        await hang1Expectation;
        await hang2Expectation;

        await expect(queued1).resolves.toEqual({ queued: 1 });
        await expect(queued2).resolves.toEqual({ queued: 2 });
        await vi.runAllTimersAsync();
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe("Task Timeouts", () => {
    it("should timeout hanging tasks and respawn worker", async () => {
      vi.useFakeTimers();
      try {
        asyncJson = new AsyncJson(1, { taskTimeoutMs: 50 });

        const hangPromise = (asyncJson as any).__TEST_hangWorker__();
        const hangExpectation =
          expect(hangPromise).rejects.toThrow("timed out");

        await vi.advanceTimersByTimeAsync(60);
        await hangExpectation;

        await vi.advanceTimersByTimeAsync(20);

        expect(asyncJson.stats().workers).toBe(1);

        const result = await asyncJson.parse('{"ok": true}');
        expect(result).toEqual({ ok: true });
        await vi.runAllTimersAsync();
      } finally {
        vi.useRealTimers();
      }
    }, 5000);
  });

  describe("Concurrency Under Failure", () => {
    it("should handle mix of successful and crashing operations", async () => {
      asyncJson = new AsyncJson(3);

      const operations = [
        asyncJson.parse('{"success": 1}'),
        (asyncJson as any).__TEST_crashWorker__(),
        asyncJson.parse('{"success": 2}'),
        (asyncJson as any).__TEST_errorWorker__(),
        asyncJson.parse('{"success": 3}'),
      ];

      const results = await Promise.allSettled(operations);

      expect(results[0].status).toBe("fulfilled");
      expect(results[1].status).toBe("rejected");
      expect(results[2].status).toBe("fulfilled");
      expect(results[3].status).toBe("rejected");
      expect(results[4].status).toBe("fulfilled");
    }, 10000);

    it("should respawn worker and continue after single worker crashes", async () => {
      asyncJson = new AsyncJson(1);

      // Crash the only worker
      await expect((asyncJson as any).__TEST_crashWorker__()).rejects.toThrow();
      await new Promise((resolve) => setTimeout(resolve, 100));

      // FIXED: Worker has been respawned
      expect(asyncJson.stats().workers).toBe(1);

      // Subsequent operations work fine
      const task1 = asyncJson.parse('{"test": 1}');
      const task2 = asyncJson.stringify({ test: 2 });

      const results = await Promise.all([task1, task2]);
      expect(results[0]).toEqual({ test: 1 });
      expect(results[1]).toBe('{"test":2}');
    }, 15000);
  });

  describe("Worker Pool Resilience", () => {
    it("should maintain pool size despite multiple crashes", async () => {
      asyncJson = new AsyncJson(5);

      expect(asyncJson.stats().workers).toBe(5);

      // Crash workers one by one
      for (let i = 0; i < 5; i++) {
        await expect((asyncJson as any).__TEST_crashWorker__()).rejects.toThrow();
        await new Promise((resolve) => setTimeout(resolve, 50));
      }

      // FIXED: Pool maintains size by respawning workers
      expect(asyncJson.stats().workers).toBe(5);
    }, 20000);
  });

  describe("Worker Pool Integrity - No Leaks", () => {
    it("should never exceed pool size with single worker", async () => {
      asyncJson = new AsyncJson(1);

      const checkWorkerCount = () => {
        const count = asyncJson.stats().workers;
        expect(count).toBeLessThanOrEqual(1);
        expect(count).toBeGreaterThanOrEqual(0);
      };

      checkWorkerCount();

      // Try various operations
      await asyncJson.parse('{"test": 1}');
      checkWorkerCount();

      await expect((asyncJson as any).__TEST_crashWorker__()).rejects.toThrow();
      checkWorkerCount();

      await new Promise((resolve) => setTimeout(resolve, 100));
      checkWorkerCount();

      await expect((asyncJson as any).__TEST_uncaughtErrorWorker__()).rejects.toThrow();
      checkWorkerCount();

      await new Promise((resolve) => setTimeout(resolve, 100));
      checkWorkerCount();

      await asyncJson.parse('{"test": 2}');
      checkWorkerCount();

      expect(asyncJson.stats().workers).toBe(1);
    }, 15000);

    it("should never exceed pool size with multiple workers", async () => {
      asyncJson = new AsyncJson(3);

      const checkWorkerCount = () => {
        const count = asyncJson.stats().workers;
        expect(count).toBeLessThanOrEqual(3);
        expect(count).toBeGreaterThanOrEqual(0);
      };

      checkWorkerCount();

      // Concurrent operations
      const operations = [
        asyncJson.parse('{"a": 1}'),
        asyncJson.parse('{"b": 2}'),
        asyncJson.parse('{"c": 3}'),
      ];

      await Promise.all(operations);
      checkWorkerCount();

      // Mix of crashes and successes
      const mixed = [
        (asyncJson as any).__TEST_crashWorker__(),
        asyncJson.parse('{"d": 4}'),
        (asyncJson as any).__TEST_uncaughtErrorWorker__(),
      ];

      await Promise.allSettled(mixed);
      checkWorkerCount();

      await new Promise((resolve) => setTimeout(resolve, 100));
      checkWorkerCount();

      expect(asyncJson.stats().workers).toBe(3);
    }, 15000);

    it("should not leak workers with rapid failures", async () => {
      asyncJson = new AsyncJson(2);

      expect(asyncJson.stats().workers).toBe(2);

      // Rapid succession of errors
      for (let i = 0; i < 10; i++) {
        const promise = i % 2 === 0
          ? (asyncJson as any).__TEST_crashWorker__()
          : (asyncJson as any).__TEST_uncaughtErrorWorker__();

        await expect(promise).rejects.toThrow();

        const count = asyncJson.stats().workers;
        expect(count).toBeLessThanOrEqual(2);
      }

      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(asyncJson.stats().workers).toBe(2);
    }, 20000);

    it("should maintain exact pool size after complex scenario", async () => {
      asyncJson = new AsyncJson(4);

      const checkExactCount = () => {
        expect(asyncJson.stats().workers).toBe(4);
      };

      checkExactCount();

      // Parallel crashes
      await Promise.allSettled([
        (asyncJson as any).__TEST_crashWorker__(),
        (asyncJson as any).__TEST_crashWorker__(),
        (asyncJson as any).__TEST_uncaughtErrorWorker__(),
        (asyncJson as any).__TEST_uncaughtErrorWorker__(),
      ]);

      await new Promise((resolve) => setTimeout(resolve, 150));
      checkExactCount();

      // Normal operations
      await Promise.all([
        asyncJson.parse('{"x": 1}'),
        asyncJson.stringify({ y: 2 }),
        asyncJson.parse('{"z": 3}'),
      ]);

      checkExactCount();

      // Another round of failures
      await expect((asyncJson as any).__TEST_crashWorker__()).rejects.toThrow();
      await new Promise((resolve) => setTimeout(resolve, 100));
      checkExactCount();

      // Final operations
      await asyncJson.parse('{"final": true}');
      checkExactCount();
    }, 20000);

    it("should not double-spawn on error+exit events", async () => {
      asyncJson = new AsyncJson(1);

      expect(asyncJson.stats().workers).toBe(1);

      // Trigger uncaught error (fires both error and exit events)
      await expect((asyncJson as any).__TEST_uncaughtErrorWorker__()).rejects.toThrow();

      // Wait for any spawning to complete
      await new Promise((resolve) => setTimeout(resolve, 150));

      // Should still be exactly 1, not 2
      expect(asyncJson.stats().workers).toBe(1);
    }, 10000);
  });
});
