import { createHash } from "node:crypto";
import type {
  CanonicalSignalDraft,
  CanonicalSignalIngestionInput,
  CanonicalSignalSourceType
} from "@linkedin-brand-os/shared";

export interface CanonicalSignalIngestionDependencies {
  fetchImpl?: typeof fetch;
  now?: () => Date;
}

interface RemoteExtractionResult {
  title: string;
  bodyText: string;
  metadata: Record<string, unknown>;
}

const REMOTE_SOURCE_TYPES = new Set<CanonicalSignalSourceType>([
  "github_repo",
  "article",
  "tool_launch"
]);

export async function ingestCanonicalSignalSource(
  input: CanonicalSignalIngestionInput,
  dependencies: CanonicalSignalIngestionDependencies = {}
): Promise<CanonicalSignalDraft> {
  const sourceType = classifyCanonicalSignalSource(input);
  if (sourceType === "manual_note") {
    return buildManualNoteSignal(input);
  }

  const fetchImpl = dependencies.fetchImpl ?? globalThis.fetch;
  const fetchedAt = (dependencies.now ?? (() => new Date()))().toISOString();
  const remoteResult = fetchImpl
    ? await extractRemoteSource(sourceType, input, fetchImpl)
    : buildRemoteFallback(sourceType, input, "No fetch implementation available.");

  const sourceUrl = input.sourceUrl as string;
  const sourceDomain = safeHostname(sourceUrl);
  const rawText = remoteResult.bodyText;
  const normalizedContent = normalizeExtractedText(
    [remoteResult.title, remoteResult.bodyText].filter(Boolean).join("\n\n")
  );
  const title = pickSignalTitle(input.title, remoteResult.title, sourceUrl);
  const baseMetadata = {
    extractionStatus: remoteResult.metadata.extractionStatus ?? "partial",
    extractionStrategy:
      sourceType === "github_repo" ? "github_html_landing" : "web_readable_html",
    ...remoteResult.metadata
  };

  return {
    title,
    sourceType,
    rawText,
    sourceUrl,
    sourceDomain,
    sourceTitle: remoteResult.title || title,
    sourceAuthorOrOwner:
      input.sourceAuthorOrOwner ??
      (sourceType === "github_repo"
        ? (remoteResult.metadata.owner as string | undefined)
        : undefined),
    fetchedAt,
    language: input.language,
    normalizedContent,
    contentHash: computeContentHash(normalizedContent || rawText || title),
    topicTags: input.topicTags,
    noveltyHint: input.noveltyHint,
    sourceMetadataJson: {
      ...baseMetadata,
      ...(input.sourceMetadataJson ?? {})
    }
  };
}

export function classifyCanonicalSignalSource(
  input: CanonicalSignalIngestionInput
): Extract<
  CanonicalSignalSourceType,
  "github_repo" | "article" | "tool_launch" | "manual_note"
> {
  if (input.sourceType) {
    return input.sourceType;
  }

  if (input.manualNoteText?.trim()) {
    return "manual_note";
  }

  const url = input.sourceUrl?.trim();
  if (!url) {
    return "manual_note";
  }

  if (isGithubRepositoryUrl(url)) {
    return "github_repo";
  }

  return inferWebSourceType(url, input.title);
}

export function computeContentHash(value: string): string {
  return createHash("sha256")
    .update(normalizeExtractedText(value))
    .digest("hex");
}

function buildManualNoteSignal(
  input: CanonicalSignalIngestionInput
): CanonicalSignalDraft {
  const manualText = normalizeExtractedText(input.manualNoteText ?? "");
  const title = pickSignalTitle(input.title, manualText, "manual-note");

  return {
    title,
    sourceType: "manual_note",
    rawText: manualText,
    sourceTitle: input.title,
    sourceAuthorOrOwner: input.sourceAuthorOrOwner,
    language: input.language,
    normalizedContent: manualText,
    contentHash: computeContentHash(manualText || title),
    topicTags: input.topicTags,
    noveltyHint: input.noveltyHint,
    sourceMetadataJson: {
      extractionStatus: "manual",
      extractionStrategy: "manual_note_text",
      ...(input.sourceMetadataJson ?? {})
    }
  };
}

async function extractRemoteSource(
  sourceType: Extract<
    CanonicalSignalSourceType,
    "github_repo" | "article" | "tool_launch"
  >,
  input: CanonicalSignalIngestionInput,
  fetchImpl: typeof fetch
): Promise<RemoteExtractionResult> {
  const sourceUrl = input.sourceUrl as string;

  try {
    const response = await fetchImpl(sourceUrl);
    if (!response.ok) {
      return buildRemoteFallback(
        sourceType,
        input,
        `HTTP ${response.status} while fetching source.`
      );
    }

    const html = await response.text();
    return sourceType === "github_repo"
      ? extractGithubRepositoryContent(sourceUrl, html, input.title)
      : extractReadableWebContent(sourceUrl, html, input.title, sourceType);
  } catch (error) {
    return buildRemoteFallback(
      sourceType,
      input,
      error instanceof Error ? error.message : "Remote source extraction failed."
    );
  }
}

function buildRemoteFallback(
  sourceType: Extract<
    CanonicalSignalSourceType,
    "github_repo" | "article" | "tool_launch"
  >,
  input: CanonicalSignalIngestionInput,
  errorSummary: string
): RemoteExtractionResult {
  const sourceUrl = input.sourceUrl as string;
  const repo = sourceType === "github_repo" ? parseGithubRepoReference(sourceUrl) : undefined;
  const title = pickSignalTitle(input.title, repo?.repo, sourceUrl);
  const fallbackText = normalizeExtractedText(
    [title, sourceUrl, errorSummary].filter(Boolean).join("\n")
  );

  return {
    title,
    bodyText: fallbackText,
    metadata: {
      extractionStatus: "partial",
      fetchError: errorSummary,
      ...(repo
        ? {
            owner: repo.owner,
            repo: repo.repo,
            repoReference: `${repo.owner}/${repo.repo}`
          }
        : {})
    }
  };
}

function extractGithubRepositoryContent(
  sourceUrl: string,
  html: string,
  fallbackTitle?: string
): RemoteExtractionResult {
  const repo = parseGithubRepoReference(sourceUrl);
  const title = normalizeExtractedText(readHtmlTitle(html)) || fallbackTitle || repo?.repo || "GitHub repository";
  const readmeSection =
    readNamedSection(html, /id=["']readme["']/i) ??
    readNamedSection(html, /data-testid=["']readme["']/i) ??
    readMainLikeSection(html);
  const bodyText = normalizeExtractedText(stripHtmlToText(readmeSection ?? html));

  return {
    title,
    bodyText,
    metadata: {
      extractionStatus: bodyText ? "complete" : "partial",
      pageKind: "github_repository",
      ...(repo
        ? {
            owner: repo.owner,
            repo: repo.repo,
            repoReference: `${repo.owner}/${repo.repo}`
          }
        : {})
    }
  };
}

function extractReadableWebContent(
  sourceUrl: string,
  html: string,
  fallbackTitle: string | undefined,
  sourceType: "article" | "tool_launch"
): RemoteExtractionResult {
  const title = normalizeExtractedText(readHtmlTitle(html)) || fallbackTitle || safeHostname(sourceUrl) || "Web source";
  const mainSection = readNamedSection(html, /<article\b/i) ?? readMainLikeSection(html) ?? html;
  const bodyText = normalizeExtractedText(stripHtmlToText(mainSection));

  return {
    title,
    bodyText,
    metadata: {
      extractionStatus: bodyText ? "complete" : "partial",
      pageKind: sourceType,
      sourceDomain: safeHostname(sourceUrl)
    }
  };
}

function inferWebSourceType(
  sourceUrl: string,
  title?: string
): "article" | "tool_launch" {
  const hostname = safeHostname(sourceUrl) ?? "";
  const path = safePathname(sourceUrl);
  const joined = `${hostname} ${path} ${title ?? ""}`.toLowerCase();
  const toolHints = [
    "product",
    "tool",
    "app",
    "launch",
    "pricing",
    "demo",
    "waitlist",
    "platform",
    "github.io"
  ];

  return toolHints.some((hint) => joined.includes(hint)) ? "tool_launch" : "article";
}

function isGithubRepositoryUrl(value: string): boolean {
  const repo = parseGithubRepoReference(value);
  return Boolean(repo);
}

function parseGithubRepoReference(
  value: string
): { owner: string; repo: string } | null {
  try {
    const url = new URL(value);
    if (url.hostname !== "github.com") {
      return null;
    }

    const parts = url.pathname.split("/").filter(Boolean);
    if (parts.length < 2) {
      return null;
    }

    return {
      owner: parts[0] as string,
      repo: parts[1] as string
    };
  } catch {
    return null;
  }
}

function readHtmlTitle(html: string): string {
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return decodeHtmlEntities(titleMatch?.[1] ?? "");
}

function readNamedSection(html: string, marker: RegExp): string | null {
  const sectionStart = html.search(marker);
  if (sectionStart === -1) {
    return null;
  }

  const segment = html.slice(sectionStart);
  const closingMatch = segment.match(/<\/(?:article|main|section|div)>/i);
  if (!closingMatch || closingMatch.index === undefined) {
    return segment;
  }

  return segment.slice(0, closingMatch.index + closingMatch[0].length);
}

function readMainLikeSection(html: string): string | null {
  const mainMatch = html.match(/<(main|article)[^>]*>([\s\S]*?)<\/\1>/i);
  if (mainMatch?.[0]) {
    return mainMatch[0];
  }

  const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  return bodyMatch?.[1] ?? null;
}

function stripHtmlToText(html: string): string {
  return decodeHtmlEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
      .replace(/<svg[\s\S]*?<\/svg>/gi, " ")
      .replace(/<head[\s\S]*?<\/head>/gi, " ")
      .replace(/<(nav|footer|header|aside|form)[^>]*>[\s\S]*?<\/\1>/gi, " ")
      .replace(/<[^>]+>/g, " ")
  );
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

function normalizeExtractedText(value: string): string {
  return value.replace(/\s+/g, " ").trim().slice(0, 20000);
}

function pickSignalTitle(
  explicitTitle: string | undefined,
  extractedTitle: string | undefined,
  fallbackLabel: string
): string {
  const title = normalizeExtractedText(explicitTitle ?? extractedTitle ?? "");
  if (title) {
    return title.slice(0, 180);
  }

  return normalizeExtractedText(fallbackLabel).slice(0, 180) || "Untitled signal";
}

function safeHostname(value: string): string | undefined {
  try {
    return new URL(value).hostname;
  } catch {
    return undefined;
  }
}

function safePathname(value: string): string {
  try {
    return new URL(value).pathname;
  } catch {
    return "";
  }
}

export function isRemoteCanonicalSignalSourceType(
  sourceType: CanonicalSignalSourceType
): boolean {
  return REMOTE_SOURCE_TYPES.has(sourceType);
}
