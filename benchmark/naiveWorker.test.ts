import { describe, expect, it } from "vitest";
import { runNaiveWorker } from "./naiveWorker.ts";

describe("runNaiveWorker", () => {
  it("stringifies objects", async () => {
    const payload = { id: 1, name: "alpha" };
    const result = await runNaiveWorker("stringify", payload);

    expect(result).toBe(JSON.stringify(payload));
  });

  it("parses json strings", async () => {
    const json = JSON.stringify({ active: true, count: 3 });
    const result = await runNaiveWorker("parse", json);

    expect(result).toEqual(JSON.parse(json));
  });
});
