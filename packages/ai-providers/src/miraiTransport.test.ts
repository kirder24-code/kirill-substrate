import { describe, expect, it, vi } from "vitest";
import {
  MiraiNodeTransport,
  MiraiTransportError,
  mapMiraiTransportResponse
} from "./miraiTransport";

describe("MiraiNodeTransport", () => {
  it("constructs safely with config and reports unavailable when disabled", () => {
    const transport = new MiraiNodeTransport({
      enabled: false,
      model: "mirai-local",
      timeoutMs: 2_000
    });

    expect(transport.getAvailability()).toEqual({
      available: false,
      reason: "Mirai transport is disabled."
    });
  });

  it("uses the probe result when configured", () => {
    const probe = vi.fn(() => ({
      available: true,
      reason: "Mirai local runtime is ready."
    }));
    const transport = new MiraiNodeTransport(
      {
        enabled: true,
        transport: "node",
        nodePath: process.execPath
      },
      vi.fn(),
      probe
    );

    expect(transport.getAvailability()).toEqual({
      available: true,
      reason: "Mirai local runtime is ready."
    });
    expect(probe).toHaveBeenCalledTimes(1);
  });

  it("maps timeout and execution errors cleanly", async () => {
    const timeoutTransport = new MiraiNodeTransport(
      {
        enabled: true,
        transport: "node",
        nodePath: process.execPath
      },
      async () => {
        throw new MiraiTransportError("timed out", "MIRAI_TIMEOUT");
      },
      () => ({
        available: true,
        reason: "ready"
      })
    );

    await expect(
      timeoutTransport.generateText({
        task: "generatePostFromIdea",
        prompt: "Write a post."
      })
    ).rejects.toMatchObject({
      code: "MIRAI_TIMEOUT"
    });

    const failedTransport = new MiraiNodeTransport(
      {
        enabled: true,
        transport: "node",
        nodePath: process.execPath
      },
      async () => ({
        stdout: "",
        stderr: "runtime failed",
        exitCode: 1
      }),
      () => ({
        available: true,
        reason: "ready"
      })
    );

    await expect(
      failedTransport.generateText({
        task: "generatePostFromIdea",
        prompt: "Write a post."
      })
    ).rejects.toMatchObject({
      code: "MIRAI_EXECUTION_FAILED",
      message: "runtime failed"
    });
  });

  it("maps structured responses into text output", async () => {
    const transport = new MiraiNodeTransport(
      {
        enabled: true,
        transport: "node",
        nodePath: process.execPath
      },
      async () => ({
        stdout: JSON.stringify({
          output: {
            text: "Grounded post body",
            title: "Grounded title",
            hook: "A practical take",
            body: "Grounded post body",
            cta: "Compare notes."
          }
        }),
        stderr: "",
        exitCode: 0
      }),
      () => ({
        available: true,
        reason: "ready"
      })
    );

    await expect(
      transport.generateText({
        task: "generatePostFromIdea",
        prompt: "Write a post."
      })
    ).resolves.toEqual({
      text: "Grounded post body",
      title: "Grounded title",
      hook: "A practical take",
      body: "Grounded post body",
      cta: "Compare notes.",
      summary: undefined
    });
  });
});

describe("mapMiraiTransportResponse", () => {
  it("supports plain text responses", () => {
    expect(mapMiraiTransportResponse("A plain grounded answer.")).toEqual({
      text: "A plain grounded answer."
    });
  });

  it("throws on empty or invalid structured payloads", () => {
    expect(() => mapMiraiTransportResponse("")).toThrowError(
      /empty response/i
    );
    expect(() =>
      mapMiraiTransportResponse(JSON.stringify({ output: { title: "No text" } }))
    ).toThrowError(/did not include text output/i);
  });
});
