import { describe, expect, it, vi } from "vitest";
import {
  classifyCanonicalSignalSource,
  computeContentHash,
  ingestCanonicalSignalSource
} from "./canonicalSignalIngestion";

describe("canonicalSignalIngestion", () => {
  it("classifies GitHub repository URLs", () => {
    expect(
      classifyCanonicalSignalSource({
        sourceUrl: "https://github.com/example/brand-os"
      })
    ).toBe("github_repo");
  });

  it("classifies article URLs", () => {
    expect(
      classifyCanonicalSignalSource({
        sourceUrl: "https://news.example.com/deep-dive/ai-ops-lessons"
      })
    ).toBe("article");
  });

  it("classifies tool and launch URLs", () => {
    expect(
      classifyCanonicalSignalSource({
        sourceUrl: "https://acme.dev/product/launch-platform"
      })
    ).toBe("tool_launch");
  });

  it("classifies manual note text", () => {
    expect(
      classifyCanonicalSignalSource({
        manualNoteText: "Operators keep losing context between triage and drafting."
      })
    ).toBe("manual_note");
  });

  it("normalizes a GitHub source into canonical signal fields", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue({
      ok: true,
      text: async () =>
        "<html><title>example/brand-os</title><body><main><article id=\"readme\">Brand OS automates intake. Queue-first content orchestration with draft review.</article></main></body></html>"
    } as Response);

    const signal = await ingestCanonicalSignalSource(
      {
        sourceUrl: "https://github.com/example/brand-os",
        title: "Brand OS repository"
      },
      {
        fetchImpl,
        now: () => new Date("2026-03-16T12:00:00.000Z")
      }
    );

    expect(signal).toEqual(
      expect.objectContaining({
        title: "Brand OS repository",
        sourceType: "github_repo",
        sourceUrl: "https://github.com/example/brand-os",
        sourceDomain: "github.com",
        sourceAuthorOrOwner: "example",
        sourceTitle: "example/brand-os",
        fetchedAt: "2026-03-16T12:00:00.000Z",
        normalizedContent: expect.stringContaining("Queue-first content orchestration"),
        contentHash: expect.any(String),
        sourceMetadataJson: expect.objectContaining({
          owner: "example",
          repo: "brand-os",
          repoReference: "example/brand-os"
        })
      })
    );
  });

  it("normalizes article sources into canonical signal fields", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue({
      ok: true,
      text: async () =>
        "<html><title>Operational AI lessons</title><body><article>Teams fail when nobody owns exception handling after the launch demo.</article></body></html>"
    } as Response);

    const signal = await ingestCanonicalSignalSource(
      {
        sourceUrl: "https://example.com/articles/operational-ai-lessons"
      },
      {
        fetchImpl,
        now: () => new Date("2026-03-16T12:00:00.000Z")
      }
    );

    expect(signal).toEqual(
      expect.objectContaining({
        sourceType: "article",
        sourceUrl: "https://example.com/articles/operational-ai-lessons",
        sourceDomain: "example.com",
        sourceTitle: "Operational AI lessons",
        normalizedContent: expect.stringContaining("exception handling"),
        contentHash: expect.any(String),
        sourceMetadataJson: expect.objectContaining({
          pageKind: "article",
          sourceDomain: "example.com"
        })
      })
    );
  });

  it("normalizes manual notes into canonical signal fields", async () => {
    const signal = await ingestCanonicalSignalSource({
      title: "Manual founder note",
      manualNoteText:
        "Founders keep asking for AI automation, but the real blocker is approval design."
    });

    expect(signal).toEqual(
      expect.objectContaining({
        title: "Manual founder note",
        sourceType: "manual_note",
        rawText: expect.stringContaining("approval design"),
        normalizedContent: expect.stringContaining("approval design"),
        contentHash: expect.any(String),
        sourceMetadataJson: expect.objectContaining({
          extractionStatus: "manual"
        })
      })
    );
  });

  it("computes stable content hashes from normalized content", () => {
    expect(computeContentHash("Alpha   Beta")).toBe(computeContentHash("Alpha Beta"));
  });

  it("preserves best-effort metadata when extraction is partial", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue({
      ok: false,
      status: 503
    } as Response);

    const signal = await ingestCanonicalSignalSource(
      {
        sourceUrl: "https://github.com/example/brand-os"
      },
      {
        fetchImpl,
        now: () => new Date("2026-03-16T12:00:00.000Z")
      }
    );

    expect(signal.sourceType).toBe("github_repo");
    expect(signal.fetchedAt).toBe("2026-03-16T12:00:00.000Z");
    expect(signal.rawText).toContain("HTTP 503");
    expect(signal.sourceMetadataJson).toEqual(
      expect.objectContaining({
        extractionStatus: "partial",
        fetchError: "HTTP 503 while fetching source.",
        owner: "example",
        repo: "brand-os"
      })
    );
  });
});
