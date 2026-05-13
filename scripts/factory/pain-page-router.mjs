/**
 * pain-page-router.mjs
 *
 * Maps pain_category + micro_offer to the correct destination page on launchsoloai.com.
 * Used by outreach bots to include the right URL in emails and drafts.
 *
 * Built Apr 14 2026 after adding pain-specific landing pages.
 *
 * Usage:
 *   import { getDestinationUrl } from "./pain-page-router.mjs";
 *   const url = getDestinationUrl(painCategory, microOffer);
 */

const ROUTES = {
  // Local service / home service pain -> missed quotes page
  lead_response_delay: "https://launchsoloai.com/missed-quotes-intake-gaps",
  missed_followups: "https://launchsoloai.com/missed-quotes-intake-gaps",
  quoting_intake_friction: "https://launchsoloai.com/missed-quotes-intake-gaps",
  manual_scheduling: "https://launchsoloai.com/missed-quotes-intake-gaps",
  owner_bottleneck: "https://launchsoloai.com/missed-quotes-intake-gaps",

  // SaaS / founder pain -> founder revenue gaps page
  // (these map to enrichment pain categories that indicate SaaS founder issues)
  manual_admin_overload: "https://launchsoloai.com/founder-lead-revenue-gaps",
  crm_chaos: "https://launchsoloai.com/founder-lead-revenue-gaps",
  inbox_chaos: "https://launchsoloai.com/founder-lead-revenue-gaps",
  reporting_manual: "https://launchsoloai.com/founder-lead-revenue-gaps",
};

const OFFER_ROUTES = {
  // Micro-offer based routing (fallback if pain_category is unclear)
  missed_lead_recovery: "https://launchsoloai.com/missed-quotes-intake-gaps",
  followup_automation: "https://launchsoloai.com/missed-quotes-intake-gaps",
  quote_request_intake: "https://launchsoloai.com/missed-quotes-intake-gaps",
  admin_workflow_cleanup: "https://launchsoloai.com/missed-quotes-intake-gaps",
  inbox_to_crm: "https://launchsoloai.com/founder-lead-revenue-gaps",
};

const HOMEPAGE = "https://launchsoloai.com";

/**
 * Get the best destination URL based on pain and offer.
 * Falls back to homepage if no match.
 */
export function getDestinationUrl(painCategory, microOffer) {
  // Try pain category first
  if (painCategory && ROUTES[painCategory]) {
    return ROUTES[painCategory];
  }
  // Try micro offer
  if (microOffer && OFFER_ROUTES[microOffer]) {
    return OFFER_ROUTES[microOffer];
  }
  // Default to homepage
  return HOMEPAGE;
}
