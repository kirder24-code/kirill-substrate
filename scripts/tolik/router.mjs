/**
 * scripts/tolik/router.mjs
 *
 * Picks the right model + reasoning depth for the user's query.
 *
 * Two tiers:
 *   FAST       gpt-4o-mini    ~1.5s, $0.0003/call
 *              Use for: clear tool actions, factual lookups, status queries,
 *              "open X", "find Y", "what's the weather", "read file Z"
 *
 *   DEEP       gpt-4o         ~3-5s, $0.005/call
 *              Use for: advice, plans, opinions, "should I", "why",
 *              "what do you recommend", "compare", "explain", "decide",
 *              anything where reasoning matters more than latency
 *
 * Heuristic + cheap GPT classifier fallback.
 */

const FAST_PATTERNS = [
  /^(открой|open|зайди)\b/i,
  /^(прочитай|read|покажи|show|выведи)\b/i,
  /^(найди|search|поищи|grep)\b/i,
  /^(сколько|how many|какие|какой|что в|what's in|what is in)\b/i,
  /^(напомни|remind)\b/i,
  /^(запиши|сохрани|save|write)\b/i,
  /^(статус|status|здоров|health)\b/i,
  /^(который час|what time|какая погода|what.{0,15}weather)\b/i,
  /\b(новости|news|headlines)\b/i,
];

const DEEP_PATTERNS = [
  /\b(стоит ли|should i|advice|посоветуй|рекомендуй|recommend)\b/i,
  /\b(почему|why|объясни|explain)\b/i,
  /\b(что лучше|what.{0,10}better|какой выбрать|which one)\b/i,
  /\b(план|plan|стратегия|strategy|roadmap)\b/i,
  /\b(сравни|compare|разница|difference)\b/i,
  /\b(подумай|reason|think about|analyze|анализ|разбери)\b/i,
  /\b(идея|idea|концепт|concept|подход|approach)\b/i,
  /\b(оценка|evaluate|opinion|мнение|твоё мнение)\b/i,
  /\b(decide|реши|решение|решить)\b/i,
  /\b(как лучше|how should|best way|лучший способ)\b/i,
  // Write/edit operations need careful reasoning - route to gpt-4o so retries actually happen
  /\b(измени|изменить|правь|поправ|обнови|обновить|поменяй|перепиши|перепиш|edit|update|replace|modify)\b/i,
  /\b(добавь|добавить|вставь|insert|add)\b/i,
  /\b(удали|delete|remove|убери)\b/i,
  // Morning brief / substrate self-state - synthesis required, not lookup
  // NOTE: \b in JS regex is ASCII-only — does NOT work for Cyrillic.
  // Use explicit boundary chars: (?:^|\s|[.,!?])  ...  (?:$|\s|[.,!?])
  /(?:^|\s)(бриф|брифинг|briefing|сводка|сводку|утренн|morning)/i,
  /(?:^|\s)(что у нас|что сегодня|how are we|where do we stand|где мы стоим)/i,
  /(?:^|\s)(доброе утро|good morning|добрый день)/i,
  // ISA / opportunity / goals — must call substrate tools, not answer from memory
  /(?:^|\s)(ISA|opportunit|opp[\s.,!?]|active|активн|all opps?|какие.{0,15}есть)/i,
  /(?:^|\s)(цел[ьиейяю]|goals|priorities|приоритет)/i,
  // Self-awareness — must use atlas, never improvise
  /(?:^|\s)(что ты знаешь|кто ты|describe yourself|tell me about|какие.{0,10}боты|какие.{0,10}модули|сам.{0,5}о себе)/i,
  // Specialist consultation — long-form advice
  /(?:^|\s)(посоветуй|порекомендуй|consultants?|expert|специалист|посоветовать)/i,
];

// Follow-up references (look at conversation memory). Force deep so the
// model doesn't lazy-answer with "I don't have access".
const FOLLOWUP_PATTERNS = [
  /\b(это|этого|этой|этих|этим|этому|этой)\b/i,
  /\b(что было|что мы|раньше|до этого|до того)\b/i,
  /\b(продолжи|расскажи дальше|и что|и дальше|и потом)\b/i,
  /\b(тот|та|те|то|той|тех|том|тем)\b/i,
  /\b(об этом|об нем|об ней|про это|про то)\b/i,
  /\b(earlier|previously|before|that one|those|continue|go on|and then)\b/i,
];

/**
 * Classify intent without calling LLM. Returns {tier, reason}.
 *   tier: "fast" | "deep"
 */
export function classifyQuery(text) {
  if (!text) return { tier: "fast", reason: "empty" };
  const t = text.trim();

  // Follow-up references win over everything - need conversation memory.
  for (const p of FOLLOWUP_PATTERNS) {
    if (p.test(t)) return { tier: "deep", reason: `followup: ${p.source}` };
  }

  // Deep patterns win over fast (advice questions can contain "найди")
  for (const p of DEEP_PATTERNS) {
    if (p.test(t)) return { tier: "deep", reason: `deep_pattern: ${p.source}` };
  }

  // Short pure commands stay fast
  if (t.split(/\s+/).length <= 3) {
    for (const p of FAST_PATTERNS) {
      if (p.test(t)) return { tier: "fast", reason: "short+fast" };
    }
    return { tier: "fast", reason: "short_query" };
  }

  for (const p of FAST_PATTERNS) {
    if (p.test(t)) return { tier: "fast", reason: `fast_pattern: ${p.source}` };
  }

  // Long queries with multiple ideas → deep
  if (t.length > 120) return { tier: "deep", reason: "long_query" };

  // Default fast (most voice queries are commands)
  return { tier: "fast", reason: "default" };
}

export const MODEL_FOR_TIER = {
  fast: { model: "gpt-4o-mini", max_tokens: 350 },
  deep: { model: "gpt-4o",      max_tokens: 1500 },
};
