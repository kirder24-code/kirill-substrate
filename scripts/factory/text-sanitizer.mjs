/**
 * TEXT SANITIZER - Removes AI detection markers from any text going to a human buyer.
 *
 * Import this in EVERY bot that generates text for external audiences:
 * - LinkedIn DMs
 * - Reddit comments
 * - Email bodies
 * - Scope documents
 * - Forwarding texts
 * - Any draft that Kirill copies and sends
 *
 * Usage:
 *   import { sanitizeForHuman } from './text-sanitizer.mjs';
 *   const clean = sanitizeForHuman(gptResponse);
 */

/**
 * Removes AI-generated text tells that signal "this was written by GPT/Claude."
 * Safe to apply to ANY external-facing text.
 */
export function sanitizeForHuman(text) {
  if (!text || typeof text !== "string") return text;

  let clean = text;

  // 1. Em dash (—) → short hyphen (-). #1 AI detection marker.
  clean = clean.replace(/—/g, "-");

  // 2. En dash (–) in prose contexts → hyphen.
  //    Keep en dash only in numeric ranges (e.g., "5–10")
  clean = clean.replace(/([a-z])\s*–\s*([a-z])/gi, "$1 - $2");

  // 3. Curly quotes → straight quotes
  clean = clean.replace(/[\u201C\u201D]/g, '"');
  clean = clean.replace(/[\u2018\u2019]/g, "'");

  // 4. Ellipsis character (…) → three dots
  clean = clean.replace(/…/g, "...");

  // 5. Non-breaking space → regular space
  clean = clean.replace(/\u00A0/g, " ");

  // 6. Arrow character (→) → ->
  clean = clean.replace(/→/g, "->");

  // 7. Zero-width characters (sometimes GPT sneaks these in)
  clean = clean.replace(/[\u200B-\u200D\uFEFF]/g, "");

  return clean;
}

/**
 * Validates text is human-ready. Returns { clean: true, issues: [] } or { clean: false, issues: [...] }
 * Use before sending to verify no AI tells remain.
 */
export function validateHumanText(text) {
  const issues = [];
  if (/—/.test(text)) issues.push("em_dash_present");
  if (/[\u201C\u201D\u2018\u2019]/.test(text)) issues.push("curly_quotes_present");
  if (/…/.test(text)) issues.push("ellipsis_char_present");
  if (/→/.test(text)) issues.push("arrow_char_present");
  if (/\u00A0/.test(text)) issues.push("nbsp_present");
  if (/[\u200B-\u200D\uFEFF]/.test(text)) issues.push("zero_width_present");

  return { clean: issues.length === 0, issues };
}

/**
 * Sanitize an object's text fields recursively.
 * Useful for JSON responses from GPT that contain multiple text fields.
 */
export function sanitizeObject(obj) {
  if (typeof obj === "string") return sanitizeForHuman(obj);
  if (Array.isArray(obj)) return obj.map(sanitizeObject);
  if (obj && typeof obj === "object") {
    const result = {};
    for (const [key, value] of Object.entries(obj)) {
      result[key] = sanitizeObject(value);
    }
    return result;
  }
  return obj;
}
