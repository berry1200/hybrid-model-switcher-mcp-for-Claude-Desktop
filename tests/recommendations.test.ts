import { describe, expect, it } from "vitest";
import { recommendModel } from "../src/recommendations.js";

describe("recommendModel", () => {
  it("returns coding recommendation by task type", () => {
    expect(recommendModel("coding").modelName).toBe("deepseek-coder:latest");
  });

  it("falls back to balanced recommendation", () => {
    expect(recommendModel("unknown").modelName).toBe("qwen3:latest");
  });
});

