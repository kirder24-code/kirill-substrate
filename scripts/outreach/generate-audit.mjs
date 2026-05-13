/**
 * Zero-to-Trust Audit Generator
 *
 * Creates a personalized 1-paragraph business audit from public data.
 * No prior relationship needed. No case studies needed.
 *
 * Input: business object (name, category, website, ownerName)
 * Output: { audit_paragraph, roi_estimate, confidence, signals_found }
 *
 * Confidence levels:
 *   high   — found specific tools/processes on website + category match
 *   medium — category match but limited website data
 *   low    — generic category assumptions only, no website signals
 *
 * Rule: if confidence=low, use "roughly" / "typically" language, never hard numbers as fact.
 */

// Industry data: average job size and follow-up loss rates
// Source: ServiceTitan data + industry averages
const INDUSTRY_DATA = {
  "landscaping":      { avgJob: 3000, lossRate: 0.40, estimatesPerMonth: 15, unit: "estimate" },
  "plumbers":         { avgJob: 800,  lossRate: 0.50, estimatesPerMonth: 12, unit: "call" },
  "hvac":             { avgJob: 2500, lossRate: 0.35, estimatesPerMonth: 20, unit: "estimate" },
  "roofing":          { avgJob: 8000, lossRate: 0.40, estimatesPerMonth: 10, unit: "quote" },
  "moving-companies": { avgJob: 1500, lossRate: 0.70, estimatesPerMonth: 25, unit: "inquiry" },
  "auto-repair":      { avgJob: 500,  lossRate: 0.30, estimatesPerMonth: 30, unit: "customer" },
  "cleaning-services":{ avgJob: 300,  lossRate: 0.35, estimatesPerMonth: 20, unit: "booking" },
  "electricians":     { avgJob: 700,  lossRate: 0.45, estimatesPerMonth: 15, unit: "estimate" },
};

const DEFAULT_DATA = { avgJob: 1000, lossRate: 0.35, estimatesPerMonth: 15, unit: "quote" };

// Tools that indicate current process (detected from website text)
const TOOL_SIGNALS = [
  { pattern: /jobber/i,           tool: "Jobber",         meaning: "scheduling and estimates" },
  { pattern: /housecall\s*pro/i,  tool: "Housecall Pro",  meaning: "field service management" },
  { pattern: /servicetitan/i,     tool: "ServiceTitan",   meaning: "field service management" },
  { pattern: /jane\s*app|janeapp/i, tool: "Jane App",     meaning: "booking and intake" },
  { pattern: /square/i,           tool: "Square",         meaning: "payments and scheduling" },
  { pattern: /quickbooks/i,       tool: "QuickBooks",     meaning: "invoicing" },
  { pattern: /calendly/i,         tool: "Calendly",       meaning: "scheduling" },
  { pattern: /acuity/i,           tool: "Acuity",         meaning: "scheduling" },
  { pattern: /freshbooks/i,      tool: "FreshBooks",     meaning: "invoicing" },
  { pattern: /google\s*sheets/i,  tool: "Google Sheets",  meaning: "manual tracking" },
  { pattern: /online\s*booking|book\s*online|book\s*now/i, tool: "online booking", meaning: "online booking" },
  { pattern: /free\s*estimate|get\s*a\s*quote|request\s*quote/i, tool: "quote form", meaning: "estimate requests" },
];

// Follow-up absence signals
const NO_FOLLOWUP_SIGNALS = [
  /call\s*(us|today|now|for)/i,
  /phone\s*:\s*\(?[0-9]/,
  /contact\s*us/i,
];

const HAS_FOLLOWUP_SIGNALS = [
  /automat/i,
  /crm/i,
  /follow[\s-]*up\s*(system|process|software)/i,
  /drip/i,
  /sequence/i,
];

/**
 * Generate a trust-building audit from public business data.
 *
 * @param {object} business — { name, category, website, ownerName }
 * @param {object} research — output from researchBusiness() (websiteExcerpt, painSignals, etc.)
 * @returns {{ audit_paragraph, roi_estimate, confidence, signals_found, roi_annual }}
 */
export function generateAudit(business, research) {
  const { name, category } = business;
  const industry = INDUSTRY_DATA[category] || DEFAULT_DATA;
  const websiteText = (research.websiteExcerpt || "").toLowerCase();
  const shortName = name.split(/[-–—,]/).map(s => s.trim()).filter(s => s.length > 2)[0] || name;

  // Detect tools
  const toolsFound = [];
  for (const sig of TOOL_SIGNALS) {
    if (sig.pattern.test(websiteText)) {
      toolsFound.push(sig);
    }
  }

  // Detect follow-up presence/absence
  const hasFollowupSystem = HAS_FOLLOWUP_SIGNALS.some(rx => rx.test(websiteText));
  const hasManualContact = NO_FOLLOWUP_SIGNALS.some(rx => rx.test(websiteText));

  // Detect growth/hiring signals (from research)
  const isGrowing = research.hiringSignal || research.growthSignal;

  // Determine confidence
  let confidence = "low";
  const signals_found = [];

  if (toolsFound.length > 0) {
    signals_found.push(...toolsFound.map(t => `uses ${t.tool} for ${t.meaning}`));
    confidence = "medium";
  }
  if (toolsFound.length > 0 && hasManualContact && !hasFollowupSystem) {
    signals_found.push("no automated follow-up detected");
    confidence = "high";
  }
  if (hasFollowupSystem) {
    signals_found.push("may already have follow-up system");
    confidence = "medium"; // downgrade — they might not need us
  }
  if (isGrowing) {
    signals_found.push(research.hiringSignal ? "actively hiring" : "expanding");
  }
  if (research.painSignals?.length > 0) {
    signals_found.push(...research.painSignals);
  }

  // Calculate ROI
  const lostJobsPerMonth = Math.round(industry.estimatesPerMonth * industry.lossRate);
  const lostRevenueMonthly = lostJobsPerMonth * industry.avgJob;
  const lostRevenueAnnual = lostRevenueMonthly * 12;

  // Format ROI string based on confidence
  let roi_estimate;
  if (confidence === "high") {
    roi_estimate = `$${(lostRevenueAnnual / 1000).toFixed(0)}K/year in ${industry.unit}s that fall through the cracks`;
  } else if (confidence === "medium") {
    roi_estimate = `roughly $${(lostRevenueAnnual / 1000).toFixed(0)}K/year in lost ${industry.unit}s based on industry averages`;
  } else {
    roi_estimate = `typically $${(lostRevenueAnnual / 1000).toFixed(0)}K+/year for a business like ${shortName}`;
  }

  // Build audit paragraph — owner-language, NOT consultant-language
  let audit_paragraph;

  if (confidence === "high") {
    // Specific: we found their tools and can see no follow-up system
    const toolStr = toolsFound.map(t => t.tool).join(" and ");
    audit_paragraph = `I looked at ${shortName}'s website and it looks like you're using ${toolStr} for ${toolsFound[0].meaning}. ` +
      `What I didn't see is anything that follows up on open ${industry.unit}s automatically. ` +
      `With ${industry.estimatesPerMonth}+ ${industry.unit}s a month, that can add up fast over a year. ` +
      `One fix: an automatic text at 24h and another at 72h after every ${industry.unit} — ` +
      `that usually improves the odds of winning back ${industry.unit}s that would otherwise sit open.`;
  } else if (confidence === "medium") {
    // Moderate: we know the category and found some signals
    const categoryLabel = category.replace(/-/g, " ").replace(/s$/, "").replace("plumber", "plumbing");
    const toolNote = toolsFound.length > 0
      ? `It looks like you use ${toolsFound[0].tool} for ${toolsFound[0].meaning}. `
      : "";
    audit_paragraph = `${toolNote}` +
      `For most ${categoryLabel} businesses with ${industry.estimatesPerMonth}+ ${industry.unit}s a month, ` +
      `a meaningful amount of revenue slips through the cracks just because nobody calls back fast enough. ` +
      `An automatic follow-up at 24h and 72h gives those open ${industry.unit}s a much better chance of turning into booked work.`;
  } else {
    // Low confidence: no specific data, softest language
    const categoryLabel = category.replace(/-/g, " ").replace(/s$/, "").replace("plumber", "plumbing").replace("cleaner", "cleaning");
    audit_paragraph = `For most ${categoryLabel} businesses I talk to, ` +
      `the biggest money leak is open ${industry.unit}s that never get a callback. ` +
      `Jobs end up going to whoever followed up first, not whoever quoted the best price. ` +
      `A simple automatic follow-up at 24h and 72h gives those ${industry.unit}s a much better chance of turning into real work.`;
  }

  return {
    audit_paragraph,
    roi_estimate,
    roi_annual: lostRevenueAnnual,
    confidence,
    signals_found,
    industry_data: {
      avgJob: industry.avgJob,
      lossRate: industry.lossRate,
      estimatesPerMonth: industry.estimatesPerMonth,
      lostPerMonth: lostJobsPerMonth,
    },
  };
}
