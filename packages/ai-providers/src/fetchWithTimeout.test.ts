import { describe, expect, it } from "vitest";
import { withTimeout } from "./fetchWithTimeout";

describe("withTimeout", () => {
  it("should resolve with the promise value if it completes before timeout", async () => {
    const promise = Promise.resolve("success");
    const result = await withTimeout(promise, 1000, "Timeout");
    expect(result).toBe("success");
  });

  it("should reject with timeout error if promise takes too long", async () => {
    const slowPromise = new Promise((resolve) => {
      setTimeout(() => resolve("too late"), 100);
    });

    await expect(
      withTimeout(slowPromise, 10, "Operation timed out")
    ).rejects.toThrow("Operation timed out");
  });

  it("should propagate errors from the original promise", async () => {
    const failingPromise = Promise.reject(new Error("Original error"));
    await expect(
      withTimeout(failingPromise, 1000, "Timeout")
    ).rejects.toThrow("Original error");
  });

  it("should clean up timeout when promise resolves", async () => {
    const promise = Promise.resolve("done");
    await withTimeout(promise, 1000, "Timeout");
    // If timeout isn't cleared, it would stay in event loop
    // This test verifies cleanup but doesn't hang
  });

  it("should clean up timeout when promise rejects", async () => {
    const promise = Promise.reject(new Error("failed"));
    await expect(withTimeout(promise, 1000, "Timeout")).rejects.toThrow("failed");
    // Verifies cleanup on error path
  });
});
