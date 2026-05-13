import { describe, expect, it, vi } from "vitest";
import type { Idea } from "@linkedin-brand-os/shared";
import { StrongTextProvider } from "./strongTextProvider";

const idea: Idea = {
  id: "idea-openai-1",
  signalId: "sig-openai-1",
  title: "Queue ownership beats AI hype",
  coreInsight: "Operators trust automation when ownership is visible.",
  businessRelevance: "Tie the post to execution risk and rollout clarity.",
  targetAudience: "Founders and operators",
  status: "draft",
  createdAt: "2026-03-16T00:00:00.000Z"
};

describe("StrongTextProvider", () => {
  it("reports unavailable when OPENAI_API_KEY is missing", () => {
    const provider = new StrongTextProvider();

    expect(provider.getAvailability()).toEqual({
      available: false,
      reason: "OPENAI_API_KEY is not set."
    });
  });

  it("treats the env placeholder key as missing", () => {
    const provider = new StrongTextProvider({
      apiKey: "PASTE_REAL_KEY_HERE"
    });

    expect(provider.getAvailability()).toEqual({
      available: false,
      reason: "OPENAI_API_KEY is not set."
    });
  });

  it("reports available when OPENAI_API_KEY is configured", () => {
    const provider = new StrongTextProvider({
      apiKey: "test-openai-key",
      model: "gpt-4.1-mini"
    });

    expect(provider.getAvailability()).toEqual({
      available: true,
      reason: "OpenAI premium provider is configured."
    });
  });

  it("executes generatePostFromIdea against the live premium transport contract", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  hook: "The model is not the rollout plan.",
                  body: "The queue fails when ownership and exception handling stay vague after launch.",
                  cta: "If this pattern is showing up in your team, compare notes."
                })
              }
            }
          ]
        }),
        {
          status: 200,
          headers: {
            "content-type": "application/json"
          }
        }
      )
    );
    const provider = new StrongTextProvider(
      {
        apiKey: "test-openai-key",
        model: "gpt-4.1-mini"
      },
      { fetchImpl }
    );

    const result = await provider.generatePostFromIdea({ idea });

    expect(fetchImpl).toHaveBeenCalledWith(
      "https://api.openai.com/v1/chat/completions",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "content-type": "application/json",
          authorization: "Bearer test-openai-key"
        }),
        body: expect.stringContaining("\"response_format\":{\"type\":\"json_object\"}")
      })
    );
    expect(result).toEqual({
      contentType: "linkedin-post",
      hook: "The model is not the rollout plan.",
      body: "The queue fails when ownership and exception handling stay vague after launch.",
      cta: "If this pattern is showing up in your team, compare notes.",
      status: "draft"
    });
  });

  it("executes reviewContentAsset against the live premium transport contract", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  qualitySignal: "strong",
                  genericnessRisk: "low",
                  businessValueSignal: "strong",
                  differentiationSignal: "strong",
                  publishReadyHint: true,
                  rewriteSuggestions: [],
                  criticNotes: "Grounded and specific."
                })
              }
            }
          ]
        }),
        {
          status: 200,
          headers: {
            "content-type": "application/json"
          }
        }
      )
    );
    const provider = new StrongTextProvider(
      {
        apiKey: "test-openai-key",
        model: "gpt-4.1-mini"
      },
      { fetchImpl }
    );

    const result = await provider.reviewContentAsset({
      content: {
        id: "content-1",
        ideaId: "idea-openai-1",
        signalId: "sig-openai-1",
        signalAnalysisId: "analysis-1",
        contentType: "linkedin-post",
        hook: "Queue ownership beats AI hype.",
        body: "Operators trust systems that expose ownership and exception handling.",
        cta: "Compare notes if this pattern is familiar.",
        bestAngle: "ownership_gap",
        longPostDraft:
          "The rollout breaks when queue visibility exists without ownership and exception handling.",
        shortPostDraft: "Ownership beats vague AI optimism.",
        status: "draft",
        createdAt: "2026-03-16T00:00:00.000Z"
      }
    });

    expect(fetchImpl).toHaveBeenCalledWith(
      "https://api.openai.com/v1/chat/completions",
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining("\"response_format\":{\"type\":\"json_object\"}")
      })
    );
    expect(result).toEqual({
      qualitySignal: "strong",
      genericnessRisk: "low",
      businessValueSignal: "strong",
      differentiationSignal: "strong",
      publishReadyHint: true,
      rewriteSuggestions: [],
      criticNotes: "Grounded and specific."
    });
  });

  it("throws timeout error when OpenAI request exceeds configured timeout", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(() => {
      return new Promise((resolve) => {
        setTimeout(
          () =>
            resolve(
              new Response(JSON.stringify({ choices: [] }), {
                status: 200,
                headers: { "content-type": "application/json" }
              })
            ),
          100
        );
      });
    });

    const provider = new StrongTextProvider(
      {
        apiKey: "test-openai-key",
        model: "gpt-4.1-mini"
      },
      { fetchImpl, timeoutMs: 10 }
    );

    await expect(provider.generatePostFromIdea({ idea })).rejects.toThrow(
      /OpenAI API request for generatePostFromIdea timed out after 10ms/
    );
  });

  it("uses default 30s timeout when no timeout is configured", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  hook: "Hook",
                  body: "Body",
                  cta: "CTA"
                })
              }
            }
          ]
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" }
        }
      )
    );

    const provider = new StrongTextProvider(
      {
        apiKey: "test-openai-key"
      },
      { fetchImpl }
    );

    const result = await provider.generatePostFromIdea({ idea });
    expect(result.hook).toBe("Hook");
  });
});
